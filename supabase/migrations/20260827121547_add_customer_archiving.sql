alter table public.customer_profiles
add column archived_at timestamptz;

alter table public.customer_profiles
add constraint customer_profiles_archived_inactive_check
check (
  archived_at is null
  or active = false
);

create or replace function public.archive_admin_customer(
  p_customer_id uuid
)
returns boolean
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
    raise exception 'Not authorized to archive customers';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  update public.customer_profiles
  set
    active = false,
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
  where id = p_customer_id;

  return true;
end;
$$;

revoke execute
on function public.archive_admin_customer(uuid)
from public, anon;

grant execute
on function public.archive_admin_customer(uuid)
to authenticated;


create or replace function public.restore_admin_customer(
  p_customer_id uuid
)
returns boolean
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
    raise exception 'Not authorized to restore customers';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  update public.customer_profiles
  set
    archived_at = null,
    active = false,
    updated_at = now()
  where id = p_customer_id;

  return true;
end;
$$;

revoke execute
on function public.restore_admin_customer(uuid)
from public, anon;

grant execute
on function public.restore_admin_customer(uuid)
to authenticated;


create or replace function public.set_customer_active(
  target_customer_id uuid,
  new_active boolean
)
returns boolean
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
    raise exception 'Not authorized to change customer active status';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = target_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  if new_active = true
    and exists (
      select 1
      from public.customer_profiles as cp
      where cp.id = target_customer_id
        and cp.archived_at is not null
    )
  then
    raise exception 'Archived customer cannot be activated';
  end if;

  update public.customer_profiles
  set
    active = new_active,
    updated_at = now()
  where id = target_customer_id;

  return new_active;
end;
$$;

revoke execute
on function public.set_customer_active(uuid, boolean)
from public, anon;

grant execute
on function public.set_customer_active(uuid, boolean)
to authenticated;


drop function if exists public.get_admin_customers();

create function public.get_admin_customers()
returns table (
  id uuid,
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
    cp.company_name,
    cp.contact_name,
    cp.phone,
    cp.price_group,
    cp.active,
    cp.archived_at,
    cp.created_at
  from public.customer_profiles as cp
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