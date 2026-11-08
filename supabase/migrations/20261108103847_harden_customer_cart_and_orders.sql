-- Cart, order and product media RPCs use the same rules as the paginated
-- catalog:
--   * the caller must be an active, non-archived customer;
--   * a product is available only when it is active and its category and
--     every ancestor category are active (private.is_category_available).
-- Prices still come from the caller's price group in the database.
--
-- No MFA/aal2 check is added here: a password session is enough.
-- Function signatures and grants are unchanged.


-- Price group of the calling customer, or null when the caller is not an
-- active, non-archived customer. Unlike active_customer_price_group() it
-- has no MFA rule.
create or replace function private.current_customer_price_group()
returns public.customer_price_group
language sql
stable
security definer
set search_path = ''
as $$
  select cp.price_group
  from public.customer_profiles as cp
  where cp.id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null;
$$;


-- Active product whose category tree is fully active (or no category).
create or replace function private.is_product_available(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.products as p
    where p.id = p_product_id
      and p.active = true
      and (
        p.category_id is null
        or private.is_category_available(p.category_id)
      )
  );
$$;

revoke all on function private.current_customer_price_group() from public, anon;
revoke all on function private.is_product_available(uuid) from public, anon;
grant execute on function private.current_customer_price_group() to authenticated, service_role;
grant execute on function private.is_product_available(uuid) to authenticated, service_role;


create or replace function public.add_to_cart(p_product_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_cart_id uuid;
  v_stock integer;
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

  select p.stock
  into v_stock
  from public.products as p
  where p.id = p_product_id
    and private.is_product_available(p.id)
  for update of p;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_quantity > v_stock then
    raise exception 'Insufficient stock';
  end if;

  insert into public.carts (
    customer_id
  )
  values (
    v_customer_id
  )
  on conflict (customer_id)
  do update
  set updated_at = now()
  returning id into v_cart_id;

  insert into public.cart_items as ci (
    cart_id,
    product_id,
    quantity
  )
  values (
    v_cart_id,
    p_product_id,
    p_quantity
  )
  on conflict (cart_id, product_id)
  do update
  set
    quantity = ci.quantity + excluded.quantity,
    updated_at = now()
  where ci.quantity + excluded.quantity <= v_stock
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
  v_stock integer;
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
    p.stock
  into
    v_current_quantity,
    v_stock
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

  if v_new_quantity > v_stock then
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


-- Removing a line stays possible for unavailable products, so customers
-- can clean up their cart.
create or replace function public.remove_from_cart(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_deleted_id uuid;
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if private.current_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  delete from public.cart_items as ci
  using public.carts as c
  where ci.cart_id = c.id
    and c.customer_id = v_customer_id
    and ci.product_id = p_product_id
  returning ci.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Cart item not found';
  end if;
end;
$$;


create or replace function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  stock integer,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as product_id,
    p.sku,
    p.name,
    ci.quantity,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as unit_price,
    (
      ci.quantity *
      case cp.price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    ) as line_total,
    p.stock,
    private.is_product_available(p.id) as available
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
  order by ci.created_at;
$$;


create or replace function public.create_order_from_cart()
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
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
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

  if not exists (
    select 1
    from public.cart_items as ci
    where ci.cart_id = v_cart_id
  ) then
    raise exception 'Cart is empty';
  end if;

  -- Lock cart rows, products and prices while the order is created.
  perform 1
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id
  order by p.id
  for update of ci, p, pp;

  -- Reject inactive products, products in an inactive category tree and
  -- products without prices.
  if exists (
    select 1
    from public.cart_items as ci
    left join public.product_prices as pp
      on pp.product_id = ci.product_id
    where ci.cart_id = v_cart_id
      and (
        pp.product_id is null
        or not private.is_product_available(ci.product_id)
      )
  ) then
    raise exception 'Cart contains unavailable product';
  end if;

  if exists (
    select 1
    from public.cart_items as ci
    join public.products as p
      on p.id = ci.product_id
    where ci.cart_id = v_cart_id
      and ci.quantity > p.stock
  ) then
    raise exception 'Insufficient stock';
  end if;

  -- Total is calculated in the database from the customer's real group.
  select
    sum(
      ci.quantity *
      case v_price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    )
  into v_total
  from public.cart_items as ci
  join public.product_prices as pp
    on pp.product_id = ci.product_id
  where ci.cart_id = v_cart_id;

  insert into public.orders (
    customer_id,
    total_amount
  )
  values (
    v_customer_id,
    v_total
  )
  returning id into v_order_id;

  -- SKU and prices are stored as a snapshot.
  insert into public.order_items (
    order_id,
    product_id,
    sku,
    quantity,
    unit_price,
    line_total
  )
  select
    v_order_id,
    p.id,
    p.sku,
    ci.quantity,
    case v_price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end,
    ci.quantity *
    case v_price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id;

  update public.products as p
  set
    stock = p.stock - ci.quantity,
    updated_at = now()
  from public.cart_items as ci
  where ci.cart_id = v_cart_id
    and p.id = ci.product_id;

  delete from public.cart_items
  where cart_id = v_cart_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  return v_order_id;
end;
$$;


create or replace function public.get_customer_orders()
returns table (
  order_id uuid,
  status public.order_status,
  total_amount numeric,
  created_at timestamptz
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
    o.created_at
  from public.orders as o
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  where o.customer_id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
  order by o.created_at desc;
$$;


create or replace function public.get_customer_order_items(p_order_id uuid)
returns table (
  product_id uuid,
  sku text,
  quantity integer,
  unit_price numeric,
  line_total numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.product_id,
    oi.sku,
    oi.quantity,
    oi.unit_price,
    oi.line_total
  from public.order_items as oi
  join public.orders as o
    on o.id = oi.order_id
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  where oi.order_id = p_order_id
    and o.customer_id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
  order by oi.created_at;
$$;


create or replace function public.get_customer_product_media(p_product_id uuid)
returns table (
  id uuid,
  media_type text,
  storage_path text,
  original_name text,
  mime_type text,
  is_primary boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_customer_price_group() is null then
    raise exception 'Not authorized to view product media';
  end if;

  if not private.is_product_available(p_product_id) then
    raise exception 'Product not available';
  end if;

  return query
  select
    pm.id,
    pm.media_type,
    pm.storage_path,
    pm.original_name,
    pm.mime_type,
    pm.is_primary,
    pm.sort_order
  from public.product_media as pm
  where pm.product_id = p_product_id
  order by
    case
      when pm.media_type = 'IMAGE' then 0
      else 1
    end,
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;
