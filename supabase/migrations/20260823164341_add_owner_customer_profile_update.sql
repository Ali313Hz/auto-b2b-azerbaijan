create or replace function public.update_admin_customer_profile(
  p_customer_id uuid,
  p_company_name text,
  p_contact_name text,
  p_phone text
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
    raise exception 'Not authorized to update customers';
  end if;

  if p_customer_id is null then
    raise exception 'Customer id is required';
  end if;

  if nullif(trim(p_company_name), '') is null then
    raise exception 'Company name is required';
  end if;

  if nullif(trim(p_contact_name), '') is null then
    raise exception 'Contact name is required';
  end if;

  update public.customer_profiles
  set
    company_name = trim(p_company_name),
    contact_name = trim(p_contact_name),
    phone = nullif(trim(p_phone), ''),
    updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;

revoke execute
on function public.update_admin_customer_profile(
  uuid,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.update_admin_customer_profile(
  uuid,
  text,
  text,
  text
)
to authenticated;