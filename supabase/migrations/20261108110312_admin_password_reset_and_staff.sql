-- Admin password reset with forced change, session cut-off after a
-- credential change, and staff management.
--
-- Passwords are only ever handled by Supabase Auth (bcrypt). Nothing here
-- stores a password, a hash copy or a password history.
--
-- * An OWNER reset marks the account must_change_password with a 24 hour
--   window. Until the user sets a new password, every business and admin
--   RPC refuses the account.
-- * Sessions created before credentials_changed_at stop working in every
--   RPC (the JWT session_id is checked against auth.sessions, as the
--   Supabase session docs describe). The session that changed its own
--   password is kept (credentials_session_id).
-- * Staff accounts get their own profiles, roles and the same reset flow.
--
-- No MFA/aal2 requirement is added.


alter table public.customer_profiles
  add column must_change_password boolean not null default false,
  add column temporary_password_expires_at timestamptz,
  add column credentials_changed_at timestamptz,
  add column credentials_session_id uuid;

alter table public.staff_profiles
  add column must_change_password boolean not null default false,
  add column temporary_password_expires_at timestamptz,
  add column credentials_changed_at timestamptz,
  add column credentials_session_id uuid;


-- Helpers ---------------------------------------------------------------

-- The caller's session still exists and was created after the last
-- credential change (or is the session that made that change).
create or replace function private.session_is_current(
  p_changed_at timestamptz,
  p_trusted_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions as s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
      and (
        p_changed_at is null
        or s.id = p_trusted_session_id
        or s.created_at >= p_changed_at
      )
  );
$$;


-- Active, non-archived customer that does not have to change a temporary
-- password and uses a current session. No MFA rule.
create or replace function private.current_customer_price_group()
returns public.customer_price_group
language sql
stable
security definer
set search_path = ''
as $$
  select cp.price_group
  from public.customer_profiles as cp
  where cp.id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
    and cp.must_change_password = false
    and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id);
$$;


-- Same as above plus the optional MFA rule (used by the catalog RPCs).
create or replace function private.active_customer_price_group()
returns public.customer_price_group
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.mfa_satisfied() then private.current_customer_price_group()
  end;
$$;


-- Role of the calling staff member: active, no pending temporary
-- password, current session. Null otherwise. No MFA rule.
create or replace function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles as sp
  where sp.id = (select auth.uid())
    and sp.active = true
    and sp.must_change_password = false
    and private.session_is_current(sp.credentials_changed_at, sp.credentials_session_id);
$$;


create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = 'OWNER', false);
$$;


-- Used by the newer RPCs: OWNER plus the optional MFA rule.
create or replace function private.is_active_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mfa_satisfied() and private.is_owner();
$$;


revoke all on function private.session_is_current(timestamptz, uuid) from public, anon;
revoke all on function private.current_staff_role() from public, anon;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.session_is_current(timestamptz, uuid) to authenticated, service_role;
grant execute on function private.current_staff_role() to authenticated, service_role;
grant execute on function private.is_owner() to authenticated, service_role;


-- Account state for the signed-in user ----------------------------------

create or replace function public.get_my_account_state()
returns table (
  account_type text,
  active boolean,
  must_change_password boolean,
  temporary_password_expired boolean,
  session_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.account_type,
    a.active,
    a.must_change_password,
    a.must_change_password
      and a.expires_at is not null
      and a.expires_at <= now(),
    private.session_is_current(a.changed_at, a.trusted_session_id)
  from (
    select
      'customer'::text as account_type,
      cp.active and cp.archived_at is null as active,
      cp.must_change_password,
      cp.temporary_password_expires_at as expires_at,
      cp.credentials_changed_at as changed_at,
      cp.credentials_session_id as trusted_session_id
    from public.customer_profiles as cp
    where cp.id = (select auth.uid())

    union all

    select
      'staff'::text,
      sp.active,
      sp.must_change_password,
      sp.temporary_password_expires_at,
      sp.credentials_changed_at,
      sp.credentials_session_id
    from public.staff_profiles as sp
    where sp.id = (select auth.uid())
  ) as a;
$$;

revoke execute on function public.get_my_account_state() from public, anon;
grant execute on function public.get_my_account_state() to authenticated;


-- Called by the server (secret key) right after the user's own password
-- change succeeded in Supabase Auth. Users cannot call it themselves, so a
-- temporary password can only be cleared by actually replacing it. An
-- expired temporary password cannot be cleared: the OWNER must reset again.
create or replace function public.complete_password_change(
  p_user_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customer_profiles as cp
  set
    must_change_password = false,
    temporary_password_expires_at = null,
    credentials_changed_at = now(),
    credentials_session_id = p_session_id,
    updated_at = now()
  where cp.id = p_user_id
    and cp.active = true
    and cp.archived_at is null
    and not (
      cp.must_change_password
      and cp.temporary_password_expires_at is not null
      and cp.temporary_password_expires_at <= now()
    );

  if found then
    return;
  end if;

  update public.staff_profiles as sp
  set
    must_change_password = false,
    temporary_password_expires_at = null,
    credentials_changed_at = now(),
    credentials_session_id = p_session_id,
    updated_at = now()
  where sp.id = p_user_id
    and sp.active = true
    and not (
      sp.must_change_password
      and sp.temporary_password_expires_at is not null
      and sp.temporary_password_expires_at <= now()
    );

  if not found then
    raise exception 'Password change not allowed';
  end if;
end;
$$;

revoke execute on function public.complete_password_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_password_change(uuid, uuid) to service_role;


-- OWNER marks a customer or staff account as reset BEFORE the new
-- temporary password is set through the Auth Admin API. Old sessions stop
-- working immediately; the user must replace the password within 24 hours.
-- p_account_type decides which table is touched, so a customer reset can
-- never change a staff account and vice versa.
create or replace function public.mark_admin_password_reset(
  p_user_id uuid,
  p_account_type text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz := now() + interval '24 hours';
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to reset passwords';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'Use change password for your own account';
  end if;

  if p_account_type = 'customer' then
    update public.customer_profiles
    set
      must_change_password = true,
      temporary_password_expires_at = v_expires_at,
      credentials_changed_at = now(),
      credentials_session_id = null,
      updated_at = now()
    where id = p_user_id;

    if not found then
      raise exception 'Customer not found';
    end if;
  elsif p_account_type = 'staff' then
    update public.staff_profiles
    set
      must_change_password = true,
      temporary_password_expires_at = v_expires_at,
      credentials_changed_at = now(),
      credentials_session_id = null,
      updated_at = now()
    where id = p_user_id;

    if not found then
      raise exception 'Staff member not found';
    end if;
  else
    raise exception 'Invalid account type';
  end if;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id)
  values ((select auth.uid()), p_account_type || '_password_reset', p_account_type, p_user_id::text);

  return v_expires_at;
end;
$$;

revoke execute on function public.mark_admin_password_reset(uuid, text) from public, anon;
grant execute on function public.mark_admin_password_reset(uuid, text) to authenticated;


-- Customer login details for the admin customer page.
create or replace function public.get_admin_customer_login(
  p_customer_id uuid
)
returns table (
  email text,
  active boolean,
  archived_at timestamptz,
  must_change_password boolean,
  temporary_password_expires_at timestamptz,
  credentials_changed_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to view customer logins';
  end if;

  return query
  select
    u.email::text,
    cp.active,
    cp.archived_at,
    cp.must_change_password,
    cp.temporary_password_expires_at,
    cp.credentials_changed_at,
    u.last_sign_in_at
  from public.customer_profiles as cp
  join auth.users as u
    on u.id = cp.id
  where cp.id = p_customer_id;
end;
$$;

revoke execute on function public.get_admin_customer_login(uuid) from public, anon;
grant execute on function public.get_admin_customer_login(uuid) to authenticated;


-- Staff management --------------------------------------------------------

create or replace function public.get_admin_staff()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.staff_role,
  active boolean,
  must_change_password boolean,
  temporary_password_expires_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to view staff';
  end if;

  return query
  select
    sp.id,
    u.email::text,
    sp.full_name,
    sp.role,
    sp.active,
    sp.must_change_password,
    sp.temporary_password_expires_at,
    u.last_sign_in_at,
    sp.created_at
  from public.staff_profiles as sp
  join auth.users as u
    on u.id = sp.id
  order by sp.active desc, sp.role, sp.full_name nulls last, u.email;
end;
$$;

revoke execute on function public.get_admin_staff() from public, anon;
grant execute on function public.get_admin_staff() to authenticated;


-- Creates the staff profile for an Auth user the server just created with
-- a temporary password. The new member must change it at first login.
create or replace function public.create_admin_staff_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.staff_role
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(trim(p_full_name), '');
  v_expires_at timestamptz := now() + interval '24 hours';
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to create staff';
  end if;

  if v_full_name is null or length(v_full_name) > 100 then
    raise exception 'Staff name is required';
  end if;

  if p_role is null then
    raise exception 'Staff role is required';
  end if;

  if not exists (select 1 from auth.users as u where u.id = p_user_id) then
    raise exception 'User not found';
  end if;

  if exists (select 1 from public.customer_profiles as cp where cp.id = p_user_id)
     or exists (select 1 from public.staff_profiles as sp where sp.id = p_user_id) then
    raise exception 'User already has a profile';
  end if;

  insert into public.staff_profiles (
    id,
    full_name,
    role,
    active,
    must_change_password,
    temporary_password_expires_at,
    credentials_changed_at
  )
  values (
    p_user_id,
    v_full_name,
    p_role,
    true,
    true,
    v_expires_at,
    now()
  );

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id)
  values ((select auth.uid()), 'staff_created', 'staff', p_user_id::text);

  return v_expires_at;
end;
$$;

revoke execute on function public.create_admin_staff_profile(uuid, text, public.staff_role) from public, anon;
grant execute on function public.create_admin_staff_profile(uuid, text, public.staff_role) to authenticated;


-- Name, role and active status of a staff member. An OWNER cannot remove
-- their own OWNER access, and at least one active OWNER always remains.
create or replace function public.update_admin_staff(
  p_staff_id uuid,
  p_full_name text,
  p_role public.staff_role,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := nullif(trim(p_full_name), '');
  v_old_role public.staff_role;
  v_old_active boolean;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update staff';
  end if;

  if v_full_name is null or length(v_full_name) > 100 then
    raise exception 'Staff name is required';
  end if;

  if p_role is null or p_active is null then
    raise exception 'Staff role is required';
  end if;

  -- Serialize OWNER changes so two requests cannot remove the last OWNER.
  perform pg_advisory_xact_lock(hashtext('public.staff_profiles.owner'));

  select sp.role, sp.active
  into v_old_role, v_old_active
  from public.staff_profiles as sp
  where sp.id = p_staff_id
  for update;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if p_staff_id = (select auth.uid()) and (p_role <> 'OWNER' or p_active = false) then
    raise exception 'You cannot remove your own OWNER access';
  end if;

  update public.staff_profiles
  set
    full_name = v_full_name,
    role = p_role,
    active = p_active,
    updated_at = now()
  where id = p_staff_id;

  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.role = 'OWNER'
      and sp.active = true
  ) then
    raise exception 'At least one active OWNER is required';
  end if;

  if p_role is distinct from v_old_role then
    insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
    values ((select auth.uid()), 'staff_role_changed', 'staff', p_staff_id::text,
            jsonb_build_object('from', v_old_role, 'to', p_role));
  end if;

  if p_active is distinct from v_old_active then
    insert into public.security_audit_log (actor_user_id, action, target_type, target_id)
    values (
      (select auth.uid()),
      case when p_active then 'staff_activated' else 'staff_deactivated' end,
      'staff',
      p_staff_id::text
    );
  end if;
end;
$$;

revoke execute on function public.update_admin_staff(uuid, text, public.staff_role, boolean) from public, anon;
grant execute on function public.update_admin_staff(uuid, text, public.staff_role, boolean) to authenticated;


-- Auth-level events recorded by the server actions. The target must be an
-- account of the matching type. Passwords are never part of an event.
create or replace function public.record_admin_security_event(
  p_action text,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_type text;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to record security events';
  end if;

  if p_action in (
    'customer_created',
    'customer_email_changed',
    'customer_activated',
    'customer_deactivated',
    'customer_archived',
    'customer_restored',
    'customer_mfa_reset',
    -- Names used before this migration.
    'customer.login_created',
    'customer.email_changed',
    'customer.password_changed',
    'customer.mfa_reset'
  ) then
    v_target_type := 'customer';

    if not exists (select 1 from public.customer_profiles as cp where cp.id = p_target_id) then
      raise exception 'Customer not found';
    end if;
  elsif p_action in ('customer_deleted', 'customer.deleted') then
    -- Recorded after the account is gone.
    v_target_type := 'customer';
  elsif p_action = 'staff_email_changed' then
    v_target_type := 'staff';

    if not exists (select 1 from public.staff_profiles as sp where sp.id = p_target_id) then
      raise exception 'Staff member not found';
    end if;
  else
    raise exception 'Invalid security event';
  end if;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id)
  values ((select auth.uid()), p_action, v_target_type, p_target_id::text);
end;
$$;


-- Old versions superseded by the paginated / parent-aware RPCs. They
-- skipped the account checks above and the application no longer calls
-- them. Dropping a function does not touch any data.
drop function if exists public.get_customer_catalog();
drop function if exists public.get_admin_products();
drop function if exists public.create_admin_category(text, text, integer, boolean);
drop function if exists public.update_admin_category(uuid, text, text, integer, boolean);


-- Old OWNER RPCs: the inline OWNER check becomes private.is_owner(), which
-- also refuses inactive staff, pending temporary passwords and sessions
-- older than the last credential change. Bodies are otherwise unchanged.

-- archive_admin_customer
create or replace function public.archive_admin_customer(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
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


-- create_admin_product
create or replace function public.create_admin_product(
  p_sku text,
  p_category_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_sku text;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to create products';
  end if;

  v_sku := nullif(trim(p_sku), '');

  if v_sku is null then
    raise exception 'SKU is required';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  if p_category_id is not null
     and not exists (
       select 1
       from public.categories as c
       where c.id = p_category_id
     ) then
    raise exception 'Category not found';
  end if;

  if exists (
    select 1
    from public.products as p
    where p.sku = v_sku
  ) then
    raise exception 'SKU already exists';
  end if;

  insert into public.products (
    sku,
    name,
    category_id,
    stock,
    active
  )
  values (
    v_sku,
    v_sku,
    p_category_id,
    p_stock,
    p_active
  )
  returning id into v_product_id;

  insert into public.product_prices (
    product_id,
    normal_price,
    dealer_price,
    vip_price
  )
  values (
    v_product_id,
    p_normal_price,
    p_dealer_price,
    p_vip_price
  );

  return v_product_id;
end;
$$;


-- create_admin_product_media
create or replace function public.create_admin_product_media(
  p_product_id uuid,
  p_media_type text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_id uuid;
  v_media_type text;
  v_storage_path text;
  v_original_name text;
  v_mime_type text;
  v_is_primary boolean := false;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to create product media';
  end if;

  if not exists (
    select 1
    from public.products as p
    where p.id = p_product_id
  ) then
    raise exception 'Product not found';
  end if;

  v_media_type := upper(nullif(trim(p_media_type), ''));
  v_storage_path := nullif(trim(p_storage_path), '');
  v_original_name := nullif(trim(p_original_name), '');
  v_mime_type := lower(nullif(trim(p_mime_type), ''));

  if v_media_type is null
     or v_media_type not in ('IMAGE', 'VIDEO') then
    raise exception 'Invalid media type';
  end if;

  if v_storage_path is null then
    raise exception 'Storage path is required';
  end if;

  if left(
    v_storage_path,
    length(p_product_id::text) + 1
  ) <> p_product_id::text || '/' then
    raise exception 'Invalid storage path';
  end if;

  if v_mime_type is null then
    raise exception 'Mime type is required';
  end if;

  if v_media_type = 'IMAGE'
     and v_mime_type not in (
       'image/jpeg',
       'image/png',
       'image/webp'
     ) then
    raise exception 'Invalid image mime type';
  end if;

  if v_media_type = 'VIDEO'
     and v_mime_type not in (
       'video/mp4',
       'video/webm'
     ) then
    raise exception 'Invalid video mime type';
  end if;

  if v_media_type = 'IMAGE' then
    v_is_primary := not exists (
      select 1
      from public.product_media as pm
      where pm.product_id = p_product_id
        and pm.media_type = 'IMAGE'
    );
  end if;

  insert into public.product_media (
    product_id,
    media_type,
    storage_path,
    original_name,
    mime_type,
    is_primary
  )
  values (
    p_product_id,
    v_media_type,
    v_storage_path,
    v_original_name,
    v_mime_type,
    v_is_primary
  )
  returning id into v_media_id;

  return v_media_id;
end;
$$;


-- delete_admin_product_media
create or replace function public.delete_admin_product_media(
  p_media_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
  v_storage_path text;
  v_was_primary boolean;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to delete product media';
  end if;

  select
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.is_primary
  into
    v_product_id,
    v_media_type,
    v_storage_path,
    v_was_primary
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  delete from public.product_media
  where id = p_media_id;

  if v_media_type = 'IMAGE'
     and v_was_primary = true then

    update public.product_media
    set is_primary = true
    where id = (
      select pm.id
      from public.product_media as pm
      where pm.product_id = v_product_id
        and pm.media_type = 'IMAGE'
      order by
        pm.sort_order,
        pm.created_at,
        pm.id
      limit 1
    );

  end if;

  return v_storage_path;
end;
$$;


-- get_admin_customer_delete_status
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
  if not private.is_owner() then
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


-- get_admin_customers
create or replace function public.get_admin_customers()
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
  if not private.is_owner() then
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


-- get_admin_order_items
create or replace function public.get_admin_order_items(
  p_order_id uuid
)
returns table (
  id uuid,
  product_id uuid,
  sku text,
  quantity integer,
  unit_price numeric,
  line_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Not authorized to view order items';
  end if;

  if not exists (
    select 1
    from public.orders as o
    where o.id = p_order_id
  ) then
    raise exception 'Order not found';
  end if;

  return query
  select
    oi.id,
    oi.product_id,
    oi.sku,
    oi.quantity,
    oi.unit_price,
    oi.line_total
  from public.order_items as oi
  where oi.order_id = p_order_id
  order by oi.created_at, oi.id;
end;
$$;


-- get_admin_orders
create or replace function public.get_admin_orders()
returns table (
  order_id uuid,
  customer_id uuid,
  email text,
  company_name text,
  contact_name text,
  price_group public.customer_price_group,
  status public.order_status,
  total_amount numeric,
  item_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select
    o.id,
    o.customer_id,
    au.email::text,
    cp.company_name,
    cp.contact_name,
    cp.price_group,
    o.status,
    o.total_amount,
    count(oi.id),
    o.created_at,
    o.updated_at
  from public.orders as o
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  left join auth.users as au
    on au.id = o.customer_id
  left join public.order_items as oi
    on oi.order_id = o.id
  group by
    o.id,
    o.customer_id,
    au.email,
    cp.company_name,
    cp.contact_name,
    cp.price_group,
    o.status,
    o.total_amount,
    o.created_at,
    o.updated_at
  order by o.created_at desc;
end;
$$;


-- get_admin_product_media
create or replace function public.get_admin_product_media(
  p_product_id uuid
)
returns table (
  id uuid,
  product_id uuid,
  media_type text,
  storage_path text,
  original_name text,
  mime_type text,
  sort_order integer,
  is_primary boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Not authorized to view product media';
  end if;

  return query
  select
    pm.id,
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.original_name,
    pm.mime_type,
    pm.sort_order,
    pm.is_primary,
    pm.created_at
  from public.product_media as pm
  where pm.product_id = p_product_id
  order by
    pm.media_type,
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;


-- restore_admin_customer
create or replace function public.restore_admin_customer(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
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


-- set_admin_product_primary_media
create or replace function public.set_admin_product_primary_media(
  p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to update product media';
  end if;

  select
    pm.product_id,
    pm.media_type
  into
    v_product_id,
    v_media_type
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  if v_media_type <> 'IMAGE' then
    raise exception 'Only images can be primary';
  end if;

  update public.product_media
  set is_primary = false
  where product_id = v_product_id
    and media_type = 'IMAGE'
    and is_primary = true;

  update public.product_media
  set is_primary = true
  where id = p_media_id;
end;
$$;


-- set_customer_active
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
  if not private.is_owner() then
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


-- set_customer_price_group
create or replace function public.set_customer_price_group(
  target_customer_id uuid,
  new_price_group public.customer_price_group
)
returns public.customer_price_group
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  old_price_group public.customer_price_group;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_owner() then
    raise exception 'Not authorized to change customer price group';
  end if;

  select price_group
  into old_price_group
  from public.customer_profiles
  where id = target_customer_id
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  if old_price_group = new_price_group then
    return old_price_group;
  end if;

  update public.customer_profiles
  set
    price_group = new_price_group,
    updated_at = now()
  where id = target_customer_id;

  insert into public.price_group_audit (
    customer_id,
    changed_by,
    old_price_group,
    new_price_group
  )
  values (
    target_customer_id,
    current_user_id,
    old_price_group,
    new_price_group
  );

  return new_price_group;
end;
$$;


-- update_admin_customer_profile
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
  if not private.is_owner() then
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


-- update_admin_order_status
create or replace function public.update_admin_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status public.order_status;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to update orders';
  end if;

  select o.status
  into v_current_status
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_current_status = p_status then
    return v_current_status;
  end if;

  if v_current_status <> 'PENDING' then
    raise exception 'Only pending orders can change status';
  end if;

  if p_status = 'CONFIRMED' then
    update public.orders
    set
      status = 'CONFIRMED',
      updated_at = now()
    where id = p_order_id;

    return 'CONFIRMED';
  end if;

  if p_status = 'CANCELLED' then
    update public.products as p
    set
      stock = p.stock + oi.quantity,
      updated_at = now()
    from public.order_items as oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;

    update public.orders
    set
      status = 'CANCELLED',
      updated_at = now()
    where id = p_order_id;

    return 'CANCELLED';
  end if;

  raise exception 'Invalid order status transition';
end;
$$;


-- update_admin_product
create or replace function public.update_admin_product(
  p_product_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Not authorized to update products';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  update public.products
  set
    stock = p_stock,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  update public.product_prices
  set
    normal_price = p_normal_price,
    dealer_price = p_dealer_price,
    vip_price = p_vip_price,
    updated_at = now()
  where product_id = p_product_id;

  if not found then
    raise exception 'Product prices not found';
  end if;
end;
$$;


-- update_admin_product_active
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
  if not private.is_owner() then
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


-- update_admin_product_content
create or replace function public.update_admin_product_content(
  p_product_id uuid,
  p_name text,
  p_description text,
  p_category_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_description text;
begin
  if not private.is_owner() then
    raise exception 'Not authorized to update product content';
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    raise exception 'Product name is required';
  end if;

  v_description := nullif(trim(p_description), '');

  if p_category_id is not null
     and not exists (
       select 1
       from public.categories as c
       where c.id = p_category_id
     ) then
    raise exception 'Category not found';
  end if;

  update public.products
  set
    name = v_name,
    description = v_description,
    category_id = p_category_id,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;


-- Customer cart and order reads: same account rule as the other customer
-- RPCs (no pending temporary password, session newer than the last
-- credential change).

create or replace function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  stock integer,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as product_id,
    p.sku,
    p.name,
    ci.quantity,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as unit_price,
    (
      ci.quantity *
      case cp.price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    ) as line_total,
    p.stock,
    private.is_product_available(p.id) as available
  from public.customer_profiles as cp
  join public.carts as c
    on c.customer_id = cp.id
  join public.cart_items as ci
    on ci.cart_id = c.id
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where cp.id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
    and cp.must_change_password = false
    and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  order by ci.created_at;
$$;



create or replace function public.get_customer_orders()
returns table (
  order_id uuid,
  status public.order_status,
  total_amount numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id as order_id,
    o.status,
    o.total_amount,
    o.created_at
  from public.orders as o
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  where o.customer_id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
    and cp.must_change_password = false
    and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  order by o.created_at desc;
$$;


create or replace function public.get_customer_order_items(p_order_id uuid)
returns table (
  product_id uuid,
  sku text,
  quantity integer,
  unit_price numeric,
  line_total numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    oi.product_id,
    oi.sku,
    oi.quantity,
    oi.unit_price,
    oi.line_total
  from public.order_items as oi
  join public.orders as o
    on o.id = oi.order_id
  join public.customer_profiles as cp
    on cp.id = o.customer_id
  where oi.order_id = p_order_id
    and o.customer_id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null
    and cp.must_change_password = false
    and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  order by oi.created_at;
$$;



-- Product media files: the same account rules as the RPCs. Reading needs
-- an account that may use the shop or the admin panel; writing needs an
-- OWNER. (select ...) lets Postgres evaluate each check once per query.

drop policy if exists "Authenticated users can read product media" on storage.objects;
drop policy if exists "Owners can upload product media" on storage.objects;
drop policy if exists "Owners can update product media" on storage.objects;
drop policy if exists "Owners can delete product media" on storage.objects;

create policy "Active accounts can read product media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-media'
  and (
    (select private.current_customer_price_group()) is not null
    or (select private.current_staff_role()) is not null
  )
);

create policy "Owners can upload product media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-media'
  and (select private.is_owner())
);

create policy "Owners can update product media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-media'
  and (select private.is_owner())
)
with check (
  bucket_id = 'product-media'
  and (select private.is_owner())
);

create policy "Owners can delete product media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-media'
  and (select private.is_owner())
);
