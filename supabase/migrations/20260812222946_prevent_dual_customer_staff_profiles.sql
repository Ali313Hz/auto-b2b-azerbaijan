create or replace function public.prevent_dual_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'customer_profiles' then
    if exists (
      select 1
      from public.staff_profiles
      where id = new.id
    ) then
      raise exception 'User cannot have both customer and staff profiles';
    end if;

  elsif tg_table_name = 'staff_profiles' then
    if exists (
      select 1
      from public.customer_profiles
      where id = new.id
    ) then
      raise exception 'User cannot have both customer and staff profiles';
    end if;
  end if;

  return new;
end;
$$;

revoke execute
on function public.prevent_dual_profile()
from public, anon, authenticated;

drop trigger if exists prevent_customer_profile_for_staff
on public.customer_profiles;

drop trigger if exists prevent_staff_profile_for_customer
on public.staff_profiles;

create trigger prevent_customer_profile_for_staff
before insert or update of id
on public.customer_profiles
for each row
execute function public.prevent_dual_profile();

create trigger prevent_staff_profile_for_customer
before insert or update of id
on public.staff_profiles
for each row
execute function public.prevent_dual_profile();