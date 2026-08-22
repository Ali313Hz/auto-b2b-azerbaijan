create or replace function public.create_order_from_cart()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_price_group public.customer_price_group;
  v_cart_id uuid;
  v_order_id uuid;
  v_total numeric(12, 2);
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  select cp.price_group
  into v_price_group
  from public.customer_profiles as cp
  where cp.id = v_customer_id
    and cp.active = true;

  if not found then
    raise exception 'Active customer profile required';
  end if;

  select c.id
  into v_cart_id
  from public.carts as c
  where c.customer_id = v_customer_id;

  if not found then
    raise exception 'Cart is empty';
  end if;

  if not exists (
    select 1
    from public.cart_items as ci
    where ci.cart_id = v_cart_id
  ) then
    raise exception 'Cart is empty';
  end if;

  -- Sipariş oluşturulurken ürün, fiyat ve sepet satırlarını kilitle.
  perform 1
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id
  order by p.id
  for update of ci, p, pp;

  -- Pasif veya fiyatı olmayan ürün varsa sipariş oluşturma.
  if exists (
    select 1
    from public.cart_items as ci
    left join public.products as p
      on p.id = ci.product_id
    left join public.product_prices as pp
      on pp.product_id = ci.product_id
    where ci.cart_id = v_cart_id
      and (
        p.id is null
        or p.active = false
        or pp.product_id is null
      )
  ) then
    raise exception 'Cart contains unavailable product';
  end if;

  -- Stok yeniden kontrol edilir.
  if exists (
    select 1
    from public.cart_items as ci
    join public.products as p
      on p.id = ci.product_id
    where ci.cart_id = v_cart_id
      and ci.quantity > p.stock
  ) then
    raise exception 'Insufficient stock';
  end if;

  -- Toplam fiyat DB tarafında, müşterinin gerçek fiyat grubuyla hesaplanır.
  select
    sum(
      ci.quantity *
      case v_price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    )
  into v_total
  from public.cart_items as ci
  join public.product_prices as pp
    on pp.product_id = ci.product_id
  where ci.cart_id = v_cart_id;

  insert into public.orders (
    customer_id,
    total_amount
  )
  values (
    v_customer_id,
    v_total
  )
  returning id into v_order_id;

  -- Sipariş anındaki SKU ve fiyatlar snapshot olarak saklanır.
  insert into public.order_items (
    order_id,
    product_id,
    sku,
    quantity,
    unit_price,
    line_total
  )
  select
    v_order_id,
    p.id,
    p.sku,
    ci.quantity,
    case v_price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end,
    ci.quantity *
    case v_price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id;

  -- Sipariş oluşturulduğunda stok düşürülür.
  update public.products as p
  set
    stock = p.stock - ci.quantity,
    updated_at = now()
  from public.cart_items as ci
  where ci.cart_id = v_cart_id
    and p.id = ci.product_id;

  -- Başarılı siparişten sonra sepet temizlenir.
  delete from public.cart_items
  where cart_id = v_cart_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  return v_order_id;
end;
$$;

revoke execute
on function public.create_order_from_cart()
from public, anon;

grant execute
on function public.create_order_from_cart()
to authenticated;