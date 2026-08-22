create or replace function public.get_admin_products()
returns table (
  id uuid,
  sku text,
  stock integer,
  active boolean,
  category_id uuid,
  category_name text,
  normal_price numeric,
  dealer_price numeric,
  vip_price numeric
)
language plpgsql
stable
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
    raise exception 'Not authorized to view admin products';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.stock,
    p.active,
    p.category_id,
    c.name as category_name,
    pp.normal_price,
    pp.dealer_price,
    pp.vip_price
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_prices as pp
    on pp.product_id = p.id
  order by p.created_at desc;
end;
$$;

revoke execute
on function public.get_admin_products()
from public, anon;

grant execute
on function public.get_admin_products()
to authenticated;