create or replace function public.get_customer_catalog()
returns table (
  id uuid,
  sku text,
  stock integer,
  price numeric(12, 2)
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.sku,
    p.stock,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as price
  from public.customer_profiles as cp
  cross join public.products as p
  join public.product_prices as pp
    on pp.product_id = p.id
  where cp.id = auth.uid()
    and cp.active = true
    and p.active = true;
$$;

revoke execute on function public.get_customer_catalog() from public;
revoke execute on function public.get_customer_catalog() from anon;

grant execute on function public.get_customer_catalog() to authenticated;