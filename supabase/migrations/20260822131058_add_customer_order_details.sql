create or replace function public.get_customer_order_items(
  p_order_id uuid
)
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
    and o.customer_id = auth.uid()
    and cp.active = true
  order by oi.created_at;
$$;

revoke execute
on function public.get_customer_order_items(uuid)
from public, anon;

grant execute
on function public.get_customer_order_items(uuid)
to authenticated;