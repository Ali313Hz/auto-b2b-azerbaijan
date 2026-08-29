create or replace function public.get_customer_product_media(
  p_product_id uuid
)
returns table (
  id uuid,
  storage_path text,
  is_primary boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = auth.uid()
      and cp.active = true
  ) then
    raise exception 'Not authorized to view product media';
  end if;

  if not exists (
    select 1
    from public.products as p
    left join public.categories as c
      on c.id = p.category_id
    where p.id = p_product_id
      and p.active = true
      and (
        p.category_id is null
        or c.active = true
      )
  ) then
    raise exception 'Product not available';
  end if;

  return query
  select
    pm.id,
    pm.storage_path,
    pm.is_primary,
    pm.sort_order
  from public.product_media as pm
  where pm.product_id = p_product_id
    and pm.media_type = 'IMAGE'
  order by
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;

revoke execute
on function public.get_customer_product_media(uuid)
from public, anon;

grant execute
on function public.get_customer_product_media(uuid)
to authenticated;