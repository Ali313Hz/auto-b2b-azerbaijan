-- Server-side paginated catalog and admin product list.
--
-- Every list RPC returns one page (max 100 rows) plus the total count.
-- Customer prices are chosen in the database from the caller's own price
-- group; other groups' prices are never returned to customers.

-- Substring search on product name and SKU (ILIKE '%term%'). Measured on
-- 10k products: sequential ILIKE scan ~5 ms per search; trigram GIN indexes
-- let Postgres use a bitmap index scan instead. See the PR/report for the
-- EXPLAIN comparison.
create extension if not exists pg_trgm with schema extensions;

create index products_name_trgm_idx
on public.products
using gin (name extensions.gin_trgm_ops);

create index products_sku_trgm_idx
on public.products
using gin (sku extensions.gin_trgm_ops);


-- Escapes LIKE wildcards so search text is matched literally.
create or replace function private.like_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke all on function private.like_pattern(text) from public, anon;
grant execute on function private.like_pattern(text) to authenticated, service_role;


-- Category and all of its descendants (tree depth is at most 3).
create or replace function private.category_subtree(p_category_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive subtree as (
    select c.id, 1 as level
    from public.categories as c
    where c.id = p_category_id

    union all

    select c.id, s.level + 1
    from public.categories as c
    join subtree as s
      on c.parent_id = s.id
    where s.level < 10
  )
  select id from subtree;
$$;

revoke all on function private.category_subtree(uuid) from public, anon;
grant execute on function private.category_subtree(uuid) to authenticated, service_role;


-- Customer: available category tree for navigation ----------------------

create or replace function public.get_customer_categories()
returns table (
  id uuid,
  name text,
  slug text,
  parent_id uuid,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  return query
  select c.id, c.name, c.slug, c.parent_id, c.sort_order
  from public.categories as c
  where private.is_category_available(c.id)
  order by c.sort_order, c.name;
end;
$$;

revoke execute on function public.get_customer_categories() from public, anon;
grant execute on function public.get_customer_categories() to authenticated;


-- Customer: one catalog page -------------------------------------------

create or replace function public.get_customer_catalog_page(
  p_page integer default 1,
  p_page_size integer default 24,
  p_category_slug text default null,
  p_search text default null,
  p_sort text default 'name',
  p_include_subcategories boolean default true
)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  price numeric,
  category_id uuid,
  category_name text,
  category_slug text,
  primary_image_path text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_price_group public.customer_price_group := private.active_customer_price_group();
  v_size integer := least(greatest(coalesce(p_page_size, 24), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
  v_sort text := coalesce(p_sort, 'name');
  v_category_id uuid;
begin
  if v_price_group is null then
    raise exception 'Active customer profile required';
  end if;

  if v_sort not in ('name', 'price_asc', 'price_desc', 'newest', 'sku') then
    v_sort := 'name';
  end if;

  if nullif(trim(p_category_slug), '') is not null then
    select c.id
    into v_category_id
    from public.categories as c
    where c.slug = trim(p_category_slug)
      and private.is_category_available(c.id);

    -- Unknown or unavailable category: empty page, never "all products".
    if v_category_id is null then
      return;
    end if;
  end if;

  return query
  with available_categories as (
    select c.id
    from public.categories as c
    left join public.categories as parent
      on parent.id = c.parent_id
    left join public.categories as grandparent
      on grandparent.id = parent.parent_id
    where c.active
      and coalesce(parent.active, true)
      and coalesce(grandparent.active, true)
  ),
  filter_categories as (
    select s.id
    from private.category_subtree(v_category_id) as s(id)
    where v_category_id is not null
      and coalesce(p_include_subcategories, true)

    union

    select v_category_id
    where v_category_id is not null
  ),
  filtered as materialized (
    select
      p.id,
      p.sku,
      p.name,
      p.stock,
      p.category_id,
      p.created_at,
      case v_price_group
        when 'NORMAL' then pp.normal_price
        when 'DEALER' then pp.dealer_price
        when 'VIP' then pp.vip_price
      end as price
    from public.products as p
    join public.product_prices as pp
      on pp.product_id = p.id
    where p.active = true
      and (
        p.category_id is null
        or p.category_id in (select ac.id from available_categories as ac)
      )
      and (
        v_category_id is null
        or p.category_id in (select fc.id from filter_categories as fc)
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
      case when v_sort = 'price_asc' then f.price end,
      case when v_sort = 'price_desc' then f.price end desc,
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
    pg.price,
    c.id,
    c.name,
    c.slug,
    pm.storage_path,
    (select count(*) from filtered)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  left join public.product_media as pm
    on pm.product_id = pg.id
    and pm.media_type = 'IMAGE'
    and pm.is_primary = true
  order by
    case when v_sort = 'name' then pg.name end,
    case when v_sort = 'sku' then pg.sku end,
    case when v_sort = 'price_asc' then pg.price end,
    case when v_sort = 'price_desc' then pg.price end desc,
    case when v_sort = 'newest' then pg.created_at end desc,
    pg.id;
end;
$$;

revoke execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean) from public, anon;
grant execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean) to authenticated;


-- Customer: one product -------------------------------------------------

create or replace function public.get_customer_product(
  p_product_id uuid
)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  price numeric,
  category_id uuid,
  category_name text,
  category_slug text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_price_group public.customer_price_group := private.active_customer_price_group();
begin
  if v_price_group is null then
    raise exception 'Active customer profile required';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.stock,
    case v_price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end,
    c.id,
    c.name,
    c.slug
  from public.products as p
  join public.product_prices as pp
    on pp.product_id = p.id
  left join public.categories as c
    on c.id = p.category_id
  where p.id = p_product_id
    and p.active = true
    and (
      p.category_id is null
      or private.is_category_available(p.category_id)
    );
end;
$$;

revoke execute on function public.get_customer_product(uuid) from public, anon;
grant execute on function public.get_customer_product(uuid) to authenticated;


-- Admin: one product page -----------------------------------------------

create or replace function public.get_admin_products_page(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default null,
  p_category_id uuid default null,
  p_status text default null,
  p_low_stock boolean default false,
  p_sort text default 'newest'
)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  active boolean,
  category_id uuid,
  category_name text,
  normal_price numeric,
  dealer_price numeric,
  vip_price numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
  v_sort text := coalesce(p_sort, 'newest');
begin
  if not private.is_active_owner() then
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
    pp.normal_price,
    pp.dealer_price,
    pp.vip_price,
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
$$;

revoke execute on function public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text) from public, anon;
grant execute on function public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text) to authenticated;


create or replace function public.get_admin_product(
  p_product_id uuid
)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  active boolean,
  category_id uuid,
  category_name text,
  normal_price numeric,
  dealer_price numeric,
  vip_price numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
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
    pp.normal_price,
    pp.dealer_price,
    pp.vip_price
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_prices as pp
    on pp.product_id = p.id
  where p.id = p_product_id;
end;
$$;

revoke execute on function public.get_admin_product(uuid) from public, anon;
grant execute on function public.get_admin_product(uuid) to authenticated;


create or replace function public.get_admin_dashboard_stats()
returns table (
  total_products bigint,
  active_products bigint,
  low_stock_products bigint,
  active_customers bigint,
  pending_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
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
$$;

revoke execute on function public.get_admin_dashboard_stats() from public, anon;
grant execute on function public.get_admin_dashboard_stats() to authenticated;
