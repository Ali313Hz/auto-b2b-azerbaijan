create or replace function public.set_customer_active(
  target_customer_id uuid,
  new_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  old_active boolean;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = current_user_id
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to change customer active status';
  end if;

  if new_active is null then
    raise exception 'Active status is required';
  end if;

  select cp.active
  into old_active
  from public.customer_profiles as cp
  where cp.id = target_customer_id
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  if old_active = new_active then
    return old_active;
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
on function public.set_customer_active(
  uuid,
  boolean
)
from public, anon;

grant execute
on function public.set_customer_active(
  uuid,
  boolean
)
to authenticated;