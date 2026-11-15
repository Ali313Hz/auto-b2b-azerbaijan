-- Payment status, customer contact in orders, customer activity
-- (forward-only, no data removed or rewritten):
--   1. orders.payment_status, separate from the order status:
--        UNPAID            Ödənilməyib
--        CUSTOMER_REPORTED Müştəri ödəniş etdiyini bildirib
--        PAID              Ödəniş təsdiqlənib
--        REJECTED          Ödəniş təsdiqlənmədi
--      Existing orders are NOT set to UNPAID: nobody recorded their payment
--      before this feature, so they keep NULL ("ödəniş qeyd olunmayıb").
--      Their order status (pending / confirmed / cancelled) is unchanged.
--      Only new orders start as UNPAID (column default).
--   2. Customers can only report their own order as paid
--      (report_order_payment). Only OWNER / SALES can confirm or reject
--      (set_admin_order_payment). Every step is in security_audit_log
--      (payment_reported, payment_confirmed, payment_rejected).
--   3. Admin order list / detail RPCs with paging, payment filter and the
--      customer's phone (not for WAREHOUSE).
--   4. Customer activity for staff: registered, last login (Supabase Auth
--      records it on the server; nobody can set it from the browser), last
--      order, order counts, purchase total and the latest orders.


-- ---------------------------------------------------------------------------
-- 1. Payment status
-- ---------------------------------------------------------------------------

create type public.payment_status as enum (
  'UNPAID',
  'CUSTOMER_REPORTED',
  'PAID',
  'REJECTED'
);

-- No default while adding: existing rows stay NULL (unknown).
alter table public.orders
  add column payment_status public.payment_status,
  add column payment_reported_at timestamptz,
  add column payment_confirmed_at timestamptz,
  add column payment_confirmed_by uuid references auth.users (id) on delete set null;

-- New orders start unpaid.
alter table public.orders
  alter column payment_status set default 'UNPAID';

-- Orders waiting for a payment check, newest first; date range scans.
create index orders_payment_status_created_at_idx
  on public.orders (payment_status, created_at desc);

create index orders_created_at_idx
  on public.orders (created_at desc);


-- Customer: "Ödənişi etdim". Allowed for the customer's own order that is
-- not cancelled and not paid / already reported. Pressing it again changes
-- nothing (returns the current status).
create function public.report_order_payment(p_order_id uuid)
returns public.payment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
    and o.customer_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.payment_status in ('CUSTOMER_REPORTED', 'PAID') then
    return v_order.payment_status;
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'Order is cancelled';
  end if;

  update public.orders
  set payment_status = 'CUSTOMER_REPORTED',
      payment_reported_at = now()
  where id = p_order_id;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    'payment_reported',
    'order',
    p_order_id::text,
    jsonb_build_object('previous', v_order.payment_status)
  );

  return 'CUSTOMER_REPORTED';
end;
$$;

revoke execute on function public.report_order_payment(uuid) from public, anon;
grant execute on function public.report_order_payment(uuid) to authenticated;


-- Staff: "Ödənişi təsdiqlə" (p_paid = true) or "Ödəniş təsdiqlənmədi"
-- (p_paid = false). OWNER and SALES only.
--   confirm: from any state except PAID (e.g. paid in cash, never reported)
--   reject:  only a payment the customer reported
-- Repeating the same decision changes nothing. Payment changes do not touch
-- orders.updated_at, so they never conflict with a staff member editing
-- the order items at the same time.
create function public.set_admin_order_payment(p_order_id uuid, p_paid boolean)
returns public.payment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_new public.payment_status;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to change payments';
  end if;

  if p_paid is null then
    raise exception 'Invalid payment decision';
  end if;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  v_new := case when p_paid then 'PAID' else 'REJECTED' end;

  if v_order.payment_status = v_new then
    return v_new;
  end if;

  if v_order.status = 'CANCELLED' then
    raise exception 'Order is cancelled';
  end if;

  if v_order.payment_status = 'PAID' then
    raise exception 'Payment already confirmed';
  end if;

  if not p_paid and v_order.payment_status is distinct from 'CUSTOMER_REPORTED' then
    raise exception 'No payment report to reject';
  end if;

  update public.orders
  set payment_status = v_new,
      payment_confirmed_at = case when p_paid then now() end,
      payment_confirmed_by = case when p_paid then (select auth.uid()) end
  where id = p_order_id;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    case when p_paid then 'payment_confirmed' else 'payment_rejected' end,
    'order',
    p_order_id::text,
    jsonb_build_object('previous', v_order.payment_status, 'total', v_order.total_amount)
  );

  return v_new;
end;
$$;

revoke execute on function public.set_admin_order_payment(uuid, boolean) from public, anon;
grant execute on function public.set_admin_order_payment(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Customer order list: + payment status
-- ---------------------------------------------------------------------------

drop function if exists public.get_customer_orders();

create function public.get_customer_orders()
returns table (
  order_id uuid,
  status public.order_status,
  total_amount numeric,
  created_at timestamptz,
  payment_status public.payment_status,
  payment_reported_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id as order_id,
    o.status,
    o.total_amount,
    o.created_at,
    o.payment_status,
    o.payment_reported_at
  from public.orders as o
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  where o.customer_id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
    and cp.must_change_password = false
    and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  order by o.created_at desc;
$$;

revoke execute on function public.get_customer_orders() from public, anon;
grant execute on function public.get_customer_orders() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Admin orders: one page with filters, one order, tab counts
-- ---------------------------------------------------------------------------

-- p_status: NULL / PENDING / CONFIRMED / CANCELLED
-- p_payment: NULL / UNPAID / CUSTOMER_REPORTED / PAID / REJECTED / UNKNOWN
--   (UNKNOWN = older orders without a payment record)
-- Phone: OWNER, SALES, SUPPORT. WAREHOUSE gets NULL.
create function public.get_admin_orders_page(
  p_page integer default 1,
  p_page_size integer default 50,
  p_status text default null,
  p_payment text default null,
  p_search text default null
)
returns table (
  order_id uuid,
  customer_id uuid,
  email text,
  company_name text,
  contact_name text,
  phone text,
  status public.order_status,
  payment_status public.payment_status,
  payment_reported_at timestamptz,
  total_amount numeric,
  item_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone boolean := private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  with filtered as materialized (
    select o.id, o.customer_id, o.status, o.payment_status, o.payment_reported_at,
      o.total_amount, o.created_at, o.updated_at
    from public.orders as o
    left join public.customer_profiles as cp
      on cp.id = o.customer_id
    where (p_status is null or o.status::text = p_status)
      and (
        p_payment is null
        or (p_payment = 'UNKNOWN' and o.payment_status is null)
        or o.payment_status::text = p_payment
      )
      and (
        v_search is null
        or cp.company_name ilike private.like_pattern(v_search)
        or cp.contact_name ilike private.like_pattern(v_search)
        or (v_phone and cp.phone ilike private.like_pattern(v_search))
        or o.id::text like (lower(ltrim(v_search, '#')) || '%')
      )
  ),
  page as (
    select f.*
    from filtered as f
    order by f.created_at desc, f.id
    limit v_size
    offset (v_page - 1) * v_size
  )
  select
    pg.id,
    pg.customer_id,
    au.email::text,
    cp.company_name,
    cp.contact_name,
    case when v_phone then cp.phone end,
    pg.status,
    pg.payment_status,
    pg.payment_reported_at,
    pg.total_amount,
    (select count(*) from public.order_items as oi where oi.order_id = pg.id),
    pg.created_at,
    pg.updated_at,
    (select count(*) from filtered)
  from page as pg
  left join public.customer_profiles as cp
    on cp.id = pg.customer_id
  left join auth.users as au
    on au.id = pg.customer_id
  order by pg.created_at desc, pg.id;
end;
$$;

revoke execute on function public.get_admin_orders_page(integer, integer, text, text, text) from public, anon;
grant execute on function public.get_admin_orders_page(integer, integer, text, text, text) to authenticated;


-- Numbers for the filter tabs (one aggregate query).
create function public.get_admin_order_counts()
returns table (
  total bigint,
  pending bigint,
  confirmed bigint,
  cancelled bigint,
  payment_reported bigint,
  unpaid bigint,
  paid bigint,
  rejected bigint
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
    count(*),
    count(*) filter (where o.status = 'PENDING'),
    count(*) filter (where o.status = 'CONFIRMED'),
    count(*) filter (where o.status = 'CANCELLED'),
    count(*) filter (where o.payment_status = 'CUSTOMER_REPORTED'),
    count(*) filter (where o.payment_status = 'UNPAID'),
    count(*) filter (where o.payment_status = 'PAID'),
    count(*) filter (where o.payment_status = 'REJECTED')
  from public.orders as o;
end;
$$;

revoke execute on function public.get_admin_order_counts() from public, anon;
grant execute on function public.get_admin_order_counts() to authenticated;


-- One order with the customer's contact details and payment record.
create function public.get_admin_order(p_order_id uuid)
returns table (
  order_id uuid,
  customer_id uuid,
  email text,
  company_name text,
  contact_name text,
  phone text,
  price_group public.customer_price_group,
  status public.order_status,
  payment_status public.payment_status,
  payment_reported_at timestamptz,
  payment_confirmed_at timestamptz,
  payment_confirmed_by_name text,
  total_amount numeric,
  item_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone boolean := private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]);
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select
    o.id,
    o.customer_id,
    au.email::text,
    cp.company_name,
    cp.contact_name,
    case when v_phone then cp.phone end,
    cp.price_group,
    o.status,
    o.payment_status,
    o.payment_reported_at,
    o.payment_confirmed_at,
    coalesce(sp.full_name, ca.email::text),
    o.total_amount,
    (select count(*) from public.order_items as oi where oi.order_id = o.id),
    o.created_at,
    o.updated_at
  from public.orders as o
  left join public.customer_profiles as cp
    on cp.id = o.customer_id
  left join auth.users as au
    on au.id = o.customer_id
  left join public.staff_profiles as sp
    on sp.id = o.payment_confirmed_by
  left join auth.users as ca
    on ca.id = o.payment_confirmed_by
  where o.id = p_order_id;
end;
$$;

revoke execute on function public.get_admin_order(uuid) from public, anon;
grant execute on function public.get_admin_order(uuid) to authenticated;


-- Dashboard counts: + orders whose payment the customer reported.
drop function if exists public.get_admin_dashboard_stats();

create function public.get_admin_dashboard_stats()
returns table (
  total_products bigint,
  active_products bigint,
  low_stock_products bigint,
  active_customers bigint,
  pending_orders bigint,
  payment_reported_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'PRODUCT_MANAGER', 'SUPPORT', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view dashboard';
  end if;

  return query
  select
    (select count(*) from public.products),
    (select count(*) from public.products as p where p.active),
    (select count(*) from public.products as p where p.active and p.stock <= 5),
    (
      select count(*)
      from public.customer_profiles as cp
      where cp.active and cp.archived_at is null
    ),
    (select count(*) from public.orders as o where o.status = 'PENDING'),
    (select count(*) from public.orders as o where o.payment_status = 'CUSTOMER_REPORTED');
end;
$$;

revoke execute on function public.get_admin_dashboard_stats() from public, anon;
grant execute on function public.get_admin_dashboard_stats() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Customer activity (OWNER, SALES, SUPPORT)
-- ---------------------------------------------------------------------------

-- "Ümumi alış məbləği" = sum of CONFIRMED orders (cancelled and still
-- pending orders are not purchases). paid_amount = orders whose payment is
-- confirmed.
create function public.get_admin_customer_activity(p_customer_id uuid)
returns table (
  registered_at timestamptz,
  last_sign_in_at timestamptz,
  last_order_at timestamptz,
  order_count bigint,
  confirmed_order_count bigint,
  purchase_total numeric,
  paid_total numeric,
  phone text,
  email text,
  active boolean,
  archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view customers';
  end if;

  return query
  select
    cp.created_at,
    au.last_sign_in_at,
    s.last_order_at,
    coalesce(s.order_count, 0),
    coalesce(s.confirmed_count, 0),
    coalesce(s.purchase_total, 0),
    coalesce(s.paid_total, 0),
    cp.phone,
    au.email::text,
    cp.active,
    cp.archived_at
  from public.customer_profiles as cp
  left join auth.users as au
    on au.id = cp.id
  left join lateral (
    select
      max(o.created_at) as last_order_at,
      count(*) as order_count,
      count(*) filter (where o.status = 'CONFIRMED') as confirmed_count,
      sum(o.total_amount) filter (where o.status = 'CONFIRMED') as purchase_total,
      sum(o.total_amount) filter (where o.status <> 'CANCELLED' and o.payment_status = 'PAID') as paid_total
    from public.orders as o
    where o.customer_id = cp.id
  ) as s on true
  where cp.id = p_customer_id;
end;
$$;

revoke execute on function public.get_admin_customer_activity(uuid) from public, anon;
grant execute on function public.get_admin_customer_activity(uuid) to authenticated;


-- Latest orders of one customer (uses orders (customer_id, created_at)).
create function public.get_admin_customer_orders(p_customer_id uuid, p_limit integer default 20)
returns table (
  order_id uuid,
  status public.order_status,
  payment_status public.payment_status,
  total_amount numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view customers';
  end if;

  return query
  select o.id, o.status, o.payment_status, o.total_amount, o.created_at
  from public.orders as o
  where o.customer_id = p_customer_id
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke execute on function public.get_admin_customer_orders(uuid, integer) from public, anon;
grant execute on function public.get_admin_customer_orders(uuid, integer) to authenticated;
