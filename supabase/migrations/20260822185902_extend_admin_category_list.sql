drop function if exists public.get_admin_categories();

create function public.get_admin_categories()
returns table (
  id uuid,
  name text,
  slug text,
  active boolean,
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
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to view admin categories';
  end if;

  return query
  select
    c.id,
    c.name,
    c.slug,
    c.active,
    c.sort_order
  from public.categories as c
  order by c.sort_order, c.name;
end;
$$;

revoke execute
on function public.get_admin_categories()
from public, anon;

grant execute
on function public.get_admin_categories()
to authenticated;