-- Reports: an order without any payment information (payment_status is
-- empty, as on all orders placed before payment tracking existed) gave an
-- empty answer instead of "not a sale", so pending orders were not counted
-- as pending and the Excel file showed an empty "sale" cell.
-- Only the helper changes; no data is touched.

create or replace function private.is_sale(
  p_status public.order_status,
  p_payment public.payment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_status <> 'CANCELLED'
      and (p_status = 'CONFIRMED' or p_payment = 'PAID'),
    false
  );
$$;

revoke all on function private.is_sale(public.order_status, public.payment_status) from public, anon, authenticated;
