-- Shared authorization helpers and an append-only security audit log.
--
-- The private schema is not exposed through the Data API. Helpers are
-- SECURITY DEFINER so storage/RLS policies can call them too.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;


-- True only for sessions that completed a second factor (TOTP).
create or replace function private.has_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;


-- MFA is optional for now. To make it mandatory for everyone later,
-- redefine this function to return true in a new migration.
create or replace function private.mfa_required()
returns boolean
language sql
stable
set search_path = ''
as $$
  select false;
$$;


-- The session meets the MFA rule: an aal2 session, or (while MFA is
-- optional) a user without a verified TOTP factor. A user who enrolled a
-- factor must complete the TOTP challenge before any data access.
create or replace function private.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_aal2()
    or (
      not private.mfa_required()
      and not exists (
        select 1
        from auth.mfa_factors as f
        where f.user_id = (select auth.uid())
          and f.status = 'verified'
      )
    );
$$;


-- OWNER access requires: authenticated user, active staff profile,
-- OWNER role and a session that meets the MFA rule. Any doubt means false.
create or replace function private.is_active_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.mfa_satisfied()
    and exists (
      select 1
      from public.staff_profiles as sp
      where sp.id = (select auth.uid())
        and sp.active = true
        and sp.role = 'OWNER'
    );
$$;


-- Price group of the calling customer, or null when the caller is not an
-- active, non-archived customer whose session meets the MFA rule.
create or replace function private.active_customer_price_group()
returns public.customer_price_group
language sql
stable
security definer
set search_path = ''
as $$
  select cp.price_group
  from public.customer_profiles as cp
  where private.mfa_satisfied()
    and cp.id = (select auth.uid())
    and cp.active = true
    and cp.archived_at is null;
$$;


revoke all on all functions in schema private from public, anon;
grant execute on function private.has_aal2() to authenticated, service_role;
grant execute on function private.mfa_required() to authenticated, service_role;
grant execute on function private.mfa_satisfied() to authenticated, service_role;
grant execute on function private.is_active_owner() to authenticated, service_role;
grant execute on function private.active_customer_price_group() to authenticated, service_role;


-- Append-only audit log ----------------------------------------------------

create table public.security_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null check (length(action) between 1 and 100),
  target_type text not null check (length(target_type) between 1 and 50),
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index security_audit_log_created_at_idx
on public.security_audit_log (created_at desc);

alter table public.security_audit_log enable row level security;

revoke all on table public.security_audit_log from public, anon, authenticated, service_role;


create or replace function private.prevent_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'security_audit_log is append-only';
end;
$$;

create trigger security_audit_log_no_update
before update or delete on public.security_audit_log
for each row execute function private.prevent_audit_log_change();

create trigger security_audit_log_no_truncate
before truncate on public.security_audit_log
for each statement execute function private.prevent_audit_log_change();


-- Records staff (and service-role / dashboard) changes on sensitive tables.
-- Customer-driven changes such as stock decrements on order creation are
-- not admin actions and are skipped. Only changed column names are stored,
-- never values.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target text;
  v_changed text[];
begin
  if v_actor is not null
     and not exists (
       select 1 from public.staff_profiles as sp where sp.id = v_actor
     ) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_target := coalesce(to_jsonb(old) ->> 'id', to_jsonb(old) ->> 'product_id');
  else
    v_target := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'product_id');
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
    into v_changed
    from jsonb_each(to_jsonb(new)) as n
    where n.key not in ('updated_at')
      and n.value is distinct from (to_jsonb(old) -> n.key);

    if v_changed is null then
      return null;
    end if;
  end if;

  insert into public.security_audit_log (
    actor_user_id,
    action,
    target_type,
    target_id,
    details
  )
  values (
    v_actor,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_target,
    case
      when v_changed is not null then jsonb_build_object('changed', v_changed)
    end
  );

  return null;
end;
$$;

create trigger audit_customer_profiles
after insert or update or delete on public.customer_profiles
for each row execute function private.audit_row_change();

create trigger audit_staff_profiles
after insert or update or delete on public.staff_profiles
for each row execute function private.audit_row_change();

create trigger audit_products
after insert or update or delete on public.products
for each row execute function private.audit_row_change();

create trigger audit_product_prices
after insert or update or delete on public.product_prices
for each row execute function private.audit_row_change();

create trigger audit_categories
after insert or update or delete on public.categories
for each row execute function private.audit_row_change();

create trigger audit_product_media
after insert or update or delete on public.product_media
for each row execute function private.audit_row_change();

create trigger audit_orders
after update on public.orders
for each row execute function private.audit_row_change();


-- Auth-level admin actions (create login, change login, MFA reset, delete)
-- run through the Auth Admin API, so the server action records them here.
create or replace function public.record_admin_security_event(
  p_action text,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to record security events';
  end if;

  if p_action not in (
    'customer.login_created',
    'customer.email_changed',
    'customer.password_changed',
    'customer.mfa_reset',
    'customer.deleted'
  ) then
    raise exception 'Invalid security event';
  end if;

  insert into public.security_audit_log (
    actor_user_id,
    action,
    target_type,
    target_id
  )
  values (
    (select auth.uid()),
    p_action,
    'customer',
    p_target_id::text
  );
end;
$$;

revoke execute on function public.record_admin_security_event(text, uuid) from public, anon;
grant execute on function public.record_admin_security_event(text, uuid) to authenticated;


-- Lets server actions confirm the database-level OWNER check before
-- they use the secret (service-role) key.
create or replace function public.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_owner();
$$;

revoke execute on function public.current_user_is_owner() from public, anon;
grant execute on function public.current_user_is_owner() to authenticated;


create or replace function public.get_admin_audit_log(
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id bigint,
  actor_user_id uuid,
  actor_name text,
  action text,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to view audit log';
  end if;

  return query
  select
    l.id,
    l.actor_user_id,
    coalesce(sp.full_name, cp.company_name),
    l.action,
    l.target_type,
    l.target_id,
    l.details,
    l.created_at,
    count(*) over ()
  from public.security_audit_log as l
  left join public.staff_profiles as sp
    on sp.id = l.actor_user_id
  left join public.customer_profiles as cp
    on cp.id = l.actor_user_id
  order by l.created_at desc, l.id desc
  limit v_size
  offset (v_page - 1) * v_size;
end;
$$;

revoke execute on function public.get_admin_audit_log(integer, integer) from public, anon;
grant execute on function public.get_admin_audit_log(integer, integer) to authenticated;
