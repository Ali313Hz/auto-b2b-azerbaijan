-- "Tezliklə stokda" products and pre-orders (forward-only, nothing removed):
--   1. products.availability: IN_STOCK ("Stokda") / COMING_SOON
--      ("Tezliklə stokda"). Every existing product becomes IN_STOCK, so
--      today's rules stay exactly as they are (a product with stock 0 is
--      still "Stokda yoxdur" and cannot be ordered). Only OWNER /
--      PRODUCT_MANAGER can mark a product COMING_SOON.
--   2. orders.order_type: STANDARD / PREORDER. Every existing order is a
--      STANDARD order (column default), which is what they were.
--   3. Cart: a COMING_SOON product can be added with any stock (also 0).
--      Which part of the cart a line belongs to is decided by the database
--      from the product's availability, never by the browser:
--        IN_STOCK line    -> normal order, stock checked and taken
--        COMING_SOON line -> pre-order, stock neither checked nor taken
--      create_order_from_cart(p_order_type) turns ONE part into ONE order;
--      the two are never mixed. An IN_STOCK product without stock can
--      never end up in a pre-order.
--   4. Pre-orders: cancelling does not return stock (none was taken);
--      editing a pending pre-order does not move stock and only accepts
--      COMING_SOON products as new lines.
--   5. Lists return availability / order type; admin orders filter by type.


-- ---------------------------------------------------------------------------
-- 1 + 2. New columns
-- ---------------------------------------------------------------------------

create type public.product_availability as enum ('IN_STOCK', 'COMING_SOON');
create type public.order_type as enum ('STANDARD', 'PREORDER');

alter table public.products
  add column availability public.product_availability not null default 'IN_STOCK';

alter table public.orders
  add column order_type public.order_type not null default 'STANDARD';

-- Admin filter Normal / Ön sifariş, newest first.
create index orders_order_type_created_at_idx
  on public.orders (order_type, created_at desc);


-- OWNER / PRODUCT_MANAGER: Stokda <-> Tezliklə stokda.
create function public.set_admin_product_availability(
  p_product_id uuid,
  p_availability public.product_availability
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update products';
  end if;

  if p_availability is null then
    raise exception 'Invalid availability';
  end if;

  update public.products
  set availability = p_availability, updated_at = now()
  where id = p_product_id
    and availability is distinct from p_availability;

  if not found and not exists (select 1 from public.products as p where p.id = p_product_id) then
    raise exception 'Product not found';
  end if;
end;
$$;

revoke execute on function public.set_admin_product_availability(uuid, public.product_availability) from public, anon;
grant execute on function public.set_admin_product_availability(uuid, public.product_availability) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Cart
-- ---------------------------------------------------------------------------

-- Largest quantity of a pre-order line (no stock limit applies).
create or replace function private.max_preorder_quantity()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 100000;
$$;

create or replace function public.add_to_cart(p_product_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_cart_id uuid;
  v_limit integer;
  v_new_quantity integer;
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if private.current_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  -- IN_STOCK: up to the stock. COMING_SOON: pre-order, stock not used.
  select case
    when p.availability = 'COMING_SOON' then private.max_preorder_quantity()
    else p.stock
  end
  into v_limit
  from public.products as p
  where p.id = p_product_id
    and private.is_product_available(p.id)
  for update of p;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_quantity > v_limit then
    raise exception 'Insufficient stock';
  end if;

  insert into public.carts (customer_id)
  values (v_customer_id)
  on conflict (customer_id)
  do update set updated_at = now()
  returning id into v_cart_id;

  insert into public.cart_items as ci (cart_id, product_id, quantity)
  values (v_cart_id, p_product_id, p_quantity)
  on conflict (cart_id, product_id)
  do update
  set
    quantity = ci.quantity + excluded.quantity,
    updated_at = now()
  where ci.quantity + excluded.quantity <= v_limit
  returning quantity into v_new_quantity;

  if v_new_quantity is null then
    raise exception 'Insufficient stock';
  end if;

  return v_new_quantity;
end;
$$;


create or replace function public.change_cart_quantity(p_product_id uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_cart_id uuid;
  v_current_quantity integer;
  v_new_quantity integer;
  v_limit integer;
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Quantity change cannot be zero';
  end if;

  if private.current_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  select c.id
  into v_cart_id
  from public.carts as c
  where c.customer_id = v_customer_id;

  if not found then
    raise exception 'Cart not found';
  end if;

  select
    ci.quantity,
    case
      when p.availability = 'COMING_SOON' then private.max_preorder_quantity()
      else p.stock
    end
  into
    v_current_quantity,
    v_limit
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  where ci.cart_id = v_cart_id
    and ci.product_id = p_product_id
    and private.is_product_available(p.id)
  for update of ci, p;

  if not found then
    raise exception 'Cart item not found';
  end if;

  v_new_quantity := v_current_quantity + p_delta;

  if v_new_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  -- Lowering is always allowed (also when stock dropped below the cart).
  if p_delta > 0 and v_new_quantity > v_limit then
    raise exception 'Insufficient stock';
  end if;

  update public.cart_items
  set
    quantity = v_new_quantity,
    updated_at = now()
  where cart_id = v_cart_id
    and product_id = p_product_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  return v_new_quantity;
end;
$$;


-- Cart lines with their part (is_preorder decided by the product).
drop function if exists public.get_customer_cart();

create function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity integer,
  unit_price numeric,
  regular_price numeric,
  line_total numeric,
  stock integer,
  available boolean,
  is_preorder boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    x.product_id,
    x.sku,
    x.name,
    x.quantity,
    x.unit_price,
    x.regular_price,
    x.quantity * x.unit_price,
    x.stock,
    x.available,
    x.is_preorder
  from (
    select
      p.id as product_id,
      p.sku,
      p.name,
      ci.quantity,
      ci.created_at,
      private.effective_price(cp.price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as unit_price,
      private.group_price(cp.price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      p.stock,
      private.is_product_available(p.id) as available,
      p.availability = 'COMING_SOON' as is_preorder
    from public.customer_profiles as cp
    join public.carts as c
      on c.customer_id = cp.id
    join public.cart_items as ci
      on ci.cart_id = c.id
    join public.products as p
      on p.id = ci.product_id
    join public.product_prices as pp
      on pp.product_id = p.id
    where cp.id = (select auth.uid())
      and cp.active = true
      and cp.archived_at is null
      and cp.must_change_password = false
      and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  ) as x
  order by x.created_at;
$$;

revoke execute on function public.get_customer_cart() from public, anon;
grant execute on function public.get_customer_cart() to authenticated;


-- One order from one part of the cart. Lines of the other part stay in
-- the cart for a second order.
create function public.create_order_from_cart(p_order_type public.order_type)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_price_group public.customer_price_group;
  v_cart_id uuid;
  v_order_id uuid;
  v_total numeric(12, 2);
  v_preorder boolean := p_order_type = 'PREORDER';
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if p_order_type is null then
    raise exception 'Invalid order type';
  end if;

  v_price_group := private.current_customer_price_group();

  if v_price_group is null then
    raise exception 'Active customer profile required';
  end if;

  select c.id
  into v_cart_id
  from public.carts as c
  where c.customer_id = v_customer_id
  for update;

  if not found then
    raise exception 'Cart is empty';
  end if;

  -- Lock the cart lines, products and prices first, then decide the part
  -- of each line from the locked product rows.
  perform 1
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id
  order by p.id
  for update of ci, p, pp;

  drop table if exists pg_temp.checkout_lines;

  create temporary table checkout_lines on commit drop as
  select ci.product_id, ci.quantity
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  where ci.cart_id = v_cart_id
    and (p.availability = 'COMING_SOON') = v_preorder;

  if not exists (select 1 from pg_temp.checkout_lines) then
    raise exception 'Cart is empty';
  end if;

  if exists (
    select 1
    from pg_temp.checkout_lines as l
    left join public.product_prices as pp
      on pp.product_id = l.product_id
    where pp.product_id is null
       or not private.is_product_available(l.product_id)
  ) then
    raise exception 'Cart contains unavailable product';
  end if;

  -- Normal order: every line must be in stock (unchanged rule).
  if not v_preorder and exists (
    select 1
    from pg_temp.checkout_lines as l
    join public.products as p
      on p.id = l.product_id
    where l.quantity > p.stock
  ) then
    raise exception 'Insufficient stock';
  end if;

  select sum(
    l.quantity *
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
  )
  into v_total
  from pg_temp.checkout_lines as l
  join public.product_prices as pp
    on pp.product_id = l.product_id;

  insert into public.orders (customer_id, total_amount, order_type)
  values (v_customer_id, v_total, p_order_type)
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_id, sku, quantity, unit_price, line_total
  )
  select
    v_order_id,
    p.id,
    p.sku,
    l.quantity,
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price),
    l.quantity *
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
  from pg_temp.checkout_lines as l
  join public.products as p
    on p.id = l.product_id
  join public.product_prices as pp
    on pp.product_id = p.id;

  -- Only a normal order takes stock.
  if not v_preorder then
    update public.products as p
    set
      stock = p.stock - l.quantity,
      updated_at = now()
    from pg_temp.checkout_lines as l
    where p.id = l.product_id;
  end if;

  delete from public.cart_items as ci
  using pg_temp.checkout_lines as l
  where ci.cart_id = v_cart_id
    and ci.product_id = l.product_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  drop table if exists pg_temp.checkout_lines;

  return v_order_id;
end;
$$;

revoke execute on function public.create_order_from_cart(public.order_type) from public, anon;
grant execute on function public.create_order_from_cart(public.order_type) to authenticated;


-- The old call (no argument) keeps working and creates a normal order
-- from the in-stock part only.
create or replace function public.create_order_from_cart()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.create_order_from_cart('STANDARD'::public.order_type);
$$;


-- ---------------------------------------------------------------------------
-- 4. Staff order changes respect pre-orders
-- ---------------------------------------------------------------------------

-- Cancelling a pre-order returns nothing to stock (nothing was taken).
create or replace function public.update_admin_order_status(p_order_id uuid, p_status public.order_status)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status public.order_status;
  v_type public.order_type;
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to update orders';
  end if;

  select o.status, o.order_type
  into v_current_status, v_type
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

  update public.order_revisions
  set status = 'SUPERSEDED', updated_at = now()
  where order_id = p_order_id
    and status in ('DRAFT', 'AWAITING_CUSTOMER');

  if p_status = 'CANCELLED' and v_type = 'STANDARD' then
    update public.products as p
    set
      stock = p.stock + oi.quantity,
      updated_at = now()
    from public.order_items as oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
  end if;

  update public.orders
  set
    status = p_status,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, before, after
  )
  values (
    p_order_id,
    gen_random_uuid(),
    (select auth.uid()),
    'STATUS_CHANGED',
    jsonb_build_object('status', v_current_status),
    jsonb_build_object('status', p_status)
  );

  return p_status;
end;
$$;


-- Same as before for normal orders. For a pre-order: no stock check, no
-- stock movement, and new lines must be COMING_SOON products.
create or replace function public.update_admin_order_items(
  p_order_id uuid,
  p_items jsonb,
  p_expected_updated_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_group public.customer_price_group;
  v_item jsonb;
  v_count integer;
  v_changes integer;
  v_change_id uuid := gen_random_uuid();
  v_short_sku text;
  v_old_total numeric(12, 2);
  v_new_total numeric(12, 2);
  v_preorder boolean;
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid order items';
  end if;

  v_count := jsonb_array_length(p_items);

  if v_count = 0 then
    raise exception 'Order must have at least one product';
  end if;

  if v_count > 200 then
    raise exception 'Invalid order items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid order items';
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,6}$'
       or (v_item ->> 'quantity')::integer not between 1 and 100000 then
      raise exception 'Invalid quantity';
    end if;

    if jsonb_typeof(v_item -> 'unit_price') not in ('null')
       and coalesce(v_item ->> 'unit_price', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
      raise exception 'Invalid price';
    end if;
  end loop;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'PENDING' then
    raise exception 'Only pending orders can be edited';
  end if;

  v_preorder := v_order.order_type = 'PREORDER';

  select cp.price_group into v_group
  from public.customer_profiles as cp
  where cp.id = v_order.customer_id;

  drop table if exists pg_temp.order_edit_items;

  create temporary table order_edit_items (
    product_id uuid primary key,
    quantity integer not null,
    unit_price numeric(12, 2)
  ) on commit drop;

  begin
    insert into pg_temp.order_edit_items (product_id, quantity, unit_price)
    select
      (e ->> 'product_id')::uuid,
      (e ->> 'quantity')::integer,
      round((e ->> 'unit_price')::numeric, 2)
    from jsonb_array_elements(p_items) as e;
  exception
    when unique_violation then
      raise exception 'Duplicate product';
  end;

  if exists (
    select 1
    from pg_temp.order_edit_items as n
    left join public.products as p on p.id = n.product_id
    where p.id is null
  ) then
    raise exception 'Product not found';
  end if;

  -- A product that is not in the order yet must be on sale.
  if exists (
    select 1
    from pg_temp.order_edit_items as n
    where not exists (
        select 1 from public.order_items as oi
        where oi.order_id = p_order_id and oi.product_id = n.product_id
      )
      and not private.is_product_available(n.product_id)
  ) then
    raise exception 'Product is not available';
  end if;

  -- A pre-order only takes "Tezliklə stokda" products as new lines.
  if v_preorder and exists (
    select 1
    from pg_temp.order_edit_items as n
    join public.products as p on p.id = n.product_id
    where p.availability <> 'COMING_SOON'
      and not exists (
        select 1 from public.order_items as oi
        where oi.order_id = p_order_id and oi.product_id = n.product_id
      )
  ) then
    raise exception 'Only coming soon products can be pre-ordered';
  end if;

  -- Lock every product whose stock may change, in a fixed order.
  perform 1
  from public.products as p
  where p.id in (
    select oi.product_id from public.order_items as oi where oi.order_id = p_order_id
    union
    select n.product_id from pg_temp.order_edit_items as n
  )
  order by p.id
  for update;

  update pg_temp.order_edit_items as n
  set unit_price = coalesce(
    (
      select oi.unit_price from public.order_items as oi
      where oi.order_id = p_order_id and oi.product_id = n.product_id
    ),
    (
      select private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
      from public.product_prices as pp
      where pp.product_id = n.product_id
    )
  )
  where n.unit_price is null;

  if exists (select 1 from pg_temp.order_edit_items as n where n.unit_price is null) then
    raise exception 'Invalid price';
  end if;

  select count(*)
  into v_changes
  from (
    select coalesce(c.product_id, n.product_id)
    from (
      select oi.product_id, oi.quantity, oi.unit_price
      from public.order_items as oi
      where oi.order_id = p_order_id
    ) as c
    full join pg_temp.order_edit_items as n
      on n.product_id = c.product_id
    where c.product_id is null
       or n.product_id is null
       or c.quantity <> n.quantity
       or c.unit_price <> n.unit_price
  ) as d;

  if v_changes = 0 then
    return 0;
  end if;

  if p_expected_updated_at is not null
     and v_order.updated_at <> p_expected_updated_at then
    raise exception 'Order was changed by someone else';
  end if;

  -- Enough stock for every increase? (normal orders only)
  if not v_preorder then
    select p.sku into v_short_sku
    from (
      select coalesce(c.product_id, n.product_id) as product_id,
             coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
      from (
        select oi.product_id, oi.quantity
        from public.order_items as oi
        where oi.order_id = p_order_id
      ) as c
      full join pg_temp.order_edit_items as n
        on n.product_id = c.product_id
    ) as d
    join public.products as p on p.id = d.product_id
    where d.delta > 0
      and p.stock < d.delta
    order by p.sku
    limit 1;

    if v_short_sku is not null then
      raise exception 'Insufficient stock for %', v_short_sku;
    end if;
  end if;

  v_old_total := v_order.total_amount;

  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, product_id, sku,
    product_name, before, after
  )
  select
    p_order_id,
    v_change_id,
    (select auth.uid()),
    case
      when c.product_id is null then 'ITEM_ADDED'
      when n.product_id is null then 'ITEM_REMOVED'
      else 'ITEM_UPDATED'
    end,
    p.id,
    coalesce(c.sku, p.sku),
    p.name,
    case when c.product_id is not null then
      jsonb_build_object('quantity', c.quantity, 'unit_price', c.unit_price, 'line_total', c.line_total)
    end,
    case when n.product_id is not null then
      jsonb_build_object('quantity', n.quantity, 'unit_price', n.unit_price, 'line_total', round(n.quantity * n.unit_price, 2))
    end
  from (
    select oi.product_id, oi.sku, oi.quantity, oi.unit_price, oi.line_total
    from public.order_items as oi
    where oi.order_id = p_order_id
  ) as c
  full join pg_temp.order_edit_items as n
    on n.product_id = c.product_id
  join public.products as p
    on p.id = coalesce(c.product_id, n.product_id)
  where c.product_id is null
     or n.product_id is null
     or c.quantity <> n.quantity
     or c.unit_price <> n.unit_price;

  -- Stock: only the difference, and only for normal orders.
  if not v_preorder then
    update public.products as p
    set stock = p.stock - d.delta,
        updated_at = now()
    from (
      select coalesce(c.product_id, n.product_id) as product_id,
             coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
      from (
        select oi.product_id, oi.quantity
        from public.order_items as oi
        where oi.order_id = p_order_id
      ) as c
      full join pg_temp.order_edit_items as n
        on n.product_id = c.product_id
    ) as d
    where p.id = d.product_id
      and d.delta <> 0;
  end if;

  delete from public.order_items as oi
  where oi.order_id = p_order_id
    and not exists (
      select 1 from pg_temp.order_edit_items as n where n.product_id = oi.product_id
    );

  update public.order_items as oi
  set quantity = n.quantity,
      unit_price = n.unit_price,
      line_total = round(n.quantity * n.unit_price, 2)
  from pg_temp.order_edit_items as n
  where oi.order_id = p_order_id
    and oi.product_id = n.product_id
    and (oi.quantity <> n.quantity or oi.unit_price <> n.unit_price);

  insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
  select p_order_id, n.product_id, p.sku, n.quantity, n.unit_price, round(n.quantity * n.unit_price, 2)
  from pg_temp.order_edit_items as n
  join public.products as p on p.id = n.product_id
  where not exists (
    select 1 from public.order_items as oi
    where oi.order_id = p_order_id and oi.product_id = n.product_id
  );

  select coalesce(sum(oi.line_total), 0) into v_new_total
  from public.order_items as oi
  where oi.order_id = p_order_id;

  update public.orders
  set total_amount = v_new_total, updated_at = now()
  where id = p_order_id;

  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, before, after
  )
  values (
    p_order_id,
    v_change_id,
    (select auth.uid()),
    'ORDER_UPDATED',
    jsonb_build_object('total', v_old_total),
    jsonb_build_object('total', v_new_total)
  );

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    'order_items_updated',
    'order',
    p_order_id::text,
    jsonb_build_object('change_id', v_change_id, 'changes', v_changes)
  );

  drop table if exists pg_temp.order_edit_items;

  return v_changes;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Lists with availability / order type
-- ---------------------------------------------------------------------------

drop function if exists public.get_customer_catalog_page(integer, integer, text, text, text, boolean, boolean);

create function public.get_customer_catalog_page(
  p_page integer default 1,
  p_page_size integer default 24,
  p_category_slug text default null,
  p_search text default null,
  p_sort text default 'name',
  p_include_subcategories boolean default true,
  p_on_sale boolean default false
)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
  category_id uuid,
  category_name text,
  category_slug text,
  primary_image_path text,
  availability public.product_availability,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_price_group public.customer_price_group := private.active_customer_price_group();
  v_size integer := least(greatest(coalesce(p_page_size, 24), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
  v_sort text := coalesce(p_sort, 'name');
  v_on_sale boolean := coalesce(p_on_sale, false);
  v_category_id uuid;
begin
  if v_price_group is null then
    raise exception 'Active customer profile required';
  end if;

  if v_sort not in ('name', 'price_asc', 'price_desc', 'newest', 'sku') then
    v_sort := 'name';
  end if;

  if nullif(trim(p_category_slug), '') is not null then
    select c.id
    into v_category_id
    from public.categories as c
    where c.slug = trim(p_category_slug)
      and private.is_category_available(c.id);

    if v_category_id is null then
      return;
    end if;
  end if;

  return query
  with available_categories as materialized (
    select a.id from private.available_category_ids() as a(id)
  ),
  filter_categories as (
    select s.id
    from private.category_subtree(v_category_id) as s(id)
    where v_category_id is not null
      and coalesce(p_include_subcategories, true)

    union

    select v_category_id
    where v_category_id is not null
  ),
  priced as (
    select
      p.id,
      p.sku,
      p.name,
      p.stock,
      p.category_id,
      p.created_at,
      p.availability,
      private.group_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price
    from public.products as p
    join public.product_prices as pp
      on pp.product_id = p.id
    where p.active = true
      and (not v_on_sale or pp.sale_price is not null)
      and (
        p.category_id is null
        or p.category_id in (select ac.id from available_categories as ac)
      )
      and (
        v_category_id is null
        or p.category_id in (select fc.id from filter_categories as fc)
      )
      and (
        v_search is null
        or p.name ilike private.like_pattern(v_search)
        or p.sku ilike private.like_pattern(v_search)
      )
  ),
  filtered as materialized (
    select pr.*, pr.price < pr.regular_price as on_sale
    from priced as pr
    where not v_on_sale or pr.price < pr.regular_price
  ),
  page as (
    select f.*
    from filtered as f
    order by
      case when v_sort = 'name' then f.name end,
      case when v_sort = 'sku' then f.sku end,
      case when v_sort = 'price_asc' then f.price end,
      case when v_sort = 'price_desc' then f.price end desc,
      case when v_sort = 'newest' then f.created_at end desc,
      f.id
    limit v_size
    offset (v_page - 1) * v_size
  )
  select
    pg.id,
    pg.sku,
    pg.name,
    pg.stock,
    pg.price,
    pg.regular_price,
    pg.on_sale,
    c.id,
    c.name,
    c.slug,
    pm.storage_path,
    pg.availability,
    (select count(*) from filtered)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  left join public.product_media as pm
    on pm.product_id = pg.id
    and pm.media_type = 'IMAGE'
    and pm.is_primary = true
  order by
    case when v_sort = 'name' then pg.name end,
    case when v_sort = 'sku' then pg.sku end,
    case when v_sort = 'price_asc' then pg.price end,
    case when v_sort = 'price_desc' then pg.price end desc,
    case when v_sort = 'newest' then pg.created_at end desc,
    pg.id;
end;
$$;

revoke execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean, boolean) to authenticated;


drop function if exists public.get_customer_product(uuid);

create function public.get_customer_product(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
  category_id uuid,
  category_name text,
  category_slug text,
  availability public.product_availability
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_price_group public.customer_price_group := private.active_customer_price_group();
begin
  if v_price_group is null then
    raise exception 'Active customer profile required';
  end if;

  return query
  select
    x.id, x.sku, x.name, x.description, x.stock,
    x.price, x.regular_price, x.price < x.regular_price,
    x.category_id, x.category_name, x.category_slug, x.availability
  from (
    select
      p.id,
      p.sku,
      p.name,
      p.description,
      p.stock,
      private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price,
      private.group_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      c.id as category_id,
      c.name as category_name,
      c.slug as category_slug,
      p.availability
    from public.products as p
    join public.product_prices as pp
      on pp.product_id = p.id
    left join public.categories as c
      on c.id = p.category_id
    where p.id = p_product_id
      and p.active = true
      and (
        p.category_id is null
        or private.is_category_available(p.category_id)
      )
  ) as x;
end;
$$;

revoke execute on function public.get_customer_product(uuid) from public, anon;
grant execute on function public.get_customer_product(uuid) to authenticated;


-- Favorites: + availability (pre-order button for COMING_SOON).
drop function if exists public.get_customer_favorites_page(integer, integer);

create function public.get_customer_favorites_page(
  p_page integer default 1,
  p_page_size integer default 24
)
returns table (
  id uuid,
  sku text,
  name text,
  available boolean,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
  category_name text,
  primary_image_path text,
  favorited_at timestamptz,
  availability public.product_availability,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.customer_price_group := private.active_customer_price_group();
  v_size integer := least(greatest(coalesce(p_page_size, 24), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
begin
  if v_group is null then
    raise exception 'Active customer profile required';
  end if;

  return query
  with mine as materialized (
    select f.product_id, f.created_at
    from public.customer_favorites as f
    where f.customer_id = (select auth.uid())
  ),
  page as (
    select m.*
    from mine as m
    order by m.created_at desc, m.product_id
    limit v_size
    offset (v_page - 1) * v_size
  ),
  detail as (
    select
      p.id,
      p.sku,
      p.name,
      private.is_product_available(p.id) and pp.product_id is not null as available,
      p.stock,
      p.availability,
      private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price,
      private.group_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      c.name as category_name,
      pm.storage_path,
      pg.created_at
    from page as pg
    join public.products as p
      on p.id = pg.product_id
    left join public.product_prices as pp
      on pp.product_id = p.id
    left join public.categories as c
      on c.id = p.category_id
    left join public.product_media as pm
      on pm.product_id = p.id
      and pm.media_type = 'IMAGE'
      and pm.is_primary = true
  )
  select
    r.id,
    r.sku,
    r.name,
    r.available,
    case when r.available then r.stock end,
    case when r.available then r.price end,
    case when r.available then r.regular_price end,
    r.available and r.price < r.regular_price,
    case when r.available then r.category_name end,
    r.storage_path,
    r.created_at,
    r.availability,
    (select count(*) from mine)
  from detail as r
  order by r.created_at desc, r.id;
end;
$$;

revoke execute on function public.get_customer_favorites_page(integer, integer) from public, anon;
grant execute on function public.get_customer_favorites_page(integer, integer) to authenticated;


-- Customer orders: + order type.
drop function if exists public.get_customer_orders();

create function public.get_customer_orders()
returns table (
  order_id uuid,
  status public.order_status,
  total_amount numeric,
  created_at timestamptz,
  payment_status public.payment_status,
  payment_reported_at timestamptz,
  order_type public.order_type
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
    o.payment_reported_at,
    o.order_type
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


-- Admin order list: + order type column and filter (STANDARD / PREORDER).
drop function if exists public.get_admin_orders_page(integer, integer, text, text, text);

create function public.get_admin_orders_page(
  p_page integer default 1,
  p_page_size integer default 50,
  p_status text default null,
  p_payment text default null,
  p_search text default null,
  p_type text default null
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
  order_type public.order_type,
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
      o.order_type, o.total_amount, o.created_at, o.updated_at
    from public.orders as o
    left join public.customer_profiles as cp
      on cp.id = o.customer_id
    where (p_status is null or o.status::text = p_status)
      and (p_type is null or o.order_type::text = p_type)
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
    pg.order_type,
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

revoke execute on function public.get_admin_orders_page(integer, integer, text, text, text, text) from public, anon;
grant execute on function public.get_admin_orders_page(integer, integer, text, text, text, text) to authenticated;


drop function if exists public.get_admin_order_counts();

create function public.get_admin_order_counts()
returns table (
  total bigint,
  pending bigint,
  confirmed bigint,
  cancelled bigint,
  payment_reported bigint,
  unpaid bigint,
  paid bigint,
  rejected bigint,
  standard bigint,
  preorder bigint
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
    count(*) filter (where o.payment_status = 'REJECTED'),
    count(*) filter (where o.order_type = 'STANDARD'),
    count(*) filter (where o.order_type = 'PREORDER')
  from public.orders as o;
end;
$$;

revoke execute on function public.get_admin_order_counts() from public, anon;
grant execute on function public.get_admin_order_counts() to authenticated;


drop function if exists public.get_admin_order(uuid);

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
  order_type public.order_type,
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
    o.order_type,
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


-- Admin product: + availability (all staff who may see products).
drop function if exists public.get_admin_product(uuid);

create function public.get_admin_product(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  active boolean,
  category_id uuid,
  category_name text,
  normal_price numeric,
  dealer_price numeric,
  vip_price numeric,
  sale_price numeric,
  availability public.product_availability
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prices boolean := private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]);
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view admin products';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.stock,
    p.active,
    p.category_id,
    c.name,
    case when v_prices then pp.normal_price end,
    case when v_prices then pp.dealer_price end,
    case when v_prices then pp.vip_price end,
    case when v_prices then pp.sale_price end,
    p.availability
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_prices as pp
    on pp.product_id = p.id
  where p.id = p_product_id;
end;
$$;

revoke execute on function public.get_admin_product(uuid) from public, anon;
grant execute on function public.get_admin_product(uuid) to authenticated;


-- Products a staff member can add to a pending order: a pre-order only
-- offers COMING_SOON products.
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
  v_type public.order_type;
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select cp.price_group, o.order_type into v_group, v_type
  from public.orders as o
  join public.customer_profiles as cp on cp.id = o.customer_id
  where o.id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  return query
  select p.id, p.sku, p.name, p.stock, p.active,
    private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
  from public.products as p
  join public.product_prices as pp on pp.product_id = p.id
  where private.is_product_available(p.id)
    and (v_type <> 'PREORDER' or p.availability = 'COMING_SOON')
    and (
      v_search is null
      or p.name ilike private.like_pattern(v_search)
      or p.sku ilike private.like_pattern(v_search)
    )
  order by p.name, p.sku
  limit 20;
end;
$$;


-- Admin product list: + availability; p_status 'coming_soon' lists the
-- "Tezliklə stokda" products.
drop function if exists public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text);

create function public.get_admin_products_page(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default null,
  p_category_id uuid default null,
  p_status text default null,
  p_low_stock boolean default false,
  p_sort text default 'newest'
)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  active boolean,
  category_id uuid,
  category_name text,
  normal_price numeric,
  sale_price numeric,
  has_group_prices boolean,
  primary_image_path text,
  availability public.product_availability,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prices boolean := private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
  v_sort text := coalesce(p_sort, 'newest');
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view admin products';
  end if;

  if v_sort not in ('newest', 'name', 'sku', 'stock') then
    v_sort := 'newest';
  end if;

  return query
  with filtered as materialized (
    select p.id, p.sku, p.name, p.stock, p.active, p.category_id, p.created_at, p.availability
    from public.products as p
    where (
        p_category_id is null
        or p.category_id in (select s from private.category_subtree(p_category_id) as s)
      )
      and (
        p_status is null
        or (p_status = 'active' and p.active = true)
        or (p_status = 'inactive' and p.active = false)
        or (p_status = 'coming_soon' and p.availability = 'COMING_SOON')
        or (
          p_status = 'sale'
          and v_prices
          and exists (
            select 1 from public.product_prices as sp
            where sp.product_id = p.id and sp.sale_price is not null
          )
        )
      )
      and (
        coalesce(p_low_stock, false) = false
        or (p.active = true and p.stock <= 5 and p.availability = 'IN_STOCK')
      )
      and (
        v_search is null
        or p.name ilike private.like_pattern(v_search)
        or p.sku ilike private.like_pattern(v_search)
      )
  ),
  page as (
    select f.*
    from filtered as f
    order by
      case when v_sort = 'name' then f.name end,
      case when v_sort = 'sku' then f.sku end,
      case when v_sort = 'stock' then f.stock end,
      case when v_sort = 'newest' then f.created_at end desc,
      f.id
    limit v_size
    offset (v_page - 1) * v_size
  )
  select
    pg.id,
    pg.sku,
    pg.name,
    pg.stock,
    pg.active,
    pg.category_id,
    c.name,
    case when v_prices then pp.normal_price end,
    case when v_prices then pp.sale_price end,
    case when v_prices then (pp.dealer_price is not null or pp.vip_price is not null) end,
    pm.storage_path,
    pg.availability,
    (select count(*) from filtered)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  left join public.product_prices as pp
    on pp.product_id = pg.id
  left join public.product_media as pm
    on pm.product_id = pg.id
    and pm.media_type = 'IMAGE'
    and pm.is_primary = true
  order by
    case when v_sort = 'name' then pg.name end,
    case when v_sort = 'sku' then pg.sku end,
    case when v_sort = 'stock' then pg.stock end,
    case when v_sort = 'newest' then pg.created_at end desc,
    pg.id;
end;
$$;

revoke execute on function public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text) from public, anon;
grant execute on function public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text) to authenticated;


-- Customer card in admin: + order type.
drop function if exists public.get_admin_customer_orders(uuid, integer);

create function public.get_admin_customer_orders(p_customer_id uuid, p_limit integer default 20)
returns table (
  order_id uuid,
  status public.order_status,
  payment_status public.payment_status,
  total_amount numeric,
  created_at timestamptz,
  order_type public.order_type
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
  select o.id, o.status, o.payment_status, o.total_amount, o.created_at, o.order_type
  from public.orders as o
  where o.customer_id = p_customer_id
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

revoke execute on function public.get_admin_customer_orders(uuid, integer) from public, anon;
grant execute on function public.get_admin_customer_orders(uuid, integer) to authenticated;
