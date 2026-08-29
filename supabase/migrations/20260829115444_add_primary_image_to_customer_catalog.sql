drop function if exists public.get_customer_catalog();

create function public.get_customer_catalog()
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  price numeric,
  category_id uuid,
  category_name text,
  category_slug text,
  primary_image_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.stock,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as price,
    c.id as category_id,
    c.name as category_name,
    c.slug as category_slug,
    pm.storage_path as primary_image_path
  from public.customer_profiles as cp
  cross join public.products as p
  join public.product_prices as pp
    on pp.product_id = p.id
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_media as pm
    on pm.product_id = p.id
    and pm.media_type = 'IMAGE'
    and pm.is_primary = true
  where cp.id = auth.uid()
    and cp.active = true
    and p.active = true
    and (
      p.category_id is null
      or c.active = true
    );
$$;

revoke execute
on function public.get_customer_catalog()
from public, anon;

grant execute
on function public.get_customer_catalog()
to authenticated;