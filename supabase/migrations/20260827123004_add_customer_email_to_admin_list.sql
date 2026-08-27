drop function if exists public.get_admin_customers();

create function public.get_admin_customers()
returns table (
  id uuid,
  email text,
  company_name text,
  contact_name text,
  phone text,
  price_group public.customer_price_group,
  active boolean,
  archived_at timestamptz,
  created_at timestamptz
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
    raise exception 'Not authorized to view customers';
  end if;

  return query
  select
    cp.id,
    au.email::text,
    cp.company_name,
    cp.contact_name,
    cp.phone,
    cp.price_group,
    cp.active,
    cp.archived_at,
    cp.created_at
  from public.customer_profiles as cp
  left join auth.users as au
    on au.id = cp.id
  order by
    (cp.archived_at is not null) asc,
    cp.created_at desc;
end;
$$;

revoke execute
on function public.get_admin_customers()
from public, anon;

grant execute
on function public.get_admin_customers()
to authenticated;