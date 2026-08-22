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
  where o.customer_id = auth.uid()
    and cp.active = true
  order by o.created_at desc;
$$;

revoke execute
on function public.get_customer_orders()
from public, anon;

grant execute
on function public.get_customer_orders()
to authenticated;