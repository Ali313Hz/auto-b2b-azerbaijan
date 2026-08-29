create or replace function public.create_admin_product(
  p_sku text,
  p_category_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_sku text;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to create products';
  end if;

  v_sku := nullif(trim(p_sku), '');

  if v_sku is null then
    raise exception 'SKU is required';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  if p_category_id is not null
     and not exists (
       select 1
       from public.categories as c
       where c.id = p_category_id
     ) then
    raise exception 'Category not found';
  end if;

  if exists (
    select 1
    from public.products as p
    where p.sku = v_sku
  ) then
    raise exception 'SKU already exists';
  end if;

  insert into public.products (
    sku,
    name,
    category_id,
    stock,
    active
  )
  values (
    v_sku,
    v_sku,
    p_category_id,
    p_stock,
    p_active
  )
  returning id into v_product_id;

  insert into public.product_prices (
    product_id,
    normal_price,
    dealer_price,
    vip_price
  )
  values (
    v_product_id,
    p_normal_price,
    p_dealer_price,
    p_vip_price
  );

  return v_product_id;
end;
$$;

revoke execute
on function public.create_admin_product(
  text,
  uuid,
  integer,
  numeric,
  numeric,
  numeric,
  boolean
)
from public, anon;

grant execute
on function public.create_admin_product(
  text,
  uuid,
  integer,
  numeric,
  numeric,
  numeric,
  boolean
)
to authenticated;