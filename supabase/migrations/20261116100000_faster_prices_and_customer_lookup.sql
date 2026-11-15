-- Speed only: same results, same rules, no data touched.
--
-- 1. Price helpers. group_price / effective_price were declared with
--    "set search_path", which stops PostgreSQL from inlining them, so the
--    catalog called them once per product (sorting 10 000 products by price
--    took ~118 ms; ~10 ms inlined). They are pure expressions: every name
--    in them is schema-qualified (the enum labels are cast to
--    public.customer_price_group), and they read no table, so they do not
--    need a search_path of their own. Callers are SECURITY DEFINER
--    functions with search_path = ''.
--
-- 2. get_admin_customer(id): the admin customer page loaded every customer
--    (with order counts) to show one. Same columns and the same role check
--    as get_admin_customers, for one customer.

create or replace function private.group_price(
  p_group public.customer_price_group,
  p_normal numeric,
  p_dealer numeric,
  p_vip numeric
)
returns numeric
language sql
immutable
as $$
  select case p_group
    when 'DEALER'::public.customer_price_group then coalesce(p_dealer, p_normal)
    when 'VIP'::public.customer_price_group then coalesce(p_vip, p_normal)
    else p_normal
  end;
$$;

create or replace function private.effective_price(
  p_group public.customer_price_group,
  p_normal numeric,
  p_dealer numeric,
  p_vip numeric,
  p_sale numeric
)
returns numeric
language sql
immutable
as $$
  select least(
    private.group_price(p_group, p_normal, p_dealer, p_vip),
    coalesce(p_sale, private.group_price(p_group, p_normal, p_dealer, p_vip))
  );
$$;

-- "create or replace" keeps a function's privileges; nobody outside the
-- database functions may call the helpers directly.
revoke all on function private.group_price(public.customer_price_group, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function private.effective_price(public.customer_price_group, numeric, numeric, numeric, numeric) from public, anon, authenticated;


create function public.get_admin_customer(p_customer_id uuid)
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
  if not private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]) then
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
    o.order_count,
    cp.archived_at is not null and o.order_count = 0,
    cp.created_at
  from public.customer_profiles as cp
  left join auth.users as au
    on au.id = cp.id
  cross join lateral (
    select count(*)::bigint as order_count
    from public.orders as x
    where x.customer_id = cp.id
  ) as o
  where cp.id = p_customer_id;
end;
$$;

revoke execute on function public.get_admin_customer(uuid) from public, anon;
grant execute on function public.get_admin_customer(uuid) to authenticated;
