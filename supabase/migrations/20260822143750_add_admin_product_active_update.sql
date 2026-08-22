create or replace function public.update_admin_product_active(
  p_product_id uuid,
  p_active boolean
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
    raise exception 'Not authorized to update product status';
  end if;

  update public.products
  set
    active = p_active,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;

revoke execute
on function public.update_admin_product_active(
  uuid,
  boolean
)
from public, anon;

grant execute
on function public.update_admin_product_active(
  uuid,
  boolean
)
to authenticated;