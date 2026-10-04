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
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
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
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
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
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
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


revoke execute
on function public.get_admin_orders()
from public, anon;

grant execute
on function public.get_admin_orders()
to authenticated;


revoke execute
on function public.get_admin_order_items(uuid)
from public, anon;

grant execute
on function public.get_admin_order_items(uuid)
to authenticated;


revoke execute
on function public.update_admin_order_status(
  uuid,
  public.order_status
)
from public, anon;

grant execute
on function public.update_admin_order_status(
  uuid,
  public.order_status
)
to authenticated;