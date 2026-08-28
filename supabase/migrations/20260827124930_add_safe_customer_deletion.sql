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
  order_count bigint,
  can_permanently_delete boolean,
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
    count(o.id)::bigint as order_count,
    (
      cp.archived_at is not null
      and count(o.id) = 0
    ) as can_permanently_delete,
    cp.created_at
  from public.customer_profiles as cp
  left join auth.users as au
    on au.id = cp.id
  left join public.orders as o
    on o.customer_id = cp.id
  group by
    cp.id,
    au.email,
    cp.company_name,
    cp.contact_name,
    cp.phone,
    cp.price_group,
    cp.active,
    cp.archived_at,
    cp.created_at
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


create or replace function public.get_admin_customer_delete_status(
  p_customer_id uuid
)
returns table (
  archived boolean,
  order_count bigint,
  can_delete boolean
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
    raise exception 'Not authorized to check customer deletion';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  return query
  select
    cp.archived_at is not null as archived,
    count(o.id)::bigint as order_count,
    (
      cp.archived_at is not null
      and count(o.id) = 0
    ) as can_delete
  from public.customer_profiles as cp
  left join public.orders as o
    on o.customer_id = cp.id
  where cp.id = p_customer_id
  group by
    cp.id,
    cp.archived_at;
end;
$$;

revoke execute
on function public.get_admin_customer_delete_status(uuid)
from public, anon;

grant execute
on function public.get_admin_customer_delete_status(uuid)
to authenticated;