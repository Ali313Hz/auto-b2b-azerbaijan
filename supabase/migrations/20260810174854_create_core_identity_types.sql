create type public.staff_role as enum (
  'OWNER',
  'SALES',
  'PRODUCT_MANAGER',
  'SUPPORT',
  'WAREHOUSE'
);

create type public.customer_price_group as enum (
  'NORMAL',
  'DEALER',
  'VIP'
);