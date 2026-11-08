-- OWNER sets a customer's password directly (no temporary password).
-- The app calls this before Supabase Auth stores the new password (bcrypt)
-- with the Admin API. The password itself never reaches the database.
--
-- credentials_changed_at = now() makes every session created before the
-- change stale for business RPCs (private.session_is_current); the
-- customer's next sign-in with the new password is current. The password
-- is permanent: no forced change, no expiry.

create or replace function public.set_admin_customer_password_state(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to change customer passwords';
  end if;

  if p_customer_id is null or p_customer_id = (select auth.uid()) then
    raise exception 'Customer not found';
  end if;

  -- Staff and OWNER accounts are never changed through the customer path.
  if exists (
    select 1 from public.staff_profiles as sp where sp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  if exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
      and cp.archived_at is not null
  ) then
    raise exception 'Archived customer cannot be changed';
  end if;

  update public.customer_profiles
  set
    must_change_password = false,
    temporary_password_expires_at = null,
    credentials_changed_at = now(),
    credentials_session_id = null,
    updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id)
  values ((select auth.uid()), 'customer_password_changed', 'customer', p_customer_id::text);
end;
$$;

revoke execute on function public.set_admin_customer_password_state(uuid) from public, anon;
grant execute on function public.set_admin_customer_password_state(uuid) to authenticated;
