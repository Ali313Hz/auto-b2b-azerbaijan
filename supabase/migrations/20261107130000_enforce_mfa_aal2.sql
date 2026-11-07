-- Mandatory MFA (aal2) enforcement in the database.
--
-- Applied only after the application with the MFA login flow is deployed.
-- Layers:
--   1. Every SECURITY DEFINER RPC checks the caller itself:
--      OWNER RPCs  -> private.is_active_owner() (aal2 + active OWNER staff)
--      customer    -> private.active_customer_price_group() / has_aal2()
--   2. A Data API pre-request hook rejects every authenticated request
--      whose JWT is not aal2, including direct table reads.
--   3. Restrictive RLS on the profile tables and aal2-aware storage policies
--      (Storage and Realtime do not run the pre-request hook).
-- Category availability now also requires every ancestor to be active.

-- add_to_cart
create or replace function public.add_to_cart(
  p_product_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_cart_id uuid;
  v_stock integer;
  v_new_quantity integer;
begin

  -- MFA (aal2) session of an active, non-archived customer is required.
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
    raise exception 'Active customer profile required';
  end if;

  select p.stock
  into v_stock
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  where p.id = p_product_id
    and p.active = true
    and (
      p.category_id is null
      or private.is_category_available(p.category_id)
    )
  for update of p;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_quantity > v_stock then
    raise exception 'Insufficient stock';
  end if;

  insert into public.carts (
    customer_id
  )
  values (
    v_customer_id
  )
  on conflict (customer_id)
  do update
  set updated_at = now()
  returning id into v_cart_id;

  insert into public.cart_items as ci (
    cart_id,
    product_id,
    quantity
  )
  values (
    v_cart_id,
    p_product_id,
    p_quantity
  )
  on conflict (cart_id, product_id)
  do update
  set
    quantity = ci.quantity + excluded.quantity,
    updated_at = now()
  where ci.quantity + excluded.quantity <= v_stock
  returning quantity into v_new_quantity;

  if v_new_quantity is null then
    raise exception 'Insufficient stock';
  end if;

  return v_new_quantity;
end;
$$;


-- archive_admin_customer
create or replace function public.archive_admin_customer(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to archive customers';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  update public.customer_profiles
  set
    active = false,
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
  where id = p_customer_id;

  return true;
end;
$$;


-- change_cart_quantity
create or replace function public.change_cart_quantity(
  p_product_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_cart_id uuid;
  v_current_quantity integer;
  v_new_quantity integer;
  v_stock integer;
begin

  -- MFA (aal2) session of an active, non-archived customer is required.
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Quantity change cannot be zero';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
    raise exception 'Active customer profile required';
  end if;

  select c.id
  into v_cart_id
  from public.carts as c
  where c.customer_id = v_customer_id;

  if not found then
    raise exception 'Cart not found';
  end if;

  select
    ci.quantity,
    p.stock
  into
    v_current_quantity,
    v_stock
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  left join public.categories as cat
    on cat.id = p.category_id
  where ci.cart_id = v_cart_id
    and ci.product_id = p_product_id
    and p.active = true
    and (
      p.category_id is null
      or private.is_category_available(p.category_id)
    )
  for update of ci, p;

  if not found then
    raise exception 'Cart item not found';
  end if;

  v_new_quantity := v_current_quantity + p_delta;

  if v_new_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if v_new_quantity > v_stock then
    raise exception 'Insufficient stock';
  end if;

  update public.cart_items
  set
    quantity = v_new_quantity,
    updated_at = now()
  where cart_id = v_cart_id
    and product_id = p_product_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  return v_new_quantity;
end;
$$;


-- create_admin_product
create or replace function public.create_admin_product(
  p_sku text,
  p_category_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_sku text;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to create products';
  end if;

  v_sku := nullif(trim(p_sku), '');

  if v_sku is null then
    raise exception 'SKU is required';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  if p_category_id is not null
     and not exists (
       select 1
       from public.categories as c
       where c.id = p_category_id
     ) then
    raise exception 'Category not found';
  end if;

  if exists (
    select 1
    from public.products as p
    where p.sku = v_sku
  ) then
    raise exception 'SKU already exists';
  end if;

  insert into public.products (
    sku,
    name,
    category_id,
    stock,
    active
  )
  values (
    v_sku,
    v_sku,
    p_category_id,
    p_stock,
    p_active
  )
  returning id into v_product_id;

  insert into public.product_prices (
    product_id,
    normal_price,
    dealer_price,
    vip_price
  )
  values (
    v_product_id,
    p_normal_price,
    p_dealer_price,
    p_vip_price
  );

  return v_product_id;
end;
$$;


-- create_admin_product_media
create or replace function public.create_admin_product_media(
  p_product_id uuid,
  p_media_type text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_id uuid;
  v_media_type text;
  v_storage_path text;
  v_original_name text;
  v_mime_type text;
  v_is_primary boolean := false;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to create product media';
  end if;

  if not exists (
    select 1
    from public.products as p
    where p.id = p_product_id
  ) then
    raise exception 'Product not found';
  end if;

  v_media_type := upper(nullif(trim(p_media_type), ''));
  v_storage_path := nullif(trim(p_storage_path), '');
  v_original_name := nullif(trim(p_original_name), '');
  v_mime_type := lower(nullif(trim(p_mime_type), ''));

  if v_media_type is null
     or v_media_type not in ('IMAGE', 'VIDEO') then
    raise exception 'Invalid media type';
  end if;

  if v_storage_path is null then
    raise exception 'Storage path is required';
  end if;

  if left(
    v_storage_path,
    length(p_product_id::text) + 1
  ) <> p_product_id::text || '/' then
    raise exception 'Invalid storage path';
  end if;

  if v_mime_type is null then
    raise exception 'Mime type is required';
  end if;

  if v_media_type = 'IMAGE'
     and v_mime_type not in (
       'image/jpeg',
       'image/png',
       'image/webp'
     ) then
    raise exception 'Invalid image mime type';
  end if;

  if v_media_type = 'VIDEO'
     and v_mime_type not in (
       'video/mp4',
       'video/webm'
     ) then
    raise exception 'Invalid video mime type';
  end if;

  if v_media_type = 'IMAGE' then
    v_is_primary := not exists (
      select 1
      from public.product_media as pm
      where pm.product_id = p_product_id
        and pm.media_type = 'IMAGE'
    );
  end if;

  insert into public.product_media (
    product_id,
    media_type,
    storage_path,
    original_name,
    mime_type,
    is_primary
  )
  values (
    p_product_id,
    v_media_type,
    v_storage_path,
    v_original_name,
    v_mime_type,
    v_is_primary
  )
  returning id into v_media_id;

  return v_media_id;
end;
$$;


-- create_order_from_cart
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

  -- MFA (aal2) session of an active, non-archived customer is required.
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

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
  where c.customer_id = v_customer_id
  for update;

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

  -- Lock cart rows, products and prices while the order is created.
  perform 1
  from public.cart_items as ci
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  where ci.cart_id = v_cart_id
  order by p.id
  for update of ci, p, pp;

  -- Reject inactive products, products in inactive categories and
  -- products without prices.
  if exists (
    select 1
    from public.cart_items as ci
    left join public.products as p
      on p.id = ci.product_id
    left join public.product_prices as pp
      on pp.product_id = ci.product_id
    left join public.categories as cat
      on cat.id = p.category_id
    where ci.cart_id = v_cart_id
      and (
        p.id is null
        or p.active = false
        or pp.product_id is null
        or (
          p.category_id is not null
          and not private.is_category_available(p.category_id)
        )
      )
  ) then
    raise exception 'Cart contains unavailable product';
  end if;

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

  -- Total is calculated in the database from the customer's real group.
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

  -- SKU and prices are stored as a snapshot.
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

  update public.products as p
  set
    stock = p.stock - ci.quantity,
    updated_at = now()
  from public.cart_items as ci
  where ci.cart_id = v_cart_id
    and p.id = ci.product_id;

  delete from public.cart_items
  where cart_id = v_cart_id;

  update public.carts
  set updated_at = now()
  where id = v_cart_id;

  return v_order_id;
end;
$$;


-- delete_admin_product_media
create or replace function public.delete_admin_product_media(
  p_media_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
  v_storage_path text;
  v_was_primary boolean;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to delete product media';
  end if;

  select
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.is_primary
  into
    v_product_id,
    v_media_type,
    v_storage_path,
    v_was_primary
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  delete from public.product_media
  where id = p_media_id;

  if v_media_type = 'IMAGE'
     and v_was_primary = true then

    update public.product_media
    set is_primary = true
    where id = (
      select pm.id
      from public.product_media as pm
      where pm.product_id = v_product_id
        and pm.media_type = 'IMAGE'
      order by
        pm.sort_order,
        pm.created_at,
        pm.id
      limit 1
    );

  end if;

  return v_storage_path;
end;
$$;


-- get_admin_customer_delete_status
create or replace function public.get_admin_customer_delete_status(
  p_customer_id uuid
)
returns table (
  archived boolean,
  order_count bigint,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to check customer deletion';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  return query
  select
    cp.archived_at is not null as archived,
    count(o.id)::bigint as order_count,
    (
      cp.archived_at is not null
      and count(o.id) = 0
    ) as can_delete
  from public.customer_profiles as cp
  left join public.orders as o
    on o.customer_id = cp.id
  where cp.id = p_customer_id
  group by
    cp.id,
    cp.archived_at;
end;
$$;


-- get_admin_customers
create or replace function public.get_admin_customers()
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
  if not private.is_active_owner() then
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
    count(o.id)::bigint as order_count,
    (
      cp.archived_at is not null
      and count(o.id) = 0
    ) as can_permanently_delete,
    cp.created_at
  from public.customer_profiles as cp
  left join auth.users as au
    on au.id = cp.id
  left join public.orders as o
    on o.customer_id = cp.id
  group by
    cp.id,
    au.email,
    cp.company_name,
    cp.contact_name,
    cp.phone,
    cp.price_group,
    cp.active,
    cp.archived_at,
    cp.created_at
  order by
    (cp.archived_at is not null) asc,
    cp.created_at desc;
end;
$$;


-- get_admin_order_items
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
  if not private.is_active_owner() then
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


-- get_admin_orders
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
  if not private.is_active_owner() then
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


-- get_admin_product_media
create or replace function public.get_admin_product_media(
  p_product_id uuid
)
returns table (
  id uuid,
  product_id uuid,
  media_type text,
  storage_path text,
  original_name text,
  mime_type text,
  sort_order integer,
  is_primary boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to view product media';
  end if;

  return query
  select
    pm.id,
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.original_name,
    pm.mime_type,
    pm.sort_order,
    pm.is_primary,
    pm.created_at
  from public.product_media as pm
  where pm.product_id = p_product_id
  order by
    pm.media_type,
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;


-- get_customer_cart
create or replace function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity integer,
  unit_price numeric,
  line_total numeric,
  stock integer,
  available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as product_id,
    p.sku,
    p.name,
    ci.quantity,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as unit_price,
    (
      ci.quantity *
      case cp.price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end
    ) as line_total,
    p.stock,
    (
      p.active = true
      and (
        p.category_id is null
        or private.is_category_available(p.category_id)
      )
    ) as available
  from public.customer_profiles as cp
  join public.carts as c
    on c.customer_id = cp.id
  join public.cart_items as ci
    on ci.cart_id = c.id
  join public.products as p
    on p.id = ci.product_id
  join public.product_prices as pp
    on pp.product_id = p.id
  left join public.categories as cat
    on cat.id = p.category_id
  where cp.id = auth.uid()
    and cp.active = true
    and cp.archived_at is null
    and private.has_aal2()
  order by ci.created_at;
$$;


-- get_customer_order_items
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
    and cp.archived_at is null
    and private.has_aal2()
  order by oi.created_at;
$$;


-- get_customer_orders
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
    and cp.archived_at is null
    and private.has_aal2()
  order by o.created_at desc;
$$;


-- get_customer_product_media
create or replace function public.get_customer_product_media(
  p_product_id uuid
)
returns table (
  id uuid,
  media_type text,
  storage_path text,
  original_name text,
  mime_type text,
  is_primary boolean,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin

  -- MFA (aal2) session of an active, non-archived customer is required.
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = auth.uid()
      and cp.active = true
  ) then
    raise exception 'Not authorized to view product media';
  end if;

  if not exists (
    select 1
    from public.products as p
    left join public.categories as c
      on c.id = p.category_id
    where p.id = p_product_id
      and p.active = true
      and (
        p.category_id is null
        or private.is_category_available(p.category_id)
      )
  ) then
    raise exception 'Product not available';
  end if;

  return query
  select
    pm.id,
    pm.media_type,
    pm.storage_path,
    pm.original_name,
    pm.mime_type,
    pm.is_primary,
    pm.sort_order
  from public.product_media as pm
  where pm.product_id = p_product_id
  order by
    case
      when pm.media_type = 'IMAGE' then 0
      else 1
    end,
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;


-- remove_from_cart
create or replace function public.remove_from_cart(
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_deleted_id uuid;
begin

  -- MFA (aal2) session of an active, non-archived customer is required.
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = v_customer_id
      and cp.active = true
  ) then
    raise exception 'Active customer profile required';
  end if;

  delete from public.cart_items as ci
  using public.carts as c
  where ci.cart_id = c.id
    and c.customer_id = v_customer_id
    and ci.product_id = p_product_id
  returning ci.id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Cart item not found';
  end if;
end;
$$;


-- restore_admin_customer
create or replace function public.restore_admin_customer(
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to restore customers';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  update public.customer_profiles
  set
    archived_at = null,
    active = false,
    updated_at = now()
  where id = p_customer_id;

  return true;
end;
$$;


-- set_admin_product_primary_media
create or replace function public.set_admin_product_primary_media(
  p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update product media';
  end if;

  select
    pm.product_id,
    pm.media_type
  into
    v_product_id,
    v_media_type
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  if v_media_type <> 'IMAGE' then
    raise exception 'Only images can be primary';
  end if;

  update public.product_media
  set is_primary = false
  where product_id = v_product_id
    and media_type = 'IMAGE'
    and is_primary = true;

  update public.product_media
  set is_primary = true
  where id = p_media_id;
end;
$$;


-- set_customer_active
create or replace function public.set_customer_active(
  target_customer_id uuid,
  new_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to change customer active status';
  end if;

  if not exists (
    select 1
    from public.customer_profiles as cp
    where cp.id = target_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  if new_active = true
    and exists (
      select 1
      from public.customer_profiles as cp
      where cp.id = target_customer_id
        and cp.archived_at is not null
    )
  then
    raise exception 'Archived customer cannot be activated';
  end if;

  update public.customer_profiles
  set
    active = new_active,
    updated_at = now()
  where id = target_customer_id;

  return new_active;
end;
$$;


-- set_customer_price_group
create or replace function public.set_customer_price_group(
  target_customer_id uuid,
  new_price_group public.customer_price_group
)
returns public.customer_price_group
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  old_price_group public.customer_price_group;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_active_owner() then
    raise exception 'Not authorized to change customer price group';
  end if;

  select price_group
  into old_price_group
  from public.customer_profiles
  where id = target_customer_id
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  if old_price_group = new_price_group then
    return old_price_group;
  end if;

  update public.customer_profiles
  set
    price_group = new_price_group,
    updated_at = now()
  where id = target_customer_id;

  insert into public.price_group_audit (
    customer_id,
    changed_by,
    old_price_group,
    new_price_group
  )
  values (
    target_customer_id,
    current_user_id,
    old_price_group,
    new_price_group
  );

  return new_price_group;
end;
$$;


-- update_admin_customer_profile
create or replace function public.update_admin_customer_profile(
  p_customer_id uuid,
  p_company_name text,
  p_contact_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update customers';
  end if;

  if p_customer_id is null then
    raise exception 'Customer id is required';
  end if;

  if nullif(trim(p_company_name), '') is null then
    raise exception 'Company name is required';
  end if;

  if nullif(trim(p_contact_name), '') is null then
    raise exception 'Contact name is required';
  end if;

  update public.customer_profiles
  set
    company_name = trim(p_company_name),
    contact_name = trim(p_contact_name),
    phone = nullif(trim(p_phone), ''),
    updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;


-- update_admin_order_status
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
  if not private.is_active_owner() then
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


-- update_admin_product
create or replace function public.update_admin_product(
  p_product_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update products';
  end if;

  if p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  if p_normal_price < 0
     or p_dealer_price < 0
     or p_vip_price < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  update public.products
  set
    stock = p_stock,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  update public.product_prices
  set
    normal_price = p_normal_price,
    dealer_price = p_dealer_price,
    vip_price = p_vip_price,
    updated_at = now()
  where product_id = p_product_id;

  if not found then
    raise exception 'Product prices not found';
  end if;
end;
$$;


-- update_admin_product_active
create or replace function public.update_admin_product_active(
  p_product_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update product status';
  end if;

  update public.products
  set
    active = p_active,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;


-- update_admin_product_content
create or replace function public.update_admin_product_content(
  p_product_id uuid,
  p_name text,
  p_description text,
  p_category_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_description text;
begin
  if not private.is_active_owner() then
    raise exception 'Not authorized to update product content';
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    raise exception 'Product name is required';
  end if;

  v_description := nullif(trim(p_description), '');

  if p_category_id is not null
     and not exists (
       select 1
       from public.categories as c
       where c.id = p_category_id
     ) then
    raise exception 'Category not found';
  end if;

  update public.products
  set
    name = v_name,
    description = v_description,
    category_id = p_category_id,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;


-- Functions that returned the whole catalog / product list, and the old
-- category overloads without a parent. The application uses the paginated
-- and parent-aware versions now.
drop function if exists public.get_customer_catalog();
drop function if exists public.get_admin_products();
drop function if exists public.create_admin_category(text, text, integer, boolean);
drop function if exists public.update_admin_category(uuid, text, text, integer, boolean);


-- Restrictive RLS: profile rows are only readable from aal2 sessions.
create policy "Customer profiles require MFA session"
on public.customer_profiles
as restrictive
for all
to authenticated
using ((select private.has_aal2()))
with check ((select private.has_aal2()));

create policy "Staff profiles require MFA session"
on public.staff_profiles
as restrictive
for all
to authenticated
using ((select private.has_aal2()))
with check ((select private.has_aal2()));


-- Storage: reads need an aal2 customer or OWNER session; writes need an
-- aal2 OWNER session and a "<product uuid>/<uuid>.<ext>" object name
-- (or "<uuid>-thumb.webp" for catalog thumbnails).
drop policy if exists "Authenticated users can read product media" on storage.objects;
drop policy if exists "Owners can upload product media" on storage.objects;
drop policy if exists "Owners can update product media" on storage.objects;
drop policy if exists "Owners can delete product media" on storage.objects;

create policy "MFA customers and owners can read product media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-media'
  and (
    (select private.is_active_owner())
    or (select private.active_customer_price_group()) is not null
  )
);

create policy "MFA owners can upload product media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-media'
  and (select private.is_active_owner())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-thumb\.webp|\.(jpg|png|webp|mp4|webm))$'
);

create policy "MFA owners can delete product media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-media'
  and (select private.is_active_owner())
);


-- Data API pre-request hook. Runs as the request role (SECURITY INVOKER).
create or replace function private.check_request()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  -- Only user sessions are checked; anon has no table/function grants and
  -- service_role is server-side only.
  if current_user = 'authenticated' then
    if not private.has_aal2() then
      raise exception using
        errcode = '42501',
        message = 'MFA required';
    end if;
  end if;
end;
$$;

revoke all on all functions in schema private from public, anon;

grant usage on schema private to anon;
grant execute on function private.check_request() to anon, authenticated, service_role;
grant execute on function private.has_aal2() to authenticated, service_role;
grant execute on function private.is_active_owner() to authenticated, service_role;
grant execute on function private.active_customer_price_group() to authenticated, service_role;
grant execute on function private.is_category_available(uuid) to authenticated, service_role;
grant execute on function private.category_subtree(uuid) to authenticated, service_role;
grant execute on function private.like_pattern(text) to authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'private.check_request';

notify pgrst, 'reload config';
