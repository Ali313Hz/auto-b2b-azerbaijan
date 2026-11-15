-- Customer favorites ("Seçilmişlər"), forward-only, new table only:
--   customer_favorites(customer_id, product_id, created_at), one row per
--   pair. No direct table access: customers use the RPCs below, which only
--   ever touch the signed-in customer's own rows. A product that is no
--   longer on sale stays in the list but is shown as not available (never
--   with a price or an "add to cart" button).

create table public.customer_favorites (
  customer_id uuid not null references public.customer_profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);

-- "Seçilmişlər" page: newest first per customer.
create index customer_favorites_customer_created_idx
  on public.customer_favorites (customer_id, created_at desc);

-- Foreign key lookups when a product row is changed.
create index customer_favorites_product_idx
  on public.customer_favorites (product_id);

alter table public.customer_favorites enable row level security;
revoke all on public.customer_favorites from public, anon, authenticated;


-- Adds (p_favorite = true) or removes a favorite. Adding a product that is
-- not on sale is refused; removing always works. Repeating changes nothing.
create function public.set_customer_favorite(p_product_id uuid, p_favorite boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select auth.uid());
begin
  if private.active_customer_price_group() is null then
    raise exception 'Active customer profile required';
  end if;

  if p_favorite is null then
    raise exception 'Invalid favorite';
  end if;

  if p_favorite then
    if not private.is_product_available(p_product_id)
       or not exists (select 1 from public.product_prices as pp where pp.product_id = p_product_id) then
      raise exception 'Product not found';
    end if;

    insert into public.customer_favorites (customer_id, product_id)
    values (v_customer, p_product_id)
    on conflict (customer_id, product_id) do nothing;
  else
    delete from public.customer_favorites
    where customer_id = v_customer
      and product_id = p_product_id;
  end if;

  return p_favorite;
end;
$$;

revoke execute on function public.set_customer_favorite(uuid, boolean) from public, anon;
grant execute on function public.set_customer_favorite(uuid, boolean) to authenticated;


-- Which of these products (one catalog page) are the customer's favorites.
create function public.get_customer_favorite_ids(p_product_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.product_id
  from public.customer_favorites as f
  where f.customer_id = (select auth.uid())
    and private.active_customer_price_group() is not null
    and f.product_id = any ((coalesce(p_product_ids, '{}'::uuid[]))[1:200]);
$$;

revoke execute on function public.get_customer_favorite_ids(uuid[]) from public, anon;
grant execute on function public.get_customer_favorite_ids(uuid[]) to authenticated;


-- One page of the customer's favorites, newest first. Price and stock only
-- for products that are on sale (available = true).
create function public.get_customer_favorites_page(
  p_page integer default 1,
  p_page_size integer default 24
)
returns table (
  id uuid,
  sku text,
  name text,
  available boolean,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
  category_name text,
  primary_image_path text,
  favorited_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.customer_price_group := private.active_customer_price_group();
  v_size integer := least(greatest(coalesce(p_page_size, 24), 1), 100);
  v_page integer := least(greatest(coalesce(p_page, 1), 1), 10000);
begin
  if v_group is null then
    raise exception 'Active customer profile required';
  end if;

  return query
  with mine as materialized (
    select f.product_id, f.created_at
    from public.customer_favorites as f
    where f.customer_id = (select auth.uid())
  ),
  page as (
    select m.*
    from mine as m
    order by m.created_at desc, m.product_id
    limit v_size
    offset (v_page - 1) * v_size
  ),
  detail as (
    select
      p.id,
      p.sku,
      p.name,
      private.is_product_available(p.id) and pp.product_id is not null as available,
      p.stock,
      private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price,
      private.group_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      c.name as category_name,
      pm.storage_path,
      pg.created_at
    from page as pg
    join public.products as p
      on p.id = pg.product_id
    left join public.product_prices as pp
      on pp.product_id = p.id
    left join public.categories as c
      on c.id = p.category_id
    left join public.product_media as pm
      on pm.product_id = p.id
      and pm.media_type = 'IMAGE'
      and pm.is_primary = true
  )
  select
    r.id,
    r.sku,
    r.name,
    r.available,
    case when r.available then r.stock end,
    case when r.available then r.price end,
    case when r.available then r.regular_price end,
    r.available and r.price < r.regular_price,
    case when r.available then r.category_name end,
    r.storage_path,
    r.created_at,
    (select count(*) from mine)
  from detail as r
  order by r.created_at desc, r.id;
end;
$$;

revoke execute on function public.get_customer_favorites_page(integer, integer) from public, anon;
grant execute on function public.get_customer_favorites_page(integer, integer) to authenticated;
