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
  where ci.cart_id = v_cart_id
    and ci.product_id = p_product_id
    and p.active = true
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


create or replace function public.remove_from_cart(
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_deleted_id uuid;
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
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


revoke execute
on function public.change_cart_quantity(uuid, integer)
from public, anon;

grant execute
on function public.change_cart_quantity(uuid, integer)
to authenticated;


revoke execute
on function public.remove_from_cart(uuid)
from public, anon;

grant execute
on function public.remove_from_cart(uuid)
to authenticated;