-- Faster customer catalog with many products (same result, same rules).
-- Before: the customer's price was worked out for every matching product
-- on every page load (about 0.25 s at 10 000 products). Now it is worked
-- out only for the 24 products of the page, unless the list is sorted by
-- price or filtered to sale items, which need it for every product.
-- Nothing else changes; no data is touched.

create or replace function public.get_customer_catalog_page(
  p_page integer default 1,
  p_page_size integer default 24,
  p_category_slug text default null,
  p_search text default null,
  p_sort text default 'name',
  p_include_subcategories boolean default true,
  p_on_sale boolean default false
)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
  category_id uuid,
  category_name text,
  category_slug text,
  primary_image_path text,
  availability public.product_availability,
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
  v_on_sale boolean := coalesce(p_on_sale, false);
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

    if v_category_id is null then
      return;
    end if;
  end if;

  return query
  with available_categories as materialized (
    select a.id from private.available_category_ids() as a(id)
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
  priced as (
    select
      p.id,
      p.sku,
      p.name,
      p.stock,
      p.category_id,
      p.created_at,
      p.availability,
      pp.normal_price,
      pp.dealer_price,
      pp.vip_price,
      pp.sale_price,
      -- The price is only worked out for every product when the list is
      -- sorted or filtered by it; otherwise only for the page below.
      case
        when v_on_sale or v_sort in ('price_asc', 'price_desc') then
          private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
      end as sort_price,
      case
        when v_on_sale then
          private.group_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price)
      end as sort_regular
    from public.products as p
    join public.product_prices as pp
      on pp.product_id = p.id
    where p.active = true
      and (not v_on_sale or pp.sale_price is not null)
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
  filtered as materialized (
    select pr.*
    from priced as pr
    where not v_on_sale or pr.sort_price < pr.sort_regular
  ),
  page as (
    select f.*
    from filtered as f
    order by
      case when v_sort = 'name' then f.name end,
      case when v_sort = 'sku' then f.sku end,
      case when v_sort = 'price_asc' then f.sort_price end,
      case when v_sort = 'price_desc' then f.sort_price end desc,
      case when v_sort = 'newest' then f.created_at end desc,
      f.id
    limit v_size
    offset (v_page - 1) * v_size
  ),
  page_priced as (
    select
      pg0.*,
      private.effective_price(v_price_group, pg0.normal_price, pg0.dealer_price, pg0.vip_price, pg0.sale_price) as price,
      private.group_price(v_price_group, pg0.normal_price, pg0.dealer_price, pg0.vip_price) as regular_price
    from page as pg0
  )
  select
    pg.id,
    pg.sku,
    pg.name,
    pg.stock,
    pg.price,
    pg.regular_price,
    pg.price < pg.regular_price,
    c.id,
    c.name,
    c.slug,
    pm.storage_path,
    pg.availability,
    (select count(*) from filtered)
  from page_priced as pg
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
