create or replace function public.update_admin_product(
  p_product_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to update products';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  update public.products
  set
    stock = p_stock,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  update public.product_prices
  set
    normal_price = p_normal_price,
    dealer_price = p_dealer_price,
    vip_price = p_vip_price,
    updated_at = now()
  where product_id = p_product_id;

  if not found then
    raise exception 'Product prices not found';
  end if;
end;
$$;

revoke execute
on function public.update_admin_product(
  uuid,
  integer,
  numeric,
  numeric,
  numeric
)
from public, anon;

grant execute
on function public.update_admin_product(
  uuid,
  integer,
  numeric,
  numeric,
  numeric
)
to authenticated;