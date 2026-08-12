with new_product as (
  insert into public.products (
    sku,
    stock,
    active
  )
  values (
    'LED-H7-DEMO',
    25,
    true
  )
  returning id
)
insert into public.product_prices (
  product_id,
  normal_price,
  dealer_price,
  vip_price
)
select
  id,
  45.00,
  36.00,
  31.00
from new_product;