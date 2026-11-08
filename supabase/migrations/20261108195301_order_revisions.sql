-- Order revisions: staff propose changes to a customer's order, the
-- customer accepts or rejects them. Nothing is overwritten silently and
-- no revision is ever deleted.
--
-- Order status stays PENDING / CONFIRMED / CANCELLED. Revisions:
--   DRAFT              staff edit it, the customer cannot see it
--   AWAITING_CUSTOMER  sent to the customer (can be re-sent)
--   ACCEPTED           accepted by the customer (version 1 = original order)
--   REJECTED           the customer did not agree; the order is unchanged
--   SUPERSEDED         withdrawn/replaced before the customer answered
--
-- Stock was already reserved when the order was created. A draft or a sent
-- revision does not touch stock. Acceptance applies, in one transaction
-- with row locks, the difference between the current order items and the
-- revision items (more = taken from stock, less/removed = returned). A
-- repeated acceptance changes nothing. Order-specific prices live only in
-- the revision items and order_items, never in product_prices.
--
-- Commercial edits: OWNER and SALES. Viewing: every role that sees orders.


create type public.order_revision_status as enum (
  'DRAFT',
  'AWAITING_CUSTOMER',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED'
);

create table public.order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  version integer not null check (version >= 1),
  status public.order_revision_status not null,
  note text check (note is null or length(note) <= 2000),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  last_sent_at timestamptz,
  sent_count integer not null default 0 check (sent_count >= 0),
  responded_at timestamptz,
  responded_by uuid references auth.users (id) on delete set null,
  unique (order_id, version)
);

-- At most one open (draft or sent) revision per order.
create unique index order_revisions_one_open
  on public.order_revisions (order_id)
  where status in ('DRAFT', 'AWAITING_CUSTOMER');

create table public.order_revision_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.order_revisions (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  sku text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (revision_id, product_id)
);

create index order_revision_items_product_idx
  on public.order_revision_items (product_id);

-- Only reachable through the functions below.
alter table public.order_revisions enable row level security;
alter table public.order_revision_items enable row level security;
revoke all on public.order_revisions from anon, authenticated;
revoke all on public.order_revision_items from anon, authenticated;


-- Items of a revision as JSON for the read functions.
create or replace function private.order_revision_items_json(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', ri.product_id,
        'sku', ri.sku,
        'product_name', ri.product_name,
        'quantity', ri.quantity,
        'unit_price', ri.unit_price,
        'line_total', ri.line_total
      )
      order by ri.created_at, ri.sku
    ),
    '[]'::jsonb
  )
  from public.order_revision_items as ri
  where ri.revision_id = p_revision_id;
$$;

revoke all on function private.order_revision_items_json(uuid) from public, anon, authenticated;


-- Version 1 = the order as the customer sent it (or as it is now, for
-- orders created before revisions existed). Called with the order locked.
create or replace function private.ensure_initial_order_revision(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_revision_id uuid;
begin
  if exists (
    select 1 from public.order_revisions as r where r.order_id = p_order_id
  ) then
    return;
  end if;

  select o.* into v_order from public.orders as o where o.id = p_order_id;

  insert into public.order_revisions (
    order_id, version, status, total_amount, created_by, created_at,
    updated_at, responded_at, responded_by
  )
  values (
    p_order_id, 1, 'ACCEPTED', v_order.total_amount, v_order.customer_id,
    v_order.created_at, now(), v_order.created_at, v_order.customer_id
  )
  returning id into v_revision_id;

  insert into public.order_revision_items (
    revision_id, product_id, sku, product_name, quantity, unit_price, line_total
  )
  select
    v_revision_id,
    oi.product_id,
    min(oi.sku),
    coalesce(min(p.name), min(oi.sku)),
    sum(oi.quantity)::integer,
    min(oi.unit_price),
    sum(oi.line_total)
  from public.order_items as oi
  left join public.products as p
    on p.id = oi.product_id
  where oi.order_id = p_order_id
  group by oi.product_id;
end;
$$;

revoke all on function private.ensure_initial_order_revision(uuid) from public, anon, authenticated;


create or replace function private.audit_order_revision(
  p_action text,
  p_order_id uuid,
  p_revision_id uuid,
  p_version integer,
  p_extra jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    p_action,
    'order',
    p_order_id::text,
    jsonb_build_object('revision_id', p_revision_id, 'version', p_version) || coalesce(p_extra, '{}'::jsonb)
  );
$$;

revoke all on function private.audit_order_revision(text, uuid, uuid, integer, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Staff: read
-- ---------------------------------------------------------------------------

-- Current order lines with product name and stock (all order roles).
create or replace function public.get_admin_order_lines(p_order_id uuid)
returns table (
  id uuid,
  product_id uuid,
  sku text,
  product_name text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  stock integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select oi.id, oi.product_id, oi.sku, coalesce(p.name, oi.sku), oi.quantity,
         oi.unit_price, oi.line_total, p.stock
  from public.order_items as oi
  left join public.products as p
    on p.id = oi.product_id
  where oi.order_id = p_order_id
  order by oi.created_at, oi.sku;
end;
$$;

revoke execute on function public.get_admin_order_lines(uuid) from public, anon;
grant execute on function public.get_admin_order_lines(uuid) to authenticated;


create or replace function public.get_admin_order_revisions(p_order_id uuid)
returns table (
  id uuid,
  version integer,
  status public.order_revision_status,
  note text,
  total_amount numeric,
  created_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  sent_at timestamptz,
  last_sent_at timestamptz,
  sent_count integer,
  responded_at timestamptz,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select
    r.id, r.version, r.status, r.note, r.total_amount,
    coalesce(sp.full_name, cp.company_name, au.email::text),
    r.created_at, r.updated_at, r.sent_at, r.last_sent_at, r.sent_count,
    r.responded_at,
    private.order_revision_items_json(r.id)
  from public.order_revisions as r
  left join public.staff_profiles as sp on sp.id = r.created_by
  left join public.customer_profiles as cp on cp.id = r.created_by
  left join auth.users as au on au.id = r.created_by
  where r.order_id = p_order_id
  order by r.version desc;
end;
$$;

revoke execute on function public.get_admin_order_revisions(uuid) from public, anon;
grant execute on function public.get_admin_order_revisions(uuid) to authenticated;


-- Latest revision per order, for badges in the order list.
create or replace function public.get_admin_order_revision_states()
returns table (order_id uuid, version integer, status public.order_revision_status)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select distinct on (r.order_id) r.order_id, r.version, r.status
  from public.order_revisions as r
  where r.version > 1
  order by r.order_id, r.version desc;
end;
$$;

revoke execute on function public.get_admin_order_revision_states() from public, anon;
grant execute on function public.get_admin_order_revision_states() to authenticated;


-- Products to add to an order, with the catalog price of the order's
-- customer group (OWNER, SALES).
create or replace function public.search_admin_order_products(p_order_id uuid, p_search text)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  active boolean,
  catalog_price numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.customer_price_group;
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select cp.price_group into v_group
  from public.orders as o
  join public.customer_profiles as cp on cp.id = o.customer_id
  where o.id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  return query
  select p.id, p.sku, p.name, p.stock, p.active,
    case v_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end
  from public.products as p
  join public.product_prices as pp on pp.product_id = p.id
  where v_search is null
     or p.name ilike private.like_pattern(v_search)
     or p.sku ilike private.like_pattern(v_search)
  order by p.active desc, p.name, p.sku
  limit 20;
end;
$$;

revoke execute on function public.search_admin_order_products(uuid, text) from public, anon;
grant execute on function public.search_admin_order_products(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Staff: write (OWNER, SALES)
-- ---------------------------------------------------------------------------

-- Opens a draft. Returns the open draft if there is one. A sent revision
-- that the customer has not answered is withdrawn (SUPERSEDED) and its
-- items become the draft's starting point; otherwise the current order
-- items are.
create or replace function public.create_admin_order_revision(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_open public.order_revisions%rowtype;
  v_version integer;
  v_revision_id uuid;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select o.status into v_status
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_status = 'CANCELLED' then
    raise exception 'Cancelled orders cannot be changed';
  end if;

  perform private.ensure_initial_order_revision(p_order_id);

  select r.* into v_open
  from public.order_revisions as r
  where r.order_id = p_order_id
    and r.status in ('DRAFT', 'AWAITING_CUSTOMER')
  for update;

  if found and v_open.status = 'DRAFT' then
    return v_open.id;
  end if;

  select max(r.version) + 1 into v_version
  from public.order_revisions as r
  where r.order_id = p_order_id;

  if v_open.id is not null then
    update public.order_revisions
    set status = 'SUPERSEDED', updated_at = now()
    where id = v_open.id;
  end if;

  insert into public.order_revisions (order_id, version, status, note, created_by)
  values (p_order_id, v_version, 'DRAFT', v_open.note, (select auth.uid()))
  returning id into v_revision_id;

  if v_open.id is not null then
    insert into public.order_revision_items (
      revision_id, product_id, sku, product_name, quantity, unit_price, line_total
    )
    select v_revision_id, ri.product_id, ri.sku, ri.product_name, ri.quantity,
           ri.unit_price, ri.line_total
    from public.order_revision_items as ri
    where ri.revision_id = v_open.id;
  else
    insert into public.order_revision_items (
      revision_id, product_id, sku, product_name, quantity, unit_price, line_total
    )
    select
      v_revision_id,
      oi.product_id,
      min(oi.sku),
      coalesce(min(p.name), min(oi.sku)),
      sum(oi.quantity)::integer,
      min(oi.unit_price),
      sum(oi.line_total)
    from public.order_items as oi
    left join public.products as p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by oi.product_id;
  end if;

  update public.order_revisions
  set total_amount = (
    select coalesce(sum(ri.line_total), 0)
    from public.order_revision_items as ri
    where ri.revision_id = v_revision_id
  )
  where id = v_revision_id;

  perform private.audit_order_revision(
    'order_revision_created', p_order_id, v_revision_id, v_version,
    case when v_open.id is not null
      then jsonb_build_object('replaces_version', v_open.version)
      else '{}'::jsonb
    end
  );

  return v_revision_id;
end;
$$;

revoke execute on function public.create_admin_order_revision(uuid) from public, anon;
grant execute on function public.create_admin_order_revision(uuid) to authenticated;


-- Replaces the items and note of a draft. p_items:
--   [{"product_id": uuid, "quantity": int, "unit_price": number | null}]
-- A missing/null unit_price uses the catalog price of the customer's group.
-- Line totals and the total are calculated here; client totals are ignored.
create or replace function public.save_admin_order_revision(
  p_revision_id uuid,
  p_items jsonb,
  p_note text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.order_revisions%rowtype;
  v_group public.customer_price_group;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_price numeric;
  v_sku text;
  v_name text;
  v_catalog numeric;
  v_total numeric(12, 2);
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id;

  if not found then
    raise exception 'Revision not found';
  end if;

  -- Same lock order as acceptance and status changes: order, then revision.
  perform 1 from public.orders as o where o.id = v_revision.order_id for update;

  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id
  for update;

  if v_revision.status <> 'DRAFT' then
    raise exception 'Only drafts can be edited';
  end if;

  if v_note is not null and length(v_note) > 2000 then
    raise exception 'Note is too long';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'Invalid order items';
  end if;

  select cp.price_group into v_group
  from public.orders as o
  join public.customer_profiles as cp on cp.id = o.customer_id
  where o.id = v_revision.order_id;

  delete from public.order_revision_items where revision_id = p_revision_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;
      v_price := case
        when jsonb_typeof(v_item -> 'unit_price') = 'number'
          then (v_item ->> 'unit_price')::numeric
        when jsonb_typeof(v_item -> 'unit_price') = 'string'
          then nullif(trim(v_item ->> 'unit_price'), '')::numeric
        else null
      end;
    exception when others then
      raise exception 'Invalid order items';
    end;

    if v_product_id is null or v_quantity is null or v_quantity < 1 or v_quantity > 100000 then
      raise exception 'Invalid quantity';
    end if;

    select p.sku, p.name,
      case v_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    into v_sku, v_name, v_catalog
    from public.products as p
    left join public.product_prices as pp on pp.product_id = p.id
    where p.id = v_product_id;

    if not found then
      raise exception 'Product not found';
    end if;

    v_price := round(coalesce(v_price, v_catalog), 2);

    if v_price is null or v_price < 0 or v_price > 1000000 then
      raise exception 'Invalid price';
    end if;

    begin
      insert into public.order_revision_items (
        revision_id, product_id, sku, product_name, quantity, unit_price, line_total
      )
      values (
        p_revision_id, v_product_id, v_sku, v_name, v_quantity, v_price,
        round(v_quantity * v_price, 2)
      );
    exception when unique_violation then
      raise exception 'Duplicate product';
    end;
  end loop;

  select coalesce(sum(ri.line_total), 0) into v_total
  from public.order_revision_items as ri
  where ri.revision_id = p_revision_id;

  update public.order_revisions
  set total_amount = v_total, note = v_note, updated_at = now()
  where id = p_revision_id;

  perform private.audit_order_revision(
    'order_revision_updated', v_revision.order_id, p_revision_id, v_revision.version,
    jsonb_build_object('items', jsonb_array_length(p_items))
  );

  return v_total;
end;
$$;

revoke execute on function public.save_admin_order_revision(uuid, jsonb, text) from public, anon;
grant execute on function public.save_admin_order_revision(uuid, jsonb, text) to authenticated;


-- DRAFT -> AWAITING_CUSTOMER. Stock is not touched.
create or replace function public.send_admin_order_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.order_revisions%rowtype;
  v_order_status public.order_status;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select r.* into v_revision from public.order_revisions as r where r.id = p_revision_id;

  if not found then
    raise exception 'Revision not found';
  end if;

  select o.status into v_order_status
  from public.orders as o
  where o.id = v_revision.order_id
  for update;

  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id
  for update;

  if v_order_status = 'CANCELLED' then
    raise exception 'Cancelled orders cannot be changed';
  end if;

  if v_revision.status <> 'DRAFT' then
    raise exception 'Only drafts can be sent';
  end if;

  if not exists (
    select 1 from public.order_revision_items as ri where ri.revision_id = p_revision_id
  ) then
    raise exception 'Revision has no items';
  end if;

  update public.order_revisions
  set status = 'AWAITING_CUSTOMER',
      sent_at = now(),
      last_sent_at = now(),
      sent_count = 1,
      updated_at = now()
  where id = p_revision_id;

  perform private.audit_order_revision(
    'order_revision_sent', v_revision.order_id, p_revision_id, v_revision.version
  );
end;
$$;

revoke execute on function public.send_admin_order_revision(uuid) from public, anon;
grant execute on function public.send_admin_order_revision(uuid) to authenticated;


-- Shows the same open revision to the customer again (no new version).
create or replace function public.resend_admin_order_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.order_revisions%rowtype;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id
  for update;

  if not found then
    raise exception 'Revision not found';
  end if;

  if v_revision.status <> 'AWAITING_CUSTOMER' then
    raise exception 'Only revisions awaiting the customer can be re-sent';
  end if;

  update public.order_revisions
  set last_sent_at = now(), sent_count = sent_count + 1, updated_at = now()
  where id = p_revision_id;

  perform private.audit_order_revision(
    'order_revision_resent', v_revision.order_id, p_revision_id, v_revision.version,
    jsonb_build_object('sent_count', v_revision.sent_count + 1)
  );
end;
$$;

revoke execute on function public.resend_admin_order_revision(uuid) from public, anon;
grant execute on function public.resend_admin_order_revision(uuid) to authenticated;


-- Withdraws a draft or a sent revision (kept as SUPERSEDED).
create or replace function public.discard_admin_order_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.order_revisions%rowtype;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select r.* into v_revision from public.order_revisions as r where r.id = p_revision_id;

  if not found then
    raise exception 'Revision not found';
  end if;

  perform 1 from public.orders as o where o.id = v_revision.order_id for update;

  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id
  for update;

  if v_revision.status not in ('DRAFT', 'AWAITING_CUSTOMER') then
    raise exception 'Revision is no longer open';
  end if;

  update public.order_revisions
  set status = 'SUPERSEDED', updated_at = now()
  where id = p_revision_id;

  perform private.audit_order_revision(
    'order_revision_updated', v_revision.order_id, p_revision_id, v_revision.version,
    jsonb_build_object('withdrawn', true)
  );
end;
$$;

revoke execute on function public.discard_admin_order_revision(uuid) from public, anon;
grant execute on function public.discard_admin_order_revision(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Customer
-- ---------------------------------------------------------------------------

-- Revisions of the customer's own order that were sent to them, plus the
-- accepted ones (version 1 = original). Drafts are never shown.
create or replace function public.get_customer_order_revisions(p_order_id uuid)
returns table (
  id uuid,
  version integer,
  status public.order_revision_status,
  note text,
  total_amount numeric,
  created_at timestamptz,
  sent_at timestamptz,
  last_sent_at timestamptz,
  responded_at timestamptz,
  items jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.version, r.status, r.note, r.total_amount, r.created_at,
         r.sent_at, r.last_sent_at, r.responded_at,
         private.order_revision_items_json(r.id)
  from public.order_revisions as r
  join public.orders as o on o.id = r.order_id
  where r.order_id = p_order_id
    and o.customer_id = (select auth.uid())
    and private.current_customer_price_group() is not null
    and (r.sent_at is not null or r.status = 'ACCEPTED')
  order by r.version desc;
$$;

revoke execute on function public.get_customer_order_revisions(uuid) from public, anon;
grant execute on function public.get_customer_order_revisions(uuid) to authenticated;


-- Orders of the signed-in customer with a change waiting for an answer.
create or replace function public.get_customer_order_alerts()
returns table (order_id uuid, revision_id uuid, last_sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.order_id, r.id, r.last_sent_at
  from public.order_revisions as r
  join public.orders as o on o.id = r.order_id
  where o.customer_id = (select auth.uid())
    and o.status <> 'CANCELLED'
    and r.status = 'AWAITING_CUSTOMER'
    and private.current_customer_price_group() is not null
  order by r.last_sent_at desc;
$$;

revoke execute on function public.get_customer_order_alerts() from public, anon;
grant execute on function public.get_customer_order_alerts() to authenticated;


-- Customer answer. Accept applies the stock difference and replaces the
-- order items in one transaction; the order becomes CONFIRMED. Reject
-- leaves the order unchanged. Repeating the same answer is a no-op.
create or replace function public.respond_to_order_revision(
  p_revision_id uuid,
  p_accept boolean
)
returns public.order_revision_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_revision public.order_revisions%rowtype;
  v_order public.orders%rowtype;
  v_short_sku text;
  v_total numeric(12, 2);
begin
  if v_customer_id is null or private.current_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if p_accept is null then
    raise exception 'Invalid response';
  end if;

  select r.* into v_revision from public.order_revisions as r where r.id = p_revision_id;

  if not found then
    raise exception 'Revision not found';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = v_revision.order_id
    and o.customer_id = v_customer_id
  for update;

  if not found then
    raise exception 'Revision not found';
  end if;

  -- Re-read under the order lock: a parallel answer is now visible.
  select r.* into v_revision
  from public.order_revisions as r
  where r.id = p_revision_id
  for update;

  if (p_accept and v_revision.status = 'ACCEPTED')
     or (not p_accept and v_revision.status = 'REJECTED') then
    return v_revision.status;
  end if;

  if v_revision.status <> 'AWAITING_CUSTOMER' then
    raise exception 'Revision is no longer open';
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'Order is cancelled';
  end if;

  if not p_accept then
    update public.order_revisions
    set status = 'REJECTED', responded_at = now(), responded_by = v_customer_id,
        updated_at = now()
    where id = p_revision_id;

    perform private.audit_order_revision(
      'order_revision_rejected', v_order.id, p_revision_id, v_revision.version
    );

    return 'REJECTED';
  end if;

  -- Lock every product whose stock may change, in a fixed order.
  perform 1
  from public.products as p
  where p.id in (
    select oi.product_id from public.order_items as oi where oi.order_id = v_order.id
    union
    select ri.product_id from public.order_revision_items as ri where ri.revision_id = p_revision_id
  )
  order by p.id
  for update;

  select p.sku into v_short_sku
  from (
    select coalesce(n.product_id, c.product_id) as product_id,
           coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
    from (
      select ri.product_id, sum(ri.quantity) as quantity
      from public.order_revision_items as ri
      where ri.revision_id = p_revision_id
      group by ri.product_id
    ) as n
    full join (
      select oi.product_id, sum(oi.quantity) as quantity
      from public.order_items as oi
      where oi.order_id = v_order.id
      group by oi.product_id
    ) as c on c.product_id = n.product_id
  ) as d
  join public.products as p on p.id = d.product_id
  where d.delta > 0
    and p.stock < d.delta
  order by p.sku
  limit 1;

  if v_short_sku is not null then
    raise exception 'Insufficient stock for %', v_short_sku;
  end if;

  update public.products as p
  set stock = p.stock - d.delta,
      updated_at = now()
  from (
    select coalesce(n.product_id, c.product_id) as product_id,
           coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
    from (
      select ri.product_id, sum(ri.quantity) as quantity
      from public.order_revision_items as ri
      where ri.revision_id = p_revision_id
      group by ri.product_id
    ) as n
    full join (
      select oi.product_id, sum(oi.quantity) as quantity
      from public.order_items as oi
      where oi.order_id = v_order.id
      group by oi.product_id
    ) as c on c.product_id = n.product_id
  ) as d
  where p.id = d.product_id
    and d.delta <> 0;

  delete from public.order_items where order_id = v_order.id;

  insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
  select v_order.id, ri.product_id, ri.sku, ri.quantity, ri.unit_price, ri.line_total
  from public.order_revision_items as ri
  where ri.revision_id = p_revision_id;

  select coalesce(sum(ri.line_total), 0) into v_total
  from public.order_revision_items as ri
  where ri.revision_id = p_revision_id;

  update public.orders
  set total_amount = v_total, status = 'CONFIRMED', updated_at = now()
  where id = v_order.id;

  update public.order_revisions
  set status = 'ACCEPTED', total_amount = v_total, responded_at = now(),
      responded_by = v_customer_id, updated_at = now()
  where id = p_revision_id;

  perform private.audit_order_revision(
    'order_revision_accepted', v_order.id, p_revision_id, v_revision.version
  );

  return 'ACCEPTED';
end;
$$;

revoke execute on function public.respond_to_order_revision(uuid, boolean) from public, anon;
grant execute on function public.respond_to_order_revision(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- Confirm / cancel: unchanged rules; an open revision is withdrawn.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_admin_order_status(p_order_id uuid, p_status order_status)
 RETURNS order_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current_status public.order_status;
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to update orders';
  end if;

  select o.status
  into v_current_status
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_current_status = p_status then
    return v_current_status;
  end if;

  if v_current_status <> 'PENDING' then
    raise exception 'Only pending orders can change status';
  end if;

  if p_status not in ('CONFIRMED', 'CANCELLED') then
    raise exception 'Invalid order status transition';
  end if;

  -- The customer can no longer answer a change to a decided order.
  update public.order_revisions
  set status = 'SUPERSEDED', updated_at = now()
  where order_id = p_order_id
    and status in ('DRAFT', 'AWAITING_CUSTOMER');

  if p_status = 'CONFIRMED' then
    update public.orders
    set
      status = 'CONFIRMED',
      updated_at = now()
    where id = p_order_id;

    return 'CONFIRMED';
  end if;

  update public.products as p
  set
    stock = p.stock + oi.quantity,
    updated_at = now()
  from public.order_items as oi
  where oi.order_id = p_order_id
    and oi.product_id = p.id;

  update public.orders
  set
    status = 'CANCELLED',
    updated_at = now()
  where id = p_order_id;

  return 'CANCELLED';
end;
$function$;
