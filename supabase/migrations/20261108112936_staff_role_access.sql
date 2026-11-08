-- Staff role access for the admin panel. Every admin RPC now names the
-- roles that may call it; the UI only mirrors these rules.
--
--   OWNER            everything (staff, audit, logins, archive/delete)
--   SALES            customers (view, profile, price group, active) + orders
--   PRODUCT_MANAGER  products, prices, stock, media, categories
--   WAREHOUSE        product list without prices, stock, orders (view/process)
--   SUPPORT          customers and orders, read only
--
-- Staff management, audit log, customer logins/passwords, archive, restore
-- and deletion stay OWNER-only (private.is_active_owner / is_owner).
-- Roles use the same account rules as before: active, current session, no
-- pending temporary password. MFA stays optional.


-- Calling staff member has one of the given roles.
create or replace function private.staff_can(p_roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.mfa_satisfied()
    and coalesce(private.current_staff_role() = any(p_roles), false);
$$;

revoke all on function private.staff_can(public.staff_role[]) from public, anon;
grant execute on function private.staff_can(public.staff_role[]) to authenticated, service_role;


-- Role of the signed-in staff member under the rules above (null for
-- customers, inactive staff, stale sessions or pending temporary password).
create or replace function public.get_my_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.mfa_satisfied() then private.current_staff_role() end;
$$;

revoke execute on function public.get_my_staff_role() from public, anon;
grant execute on function public.get_my_staff_role() to authenticated;


-- Stock only (WAREHOUSE); prices stay with OWNER / PRODUCT_MANAGER.
create or replace function public.update_admin_product_stock(
  p_product_id uuid,
  p_stock integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to update stock';
  end if;

  if p_stock is null or p_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;

  update public.products
  set
    stock = p_stock,
    updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;

revoke execute on function public.update_admin_product_stock(uuid, integer) from public, anon;
grant execute on function public.update_admin_product_stock(uuid, integer) to authenticated;


-- Admin RPCs with their allowed roles. Bodies are unchanged except the
-- authorization line (and prices hidden from WAREHOUSE in the product
-- reads).

-- get_admin_customers(): OWNER, SALES, SUPPORT
CREATE OR REPLACE FUNCTION public.get_admin_customers()
 RETURNS TABLE(id uuid, email text, company_name text, contact_name text, phone text, price_group customer_price_group, active boolean, archived_at timestamp with time zone, order_count bigint, can_permanently_delete boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]) then
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
$function$;


-- set_customer_active(uuid,boolean): OWNER, SALES
CREATE OR REPLACE FUNCTION public.set_customer_active(target_customer_id uuid, new_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
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
$function$;


-- set_customer_price_group(uuid,customer_price_group): OWNER, SALES
CREATE OR REPLACE FUNCTION public.set_customer_price_group(target_customer_id uuid, new_price_group customer_price_group)
 RETURNS customer_price_group
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid;
  old_price_group public.customer_price_group;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
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
$function$;


-- update_admin_customer_profile(uuid,text,text,text): OWNER, SALES
CREATE OR REPLACE FUNCTION public.update_admin_customer_profile(p_customer_id uuid, p_company_name text, p_contact_name text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
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
$function$;


-- get_admin_orders(): OWNER, SALES, WAREHOUSE, SUPPORT
CREATE OR REPLACE FUNCTION public.get_admin_orders()
 RETURNS TABLE(order_id uuid, customer_id uuid, email text, company_name text, contact_name text, price_group customer_price_group, status order_status, total_amount numeric, item_count bigint, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
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
$function$;


-- get_admin_order_items(uuid): OWNER, SALES, WAREHOUSE, SUPPORT
CREATE OR REPLACE FUNCTION public.get_admin_order_items(p_order_id uuid)
 RETURNS TABLE(id uuid, product_id uuid, sku text, quantity integer, unit_price numeric, line_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
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
$function$;


-- update_admin_order_status(uuid,order_status): OWNER, SALES, WAREHOUSE
CREATE OR REPLACE FUNCTION public.update_admin_order_status(p_order_id uuid, p_status order_status)
 RETURNS order_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current_status public.order_status;
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE']::public.staff_role[]) then
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
$function$;


-- get_admin_products_page(integer,integer,text,uuid,text,boolean,text): OWNER, PRODUCT_MANAGER, WAREHOUSE
CREATE OR REPLACE FUNCTION public.get_admin_products_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_low_stock boolean DEFAULT false, p_sort text DEFAULT 'newest'::text)
 RETURNS TABLE(id uuid, sku text, name text, stock integer, active boolean, category_id uuid, category_name text, normal_price numeric, dealer_price numeric, vip_price numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prices boolean := private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
  v_sort text := coalesce(p_sort, 'newest');
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view admin products';
  end if;

  if v_sort not in ('newest', 'name', 'sku', 'stock') then
    v_sort := 'newest';
  end if;

  return query
  with filtered as materialized (
    select p.id, p.sku, p.name, p.stock, p.active, p.category_id, p.created_at
    from public.products as p
    where (
        p_category_id is null
        or p.category_id in (select s from private.category_subtree(p_category_id) as s)
      )
      and (
        p_status is null
        or (p_status = 'active' and p.active = true)
        or (p_status = 'inactive' and p.active = false)
      )
      and (
        coalesce(p_low_stock, false) = false
        or (p.active = true and p.stock <= 5)
      )
      and (
        v_search is null
        or p.name ilike private.like_pattern(v_search)
        or p.sku ilike private.like_pattern(v_search)
      )
  ),
  page as (
    select f.*
    from filtered as f
    order by
      case when v_sort = 'name' then f.name end,
      case when v_sort = 'sku' then f.sku end,
      case when v_sort = 'stock' then f.stock end,
      case when v_sort = 'newest' then f.created_at end desc,
      f.id
    limit v_size
    offset (v_page - 1) * v_size
  )
  select
    pg.id,
    pg.sku,
    pg.name,
    pg.stock,
    pg.active,
    pg.category_id,
    c.name,
    case when v_prices then pp.normal_price end,
    case when v_prices then pp.dealer_price end,
    case when v_prices then pp.vip_price end,
    (select count(*) from filtered)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  left join public.product_prices as pp
    on pp.product_id = pg.id
  order by
    case when v_sort = 'name' then pg.name end,
    case when v_sort = 'sku' then pg.sku end,
    case when v_sort = 'stock' then pg.stock end,
    case when v_sort = 'newest' then pg.created_at end desc,
    pg.id;
end;
$function$;


-- get_admin_product(uuid): OWNER, PRODUCT_MANAGER, WAREHOUSE
CREATE OR REPLACE FUNCTION public.get_admin_product(p_product_id uuid)
 RETURNS TABLE(id uuid, sku text, name text, description text, stock integer, active boolean, category_id uuid, category_name text, normal_price numeric, dealer_price numeric, vip_price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prices boolean := private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]);
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view admin products';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.stock,
    p.active,
    p.category_id,
    c.name,
    case when v_prices then pp.normal_price end,
    case when v_prices then pp.dealer_price end,
    case when v_prices then pp.vip_price end
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_prices as pp
    on pp.product_id = p.id
  where p.id = p_product_id;
end;
$function$;


-- get_admin_product_media(uuid): OWNER, PRODUCT_MANAGER, WAREHOUSE
CREATE OR REPLACE FUNCTION public.get_admin_product_media(p_product_id uuid)
 RETURNS TABLE(id uuid, product_id uuid, media_type text, storage_path text, original_name text, mime_type text, sort_order integer, is_primary boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
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
$function$;


-- get_admin_categories(): OWNER, PRODUCT_MANAGER, WAREHOUSE
CREATE OR REPLACE FUNCTION public.get_admin_categories()
 RETURNS TABLE(id uuid, name text, slug text, active boolean, sort_order integer, parent_id uuid, depth integer, path text, available boolean, product_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view admin categories';
  end if;

  return query
  with recursive tree as (
    select
      c.id,
      1 as depth,
      c.name::text as path,
      c.active as available,
      array[lpad(c.sort_order::text, 10, '0') || c.name || c.id::text] as sort_key
    from public.categories as c
    where c.parent_id is null

    union all

    select
      c.id,
      t.depth + 1,
      t.path || ' / ' || c.name,
      t.available and c.active,
      t.sort_key || (lpad(c.sort_order::text, 10, '0') || c.name || c.id::text)
    from public.categories as c
    join tree as t
      on c.parent_id = t.id
    where t.depth < 10
  ),
  counts as (
    select p.category_id, count(*) as product_count
    from public.products as p
    where p.category_id is not null
    group by p.category_id
  )
  select
    c.id,
    c.name,
    c.slug,
    c.active,
    c.sort_order,
    c.parent_id,
    t.depth,
    t.path,
    t.available,
    coalesce(n.product_count, 0)
  from tree as t
  join public.categories as c
    on c.id = t.id
  left join counts as n
    on n.category_id = c.id
  order by t.sort_key;
end;
$function$;


-- create_admin_product(text,uuid,integer,numeric,numeric,numeric,boolean): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.create_admin_product(p_sku text, p_category_id uuid, p_stock integer, p_normal_price numeric, p_dealer_price numeric, p_vip_price numeric, p_active boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_sku text;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- update_admin_product(uuid,integer,numeric,numeric,numeric): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.update_admin_product(p_product_id uuid, p_stock integer, p_normal_price numeric, p_dealer_price numeric, p_vip_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- update_admin_product_active(uuid,boolean): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.update_admin_product_active(p_product_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- update_admin_product_content(uuid,text,text,uuid): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.update_admin_product_content(p_product_id uuid, p_name text, p_description text, p_category_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
  v_description text;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- create_admin_product_media(uuid,text,text,text,text): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.create_admin_product_media(p_product_id uuid, p_media_type text, p_storage_path text, p_original_name text, p_mime_type text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_media_id uuid;
  v_media_type text;
  v_storage_path text;
  v_original_name text;
  v_mime_type text;
  v_is_primary boolean := false;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- delete_admin_product_media(uuid): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.delete_admin_product_media(p_media_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_media_type text;
  v_storage_path text;
  v_was_primary boolean;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- set_admin_product_primary_media(uuid): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.set_admin_product_primary_media(p_media_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product_id uuid;
  v_media_type text;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
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
$function$;


-- create_admin_category(text,text,integer,boolean,uuid): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.create_admin_category(p_name text, p_slug text, p_sort_order integer, p_active boolean, p_parent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_category_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to create categories';
  end if;

  if v_name is null or length(v_name) > 100 then
    raise exception 'Category name is required';
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80 then
    raise exception 'Category slug is required';
  end if;

  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'Sort order cannot be negative';
  end if;

  if p_active is null then
    raise exception 'Active status is required';
  end if;

  if p_parent_id is not null
     and not exists (
       select 1 from public.categories as c where c.id = p_parent_id
     ) then
    raise exception 'Parent category not found';
  end if;

  if exists (
    select 1 from public.categories as c where c.slug = v_slug
  ) then
    raise exception 'Category slug already exists';
  end if;

  insert into public.categories (name, slug, sort_order, active, parent_id)
  values (v_name, v_slug, p_sort_order, p_active, p_parent_id)
  returning id into v_category_id;

  return v_category_id;
end;
$function$;


-- update_admin_category(uuid,text,text,integer,boolean,uuid): OWNER, PRODUCT_MANAGER
CREATE OR REPLACE FUNCTION public.update_admin_category(p_category_id uuid, p_name text, p_slug text, p_sort_order integer, p_active boolean, p_parent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update categories';
  end if;

  if v_name is null or length(v_name) > 100 then
    raise exception 'Category name is required';
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(v_slug) > 80 then
    raise exception 'Category slug is required';
  end if;

  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'Sort order cannot be negative';
  end if;

  if p_active is null then
    raise exception 'Active status is required';
  end if;

  if p_parent_id is not null
     and not exists (
       select 1 from public.categories as c where c.id = p_parent_id
     ) then
    raise exception 'Parent category not found';
  end if;

  if exists (
    select 1
    from public.categories as c
    where c.slug = v_slug
      and c.id <> p_category_id
  ) then
    raise exception 'Category slug already exists';
  end if;

  update public.categories
  set
    name = v_name,
    slug = v_slug,
    sort_order = p_sort_order,
    active = p_active,
    parent_id = p_parent_id,
    updated_at = now()
  where id = p_category_id;

  if not found then
    raise exception 'Category not found';
  end if;
end;
$function$;


-- get_admin_dashboard_stats(): OWNER, SALES, PRODUCT_MANAGER, SUPPORT, WAREHOUSE
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS TABLE(total_products bigint, active_products bigint, low_stock_products bigint, active_customers bigint, pending_orders bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.staff_can(array['OWNER', 'SALES', 'PRODUCT_MANAGER', 'SUPPORT', 'WAREHOUSE']::public.staff_role[]) then
    raise exception 'Not authorized to view dashboard';
  end if;

  return query
  select
    (select count(*) from public.products),
    (select count(*) from public.products as p where p.active),
    (select count(*) from public.products as p where p.active and p.stock <= 5),
    (
      select count(*)
      from public.customer_profiles as cp
      where cp.active and cp.archived_at is null
    ),
    (select count(*) from public.orders as o where o.status = 'PENDING');
end;
$function$;


-- Product media files: OWNER and PRODUCT_MANAGER may write.

drop policy if exists "Owners can upload product media" on storage.objects;
drop policy if exists "Owners can update product media" on storage.objects;
drop policy if exists "Owners can delete product media" on storage.objects;

create policy "Product managers can upload product media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-media'
  and (select private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]))
);

create policy "Product managers can update product media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-media'
  and (select private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]))
)
with check (
  bucket_id = 'product-media'
  and (select private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]))
);

create policy "Product managers can delete product media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-media'
  and (select private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]))
);
