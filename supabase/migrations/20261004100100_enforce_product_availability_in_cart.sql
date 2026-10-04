-- A product is orderable only when it is active and its category (if any)
-- is active. The catalog already applies this rule; cart and order
-- functions now apply it too, and the cart returns unavailable rows with a
-- flag so customers can see and remove them instead of being blocked.

create or replace function public.add_to_cart(
  p_product_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
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

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
    raise exception 'Active customer profile required';
  end if;

  select p.stock
  into v_stock
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  where p.id = p_product_id
    and p.active = true
    and (
      p.category_id is null
      or c.active = true
    )
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


create or replace function public.change_cart_quantity(
  p_product_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
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

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
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
  left join public.categories as cat
    on cat.id = p.category_id
  where ci.cart_id = v_cart_id
    and ci.product_id = p_product_id
    and p.active = true
    and (
      p.category_id is null
      or cat.active = true
    )
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


-- Return type changes (adds name and available), so the function is
-- recreated.
drop function if exists public.get_customer_cart();

create function public.get_customer_cart()
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
    (
      p.active = true
      and (
        p.category_id is null
        or cat.active = true
      )
    ) as available
  from public.customer_profiles as cp
  join public.carts as c
    on c.customer_id = cp.id
  join public.cart_items as ci
    on ci.cart_id = c.id
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  left join public.categories as cat
    on cat.id = p.category_id
  where cp.id = auth.uid()
    and cp.active = true
  order by ci.created_at;
$$;

revoke execute
on function public.get_customer_cart()
from public, anon;

grant execute
on function public.get_customer_cart()
to authenticated;


create or replace function public.create_order_from_cart()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_price_group public.customer_price_group;
  v_cart_id uuid;
  v_order_id uuid;
  v_total numeric(12, 2);
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  select cp.price_group
  into v_price_group
  from public.customer_profiles as cp
  where cp.id = v_customer_id
    and cp.active = true;

  if not found then
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

  -- Reject inactive products, products in inactive categories and
  -- products without prices.
  if exists (
    select 1
    from public.cart_items as ci
    left join public.products as p
      on p.id = ci.product_id
    left join public.product_prices as pp
      on pp.product_id = ci.product_id
    left join public.categories as cat
      on cat.id = p.category_id
    where ci.cart_id = v_cart_id
      and (
        p.id is null
        or p.active = false
        or pp.product_id is null
        or (
          p.category_id is not null
          and cat.active is distinct from true
        )
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
