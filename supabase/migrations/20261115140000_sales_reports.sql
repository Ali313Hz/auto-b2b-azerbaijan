-- Sales reports ("Hesabatlar"), read-only, nothing changed in the data.
-- Only OWNER and SALES can call these functions; every number is computed
-- here in the database (no order rows are sent to the browser).
--
-- Rules used in every report:
--   * the period is in Baku time: p_from 00:00 .. p_to 24:00, by the date
--     the order was placed (orders.created_at);
--   * cancelled orders are never counted;
--   * "sale" (satış) = an order that is CONFIRMED, or whose payment was
--     confirmed (PAID) - for normal orders and pre-orders alike. A pending,
--     unpaid order is not a sale yet;
--   * amounts are the prices saved in the order (order_items.line_total /
--     orders.total_amount), never today's catalog prices.

-- Checks the role and the period; returns the period as timestamps.
create function private.report_period(p_from date, p_to date)
returns table (from_ts timestamptz, to_ts timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to view reports';
  end if;

  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'Invalid report period';
  end if;

  return query
  select
    (p_from::timestamp at time zone 'Asia/Baku'),
    ((p_to + 1)::timestamp at time zone 'Asia/Baku');
end;
$$;

revoke all on function private.report_period(date, date) from public, anon, authenticated;


create function private.is_sale(
  p_status public.order_status,
  p_payment public.payment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status <> 'CANCELLED'
    and (p_status = 'CONFIRMED' or p_payment = 'PAID');
$$;

revoke all on function private.is_sale(public.order_status, public.payment_status) from public, anon, authenticated;


-- KPI cards.
create function public.get_admin_report_summary(p_from date, p_to date)
returns table (
  order_count bigint,
  confirmed_count bigint,
  sale_count bigint,
  sales_total numeric,
  average_order numeric,
  paid_total numeric,
  pending_count bigint,
  pending_total numeric,
  preorder_count bigint,
  cancelled_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  select
    count(*) filter (where o.status <> 'CANCELLED'),
    count(*) filter (where o.status = 'CONFIRMED'),
    count(*) filter (where private.is_sale(o.status, o.payment_status)),
    coalesce(sum(o.total_amount) filter (where private.is_sale(o.status, o.payment_status)), 0),
    coalesce(round(avg(o.total_amount) filter (where private.is_sale(o.status, o.payment_status)), 2), 0),
    coalesce(sum(o.total_amount) filter (where o.status <> 'CANCELLED' and o.payment_status = 'PAID'), 0),
    count(*) filter (where o.status = 'PENDING' and not private.is_sale(o.status, o.payment_status)),
    coalesce(sum(o.total_amount) filter (where o.status = 'PENDING' and not private.is_sale(o.status, o.payment_status)), 0),
    count(*) filter (where o.status <> 'CANCELLED' and o.order_type = 'PREORDER'),
    count(*) filter (where o.status = 'CANCELLED')
  from public.orders as o
  where o.created_at >= v_from
    and o.created_at < v_to;
end;
$$;

revoke execute on function public.get_admin_report_summary(date, date) from public, anon;
grant execute on function public.get_admin_report_summary(date, date) to authenticated;


-- One row per month of the period (months without orders give zeros).
create function public.get_admin_report_monthly(p_from date, p_to date)
returns table (
  month date,
  order_count bigint,
  sale_count bigint,
  sales_total numeric,
  paid_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  with months as (
    select m::date as month
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') as m
  ),
  per_month as (
    select
      date_trunc('month', o.created_at at time zone 'Asia/Baku')::date as month,
      count(*) filter (where o.status <> 'CANCELLED') as order_count,
      count(*) filter (where private.is_sale(o.status, o.payment_status)) as sale_count,
      coalesce(sum(o.total_amount) filter (where private.is_sale(o.status, o.payment_status)), 0) as sales_total,
      coalesce(sum(o.total_amount) filter (where o.status <> 'CANCELLED' and o.payment_status = 'PAID'), 0) as paid_total
    from public.orders as o
    where o.created_at >= v_from
      and o.created_at < v_to
    group by 1
  )
  select
    m.month,
    coalesce(pm.order_count, 0),
    coalesce(pm.sale_count, 0),
    coalesce(pm.sales_total, 0),
    coalesce(pm.paid_total, 0)
  from months as m
  left join per_month as pm
    on pm.month = m.month
  order by m.month;
end;
$$;

revoke execute on function public.get_admin_report_monthly(date, date) from public, anon;
grant execute on function public.get_admin_report_monthly(date, date) to authenticated;


-- Products by sales in the period (largest amount first).
create function public.get_admin_report_products(p_from date, p_to date, p_limit integer default 10)
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity bigint,
  sales_total numeric,
  order_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  with sold as (
    select
      oi.product_id,
      max(oi.sku) as sku,
      sum(oi.quantity)::bigint as quantity,
      sum(oi.line_total) as sales_total,
      count(distinct oi.order_id) as order_count
    from public.orders as o
    join public.order_items as oi
      on oi.order_id = o.id
    where o.created_at >= v_from
      and o.created_at < v_to
      and private.is_sale(o.status, o.payment_status)
    group by oi.product_id
  )
  select s.product_id, coalesce(p.sku, s.sku), p.name, s.quantity, s.sales_total, s.order_count
  from sold as s
  left join public.products as p
    on p.id = s.product_id
  order by s.sales_total desc, s.quantity desc, s.product_id
  limit least(greatest(coalesce(p_limit, 10), 1), 20000);
end;
$$;

revoke execute on function public.get_admin_report_products(date, date, integer) from public, anon;
grant execute on function public.get_admin_report_products(date, date, integer) to authenticated;


-- Active products that were not sold in the period (paged).
create function public.get_admin_report_unsold_products(
  p_from date,
  p_to date,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  product_id uuid,
  sku text,
  name text,
  stock integer,
  category_name text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  with sold as materialized (
    select distinct oi.product_id
    from public.orders as o
    join public.order_items as oi
      on oi.order_id = o.id
    where o.created_at >= v_from
      and o.created_at < v_to
      and private.is_sale(o.status, o.payment_status)
  ),
  unsold as materialized (
    select p.id, p.sku, p.name, p.stock, p.category_id, p.created_at
    from public.products as p
    where p.active = true
      and not exists (select 1 from sold as s where s.product_id = p.id)
  ),
  page as (
    select u.*
    from unsold as u
    order by u.created_at, u.id
    limit v_size
    offset (v_page - 1) * v_size
  )
  select pg.id, pg.sku, pg.name, pg.stock, c.name, pg.created_at, (select count(*) from unsold)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  order by pg.created_at, pg.id;
end;
$$;

revoke execute on function public.get_admin_report_unsold_products(date, date, integer, integer) from public, anon;
grant execute on function public.get_admin_report_unsold_products(date, date, integer, integer) to authenticated;


-- Customers by sales in the period.
create function public.get_admin_report_customers(p_from date, p_to date, p_limit integer default 10)
returns table (
  customer_id uuid,
  company_name text,
  contact_name text,
  order_count bigint,
  sales_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  with per_customer as (
    select o.customer_id, count(*) as order_count, sum(o.total_amount) as sales_total
    from public.orders as o
    where o.created_at >= v_from
      and o.created_at < v_to
      and private.is_sale(o.status, o.payment_status)
    group by o.customer_id
  )
  select pc.customer_id, cp.company_name, cp.contact_name, pc.order_count, pc.sales_total
  from per_customer as pc
  left join public.customer_profiles as cp
    on cp.id = pc.customer_id
  order by pc.sales_total desc, pc.order_count desc, pc.customer_id
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
end;
$$;

revoke execute on function public.get_admin_report_customers(date, date, integer) from public, anon;
grant execute on function public.get_admin_report_customers(date, date, integer) to authenticated;


-- Orders of the period for the Excel file (cancelled ones excluded).
create function public.get_admin_report_orders(p_from date, p_to date)
returns table (
  order_id uuid,
  created_at timestamptz,
  company_name text,
  contact_name text,
  order_type public.order_type,
  status public.order_status,
  payment_status public.payment_status,
  item_count bigint,
  total_amount numeric,
  is_sale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  select r.from_ts, r.to_ts into v_from, v_to from private.report_period(p_from, p_to) as r;

  return query
  select
    o.id,
    o.created_at,
    cp.company_name,
    cp.contact_name,
    o.order_type,
    o.status,
    o.payment_status,
    (select count(*) from public.order_items as oi where oi.order_id = o.id),
    o.total_amount,
    private.is_sale(o.status, o.payment_status)
  from public.orders as o
  left join public.customer_profiles as cp
    on cp.id = o.customer_id
  where o.created_at >= v_from
    and o.created_at < v_to
    and o.status <> 'CANCELLED'
  order by o.created_at, o.id
  limit 50000;
end;
$$;

revoke execute on function public.get_admin_report_orders(date, date) from public, anon;
grant execute on function public.get_admin_report_orders(date, date) to authenticated;
