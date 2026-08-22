create or replace function public.get_admin_customers()
returns table (
  id uuid,
  company_name text,
  contact_name text,
  phone text,
  price_group public.customer_price_group,
  active boolean,
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
    from public.staff_profiles
    where id = auth.uid()
      and active = true
      and role = 'OWNER'
  ) then
    raise exception 'Not authorized to view customers';
  end if;

  return query
  select
    cp.id,
    cp.company_name,
    cp.contact_name,
    cp.phone,
    cp.price_group,
    cp.active,
    cp.created_at
  from public.customer_profiles as cp
  order by cp.created_at desc;
end;
$$;

revoke execute
on function public.get_admin_customers()
from public, anon;

grant execute
on function public.get_admin_customers()
to authenticated;