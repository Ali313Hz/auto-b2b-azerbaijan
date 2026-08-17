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
  where p.id = p_product_id
    and p.active = true
  for update;

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


create or replace function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  stock integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as product_id,
    p.sku,
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
    p.stock
  from public.customer_profiles as cp
  join public.carts as c
    on c.customer_id = cp.id
  join public.cart_items as ci
    on ci.cart_id = c.id
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where cp.id = auth.uid()
    and cp.active = true
    and p.active = true
  order by ci.created_at;
$$;


revoke execute
on function public.add_to_cart(uuid, integer)
from public, anon;

grant execute
on function public.add_to_cart(uuid, integer)
to authenticated;


revoke execute
on function public.get_customer_cart()
from public, anon;

grant execute
on function public.get_customer_cart()
to authenticated;