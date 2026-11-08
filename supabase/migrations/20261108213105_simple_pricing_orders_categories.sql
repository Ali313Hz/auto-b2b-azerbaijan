-- Simpler business model (NORMAL customers first):
--   1. Dealer / VIP prices are optional. NORMAL price stays required.
--      Existing dealer / VIP prices are kept. A customer whose group has no
--      own price pays the NORMAL price.
--   2. Sale price (endirim): product_prices.sale_price. The regular price is
--      kept; the database calculates the effective price and order items
--      snapshot it, so ending a sale never changes old orders.
--   3. Categories: recursive tree up to 10 levels (was 3). Cycles stay
--      impossible.
--   4. Orders: OWNER / SALES edit a PENDING order directly (quantity,
--      price, remove, add). Stock moves by the difference, in one locked
--      transaction. Every change is kept in order_change_log; the customer
--      sees a readable summary and is not asked to accept anything.
--      The customer-approval revision flow is switched off (its data stays).


-- ---------------------------------------------------------------------------
-- 1 + 2. Prices
-- ---------------------------------------------------------------------------

alter table public.product_prices
  alter column dealer_price drop not null,
  alter column vip_price drop not null;

alter table public.product_prices
  add column sale_price numeric(12, 2);

alter table public.product_prices
  add constraint product_prices_sale_price_check
  check (sale_price is null or (sale_price >= 0 and sale_price < normal_price));

create index product_prices_on_sale_idx
  on public.product_prices (product_id)
  where sale_price is not null;


-- Regular (not discounted) price of a customer group. Dealer / VIP fall
-- back to NORMAL when the product has no own price for the group.
create or replace function private.group_price(
  p_group public.customer_price_group,
  p_normal numeric,
  p_dealer numeric,
  p_vip numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_group
    when 'DEALER' then coalesce(p_dealer, p_normal)
    when 'VIP' then coalesce(p_vip, p_normal)
    else p_normal
  end;
$$;

-- Price the customer really pays: the sale price when it is lower than
-- the group's regular price.
create or replace function private.effective_price(
  p_group public.customer_price_group,
  p_normal numeric,
  p_dealer numeric,
  p_vip numeric,
  p_sale numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select least(
    private.group_price(p_group, p_normal, p_dealer, p_vip),
    coalesce(p_sale, private.group_price(p_group, p_normal, p_dealer, p_vip))
  );
$$;

revoke all on function private.group_price(public.customer_price_group, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function private.effective_price(public.customer_price_group, numeric, numeric, numeric, numeric) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Category tree: up to 10 levels, recursive availability
-- ---------------------------------------------------------------------------

create or replace function private.validate_category_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_depth constant integer := 10;
  v_parent_depth integer := 0;
  v_subtree_height integer := 1;
  v_cursor uuid := new.parent_id;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Category cannot be its own parent';
  end if;

  -- Serialize tree changes so two concurrent moves cannot form a cycle.
  perform pg_advisory_xact_lock(hashtext('public.categories.tree'));

  -- Walk up from the new parent. Reaching the category itself is a cycle
  -- (the category would be moved under its own descendant).
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'Category hierarchy cannot contain a cycle';
    end if;

    v_parent_depth := v_parent_depth + 1;

    if v_parent_depth > v_max_depth then
      raise exception 'Category hierarchy too deep';
    end if;

    select c.parent_id
    into v_cursor
    from public.categories as c
    where c.id = v_cursor;

    if not found then
      raise exception 'Parent category not found';
    end if;
  end loop;

  -- Height of the subtree being moved (1 = no children).
  if tg_op = 'UPDATE' then
    with recursive subtree as (
      select c.id, 1 as level
      from public.categories as c
      where c.parent_id = new.id

      union all

      select c.id, s.level + 1
      from public.categories as c
      join subtree as s
        on c.parent_id = s.id
      where s.level <= v_max_depth
    )
    select coalesce(max(level), 0) + 1
    into v_subtree_height
    from subtree;
  end if;

  if v_parent_depth + v_subtree_height > v_max_depth then
    raise exception 'Category hierarchy too deep';
  end if;

  return new;
end;
$$;


-- A category is available when it and every ancestor are active.
create or replace function private.is_category_available(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select c.parent_id, c.active, 1 as level
    from public.categories as c
    where c.id = p_category_id

    union all

    select c.parent_id, c.active, u.level + 1
    from public.categories as c
    join up as u
      on c.id = u.parent_id
    where u.level < 12
  )
  select coalesce(bool_and(up.active), false)
  from up;
$$;

revoke all on function private.is_category_available(uuid) from public, anon;
grant execute on function private.is_category_available(uuid) to authenticated, service_role;


-- Every available category (active, with active ancestors), top-down.
create or replace function private.available_category_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select c.id, 1 as level
    from public.categories as c
    where c.parent_id is null
      and c.active

    union all

    select c.id, t.level + 1
    from public.categories as c
    join tree as t
      on c.parent_id = t.id
    where c.active
      and t.level < 12
  )
  select id from tree;
$$;

revoke all on function private.available_category_ids() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Customer catalog: one effective price (the caller's), sale information,
-- optional "on sale only" filter. Other groups' prices are never returned.
-- ---------------------------------------------------------------------------

drop function if exists public.get_customer_catalog_page(integer, integer, text, text, text, boolean);

create function public.get_customer_catalog_page(
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

    -- Unknown or unavailable category: empty page, never "all products".
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
      private.group_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price
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
    select pr.*, pr.price < pr.regular_price as on_sale
    from priced as pr
    where not v_on_sale or pr.price < pr.regular_price
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
    pg.regular_price,
    pg.on_sale,
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

revoke execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.get_customer_catalog_page(integer, integer, text, text, text, boolean, boolean) to authenticated;


drop function if exists public.get_customer_product(uuid);

create function public.get_customer_product(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  name text,
  description text,
  stock integer,
  price numeric,
  regular_price numeric,
  on_sale boolean,
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
    x.id, x.sku, x.name, x.description, x.stock,
    x.price, x.regular_price, x.price < x.regular_price,
    x.category_id, x.category_name, x.category_slug
  from (
    select
      p.id,
      p.sku,
      p.name,
      p.description,
      p.stock,
      private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as price,
      private.group_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      c.id as category_id,
      c.name as category_name,
      c.slug as category_slug
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
      )
  ) as x;
end;
$$;

revoke execute on function public.get_customer_product(uuid) from public, anon;
grant execute on function public.get_customer_product(uuid) to authenticated;


drop function if exists public.get_customer_cart();

create function public.get_customer_cart()
returns table (
  product_id uuid,
  sku text,
  name text,
  quantity integer,
  unit_price numeric,
  regular_price numeric,
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
    x.product_id,
    x.sku,
    x.name,
    x.quantity,
    x.unit_price,
    x.regular_price,
    x.quantity * x.unit_price,
    x.stock,
    x.available
  from (
    select
      p.id as product_id,
      p.sku,
      p.name,
      ci.quantity,
      ci.created_at,
      private.effective_price(cp.price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price) as unit_price,
      private.group_price(cp.price_group, pp.normal_price, pp.dealer_price, pp.vip_price) as regular_price,
      p.stock,
      private.is_product_available(p.id) as available
    from public.customer_profiles as cp
    join public.carts as c
      on c.customer_id = cp.id
    join public.cart_items as ci
      on ci.cart_id = c.id
    join public.products as p
      on p.id = ci.product_id
    join public.product_prices as pp
      on pp.product_id = p.id
    where cp.id = (select auth.uid())
      and cp.active = true
      and cp.archived_at is null
      and cp.must_change_password = false
      and private.session_is_current(cp.credentials_changed_at, cp.credentials_session_id)
  ) as x
  order by x.created_at;
$$;

revoke execute on function public.get_customer_cart() from public, anon;
grant execute on function public.get_customer_cart() to authenticated;


-- Order creation: unchanged rules, effective (sale) price snapshot.
create or replace function public.create_order_from_cart()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := (select auth.uid());
  v_price_group public.customer_price_group;
  v_cart_id uuid;
  v_order_id uuid;
  v_total numeric(12, 2);
begin
  if v_customer_id is null then
    raise exception 'Authentication required';
  end if;

  v_price_group := private.current_customer_price_group();

  if v_price_group is null then
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

  if exists (
    select 1
    from public.cart_items as ci
    left join public.product_prices as pp
      on pp.product_id = ci.product_id
    where ci.cart_id = v_cart_id
      and (
        pp.product_id is null
        or not private.is_product_available(ci.product_id)
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

  -- Total and unit prices come from the database (effective price of the
  -- customer's real group, including an active sale).
  select sum(
    ci.quantity *
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
  )
  into v_total
  from public.cart_items as ci
  join public.product_prices as pp
    on pp.product_id = ci.product_id
  where ci.cart_id = v_cart_id;

  insert into public.orders (customer_id, total_amount)
  values (v_customer_id, v_total)
  returning id into v_order_id;

  -- SKU and price are stored as a snapshot.
  insert into public.order_items (
    order_id, product_id, sku, quantity, unit_price, line_total
  )
  select
    v_order_id,
    p.id,
    p.sku,
    ci.quantity,
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price),
    ci.quantity *
    private.effective_price(v_price_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
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


-- ---------------------------------------------------------------------------
-- Admin products: optional dealer / VIP, sale price, list with image
-- ---------------------------------------------------------------------------

create or replace function private.check_product_prices(
  p_normal numeric,
  p_dealer numeric,
  p_vip numeric,
  p_sale numeric
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_normal is null then
    raise exception 'Normal price is required';
  end if;

  if p_normal < 0 or p_dealer < 0 or p_vip < 0 or p_sale < 0 then
    raise exception 'Prices cannot be negative';
  end if;

  if greatest(p_normal, p_dealer, p_vip, p_sale) > 100000000 then
    raise exception 'Price is too high';
  end if;

  if p_sale is not null and p_sale >= p_normal then
    raise exception 'Sale price must be lower than normal price';
  end if;
end;
$$;

revoke all on function private.check_product_prices(numeric, numeric, numeric, numeric) from public, anon, authenticated;


-- Create with optional dealer / VIP / sale prices (NULL = not set).
create function public.create_admin_product(
  p_sku text,
  p_category_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric,
  p_sale_price numeric,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_sku text := nullif(trim(p_sku), '');
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to create products';
  end if;

  if v_sku is null or length(v_sku) > 64 then
    raise exception 'SKU is required';
  end if;

  if p_stock is null or p_stock < 0 or p_stock > 1000000 then
    raise exception 'Stock cannot be negative';
  end if;

  perform private.check_product_prices(p_normal_price, p_dealer_price, p_vip_price, p_sale_price);

  if p_category_id is not null
     and not exists (select 1 from public.categories as c where c.id = p_category_id) then
    raise exception 'Category not found';
  end if;

  if exists (select 1 from public.products as p where p.sku = v_sku) then
    raise exception 'SKU already exists';
  end if;

  insert into public.products (sku, name, category_id, stock, active)
  values (v_sku, v_sku, p_category_id, p_stock, coalesce(p_active, false))
  returning id into v_product_id;

  insert into public.product_prices (product_id, normal_price, dealer_price, vip_price, sale_price)
  values (v_product_id, p_normal_price, p_dealer_price, p_vip_price, p_sale_price);

  return v_product_id;
end;
$$;

revoke execute on function public.create_admin_product(text, uuid, integer, numeric, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_admin_product(text, uuid, integer, numeric, numeric, numeric, numeric, boolean) to authenticated;


-- Stock and every price in one save (OWNER, PRODUCT_MANAGER).
create function public.update_admin_product_pricing(
  p_product_id uuid,
  p_stock integer,
  p_normal_price numeric,
  p_dealer_price numeric,
  p_vip_price numeric,
  p_sale_price numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update products';
  end if;

  if p_stock is null or p_stock < 0 or p_stock > 1000000 then
    raise exception 'Stock cannot be negative';
  end if;

  perform private.check_product_prices(p_normal_price, p_dealer_price, p_vip_price, p_sale_price);

  update public.products
  set stock = p_stock, updated_at = now()
  where id = p_product_id;

  if not found then
    raise exception 'Product not found';
  end if;

  insert into public.product_prices (product_id, normal_price, dealer_price, vip_price, sale_price)
  values (p_product_id, p_normal_price, p_dealer_price, p_vip_price, p_sale_price)
  on conflict (product_id) do update
  set
    normal_price = excluded.normal_price,
    dealer_price = excluded.dealer_price,
    vip_price = excluded.vip_price,
    sale_price = excluded.sale_price,
    updated_at = now();
end;
$$;

revoke execute on function public.update_admin_product_pricing(uuid, integer, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.update_admin_product_pricing(uuid, integer, numeric, numeric, numeric, numeric) to authenticated;


-- The old 5-argument price update keeps working but cannot leave a sale
-- price that is no longer lower than the normal price.
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
declare
  v_sale numeric;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update products';
  end if;

  select pp.sale_price into v_sale
  from public.product_prices as pp
  where pp.product_id = p_product_id
  for update;

  if v_sale is not null and v_sale >= p_normal_price then
    v_sale := null;
  end if;

  perform public.update_admin_product_pricing(
    p_product_id, p_stock, p_normal_price, p_dealer_price, p_vip_price, v_sale
  );
end;
$$;


drop function if exists public.get_admin_product(uuid);

create function public.get_admin_product(p_product_id uuid)
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
  vip_price numeric,
  sale_price numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    case when v_prices then pp.vip_price end,
    case when v_prices then pp.sale_price end
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


drop function if exists public.get_admin_products_page(integer, integer, text, uuid, text, boolean, text);

-- p_status: NULL / 'active' / 'inactive' / 'sale'.
create function public.get_admin_products_page(
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
  sale_price numeric,
  has_group_prices boolean,
  primary_image_path text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        or (
          p_status = 'sale'
          and v_prices
          and exists (
            select 1 from public.product_prices as sp
            where sp.product_id = p.id and sp.sale_price is not null
          )
        )
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
    case when v_prices then pp.sale_price end,
    case when v_prices then (pp.dealer_price is not null or pp.vip_price is not null) end,
    pm.storage_path,
    (select count(*) from filtered)
  from page as pg
  left join public.categories as c
    on c.id = pg.category_id
  left join public.product_prices as pp
    on pp.product_id = pg.id
  left join public.product_media as pm
    on pm.product_id = pg.id
    and pm.media_type = 'IMAGE'
    and pm.is_primary = true
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


-- ---------------------------------------------------------------------------
-- 4. Orders: direct editing by OWNER / SALES with a change log
-- ---------------------------------------------------------------------------

-- One row per product per order (cancel adds each quantity back once).
create unique index order_items_order_product_key
  on public.order_items (order_id, product_id);

create table public.order_change_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  -- All rows written by one save share a change_id.
  change_id uuid not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  change_type text not null check (
    change_type in ('ORDER_UPDATED', 'ITEM_ADDED', 'ITEM_REMOVED', 'ITEM_UPDATED', 'STATUS_CHANGED')
  ),
  product_id uuid references public.products (id) on delete restrict,
  sku text,
  product_name text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index order_change_log_order_idx
  on public.order_change_log (order_id, created_at);

alter table public.order_change_log enable row level security;
revoke all on public.order_change_log from anon, authenticated;

create or replace function private.prevent_order_change_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'order_change_log is append-only';
end;
$$;

create trigger order_change_log_no_update
before update or delete on public.order_change_log
for each row execute function private.prevent_order_change_log_change();

create trigger order_change_log_no_truncate
before truncate on public.order_change_log
for each statement execute function private.prevent_order_change_log_change();


-- Replaces the items of a PENDING order with p_items:
--   [{ "product_id": uuid, "quantity": 1..100000, "unit_price": number|null }]
-- unit_price NULL keeps the current price (or, for a new product, uses the
-- customer's catalog price). Totals are calculated here, never trusted from
-- the client. Stock moves by the difference only. Sending the same list
-- twice changes nothing the second time. p_expected_updated_at (optional)
-- rejects a save based on an outdated view of the order.
create function public.update_admin_order_items(
  p_order_id uuid,
  p_items jsonb,
  p_expected_updated_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_group public.customer_price_group;
  v_item jsonb;
  v_count integer;
  v_changes integer;
  v_change_id uuid := gen_random_uuid();
  v_short_sku text;
  v_old_total numeric(12, 2);
  v_new_total numeric(12, 2);
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid order items';
  end if;

  v_count := jsonb_array_length(p_items);

  if v_count = 0 then
    raise exception 'Order must have at least one product';
  end if;

  if v_count > 200 then
    raise exception 'Invalid order items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid order items';
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,6}$'
       or (v_item ->> 'quantity')::integer not between 1 and 100000 then
      raise exception 'Invalid quantity';
    end if;

    if jsonb_typeof(v_item -> 'unit_price') not in ('null')
       and coalesce(v_item ->> 'unit_price', '') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
      raise exception 'Invalid price';
    end if;
  end loop;

  select o.* into v_order
  from public.orders as o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.status <> 'PENDING' then
    raise exception 'Only pending orders can be edited';
  end if;

  select cp.price_group into v_group
  from public.customer_profiles as cp
  where cp.id = v_order.customer_id;

  drop table if exists pg_temp.order_edit_items;

  create temporary table order_edit_items (
    product_id uuid primary key,
    quantity integer not null,
    unit_price numeric(12, 2)
  ) on commit drop;

  begin
    insert into pg_temp.order_edit_items (product_id, quantity, unit_price)
    select
      (e ->> 'product_id')::uuid,
      (e ->> 'quantity')::integer,
      round((e ->> 'unit_price')::numeric, 2)
    from jsonb_array_elements(p_items) as e;
  exception
    when unique_violation then
      raise exception 'Duplicate product';
  end;

  if exists (
    select 1
    from pg_temp.order_edit_items as n
    left join public.products as p on p.id = n.product_id
    where p.id is null
  ) then
    raise exception 'Product not found';
  end if;

  -- A product that is not in the order yet must be on sale.
  if exists (
    select 1
    from pg_temp.order_edit_items as n
    where not exists (
        select 1 from public.order_items as oi
        where oi.order_id = p_order_id and oi.product_id = n.product_id
      )
      and not private.is_product_available(n.product_id)
  ) then
    raise exception 'Product is not available';
  end if;

  -- Lock every product whose stock may change, in a fixed order.
  perform 1
  from public.products as p
  where p.id in (
    select oi.product_id from public.order_items as oi where oi.order_id = p_order_id
    union
    select n.product_id from pg_temp.order_edit_items as n
  )
  order by p.id
  for update;

  -- Missing prices: current order price, or the catalog price for new items.
  update pg_temp.order_edit_items as n
  set unit_price = coalesce(
    (
      select oi.unit_price from public.order_items as oi
      where oi.order_id = p_order_id and oi.product_id = n.product_id
    ),
    (
      select private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
      from public.product_prices as pp
      where pp.product_id = n.product_id
    )
  )
  where n.unit_price is null;

  if exists (select 1 from pg_temp.order_edit_items as n where n.unit_price is null) then
    raise exception 'Invalid price';
  end if;

  -- What changes (quantity and/or price), compared with the current order.
  select count(*)
  into v_changes
  from (
    select coalesce(c.product_id, n.product_id)
    from (
      select oi.product_id, oi.quantity, oi.unit_price
      from public.order_items as oi
      where oi.order_id = p_order_id
    ) as c
    full join pg_temp.order_edit_items as n
      on n.product_id = c.product_id
    where c.product_id is null
       or n.product_id is null
       or c.quantity <> n.quantity
       or c.unit_price <> n.unit_price
  ) as d;

  -- Same list again (double click, retry): nothing to do.
  if v_changes = 0 then
    return 0;
  end if;

  if p_expected_updated_at is not null
     and v_order.updated_at <> p_expected_updated_at then
    raise exception 'Order was changed by someone else';
  end if;

  -- Enough stock for every increase?
  select p.sku into v_short_sku
  from (
    select coalesce(c.product_id, n.product_id) as product_id,
           coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
    from (
      select oi.product_id, oi.quantity
      from public.order_items as oi
      where oi.order_id = p_order_id
    ) as c
    full join pg_temp.order_edit_items as n
      on n.product_id = c.product_id
  ) as d
  join public.products as p on p.id = d.product_id
  where d.delta > 0
    and p.stock < d.delta
  order by p.sku
  limit 1;

  if v_short_sku is not null then
    raise exception 'Insufficient stock for %', v_short_sku;
  end if;

  v_old_total := v_order.total_amount;

  -- History first (before values are still in order_items).
  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, product_id, sku,
    product_name, before, after
  )
  select
    p_order_id,
    v_change_id,
    (select auth.uid()),
    case
      when c.product_id is null then 'ITEM_ADDED'
      when n.product_id is null then 'ITEM_REMOVED'
      else 'ITEM_UPDATED'
    end,
    p.id,
    coalesce(c.sku, p.sku),
    p.name,
    case when c.product_id is not null then
      jsonb_build_object('quantity', c.quantity, 'unit_price', c.unit_price, 'line_total', c.line_total)
    end,
    case when n.product_id is not null then
      jsonb_build_object('quantity', n.quantity, 'unit_price', n.unit_price, 'line_total', round(n.quantity * n.unit_price, 2))
    end
  from (
    select oi.product_id, oi.sku, oi.quantity, oi.unit_price, oi.line_total
    from public.order_items as oi
    where oi.order_id = p_order_id
  ) as c
  full join pg_temp.order_edit_items as n
    on n.product_id = c.product_id
  join public.products as p
    on p.id = coalesce(c.product_id, n.product_id)
  where c.product_id is null
     or n.product_id is null
     or c.quantity <> n.quantity
     or c.unit_price <> n.unit_price;

  -- Stock: only the difference (more = taken, less / removed = returned).
  update public.products as p
  set stock = p.stock - d.delta,
      updated_at = now()
  from (
    select coalesce(c.product_id, n.product_id) as product_id,
           coalesce(n.quantity, 0) - coalesce(c.quantity, 0) as delta
    from (
      select oi.product_id, oi.quantity
      from public.order_items as oi
      where oi.order_id = p_order_id
    ) as c
    full join pg_temp.order_edit_items as n
      on n.product_id = c.product_id
  ) as d
  where p.id = d.product_id
    and d.delta <> 0;

  delete from public.order_items as oi
  where oi.order_id = p_order_id
    and not exists (
      select 1 from pg_temp.order_edit_items as n where n.product_id = oi.product_id
    );

  update public.order_items as oi
  set quantity = n.quantity,
      unit_price = n.unit_price,
      line_total = round(n.quantity * n.unit_price, 2)
  from pg_temp.order_edit_items as n
  where oi.order_id = p_order_id
    and oi.product_id = n.product_id
    and (oi.quantity <> n.quantity or oi.unit_price <> n.unit_price);

  insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
  select p_order_id, n.product_id, p.sku, n.quantity, n.unit_price, round(n.quantity * n.unit_price, 2)
  from pg_temp.order_edit_items as n
  join public.products as p on p.id = n.product_id
  where not exists (
    select 1 from public.order_items as oi
    where oi.order_id = p_order_id and oi.product_id = n.product_id
  );

  select coalesce(sum(oi.line_total), 0) into v_new_total
  from public.order_items as oi
  where oi.order_id = p_order_id;

  update public.orders
  set total_amount = v_new_total, updated_at = now()
  where id = p_order_id;

  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, before, after
  )
  values (
    p_order_id,
    v_change_id,
    (select auth.uid()),
    'ORDER_UPDATED',
    jsonb_build_object('total', v_old_total),
    jsonb_build_object('total', v_new_total)
  );

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    'order_items_updated',
    'order',
    p_order_id::text,
    jsonb_build_object('change_id', v_change_id, 'changes', v_changes)
  );

  drop table if exists pg_temp.order_edit_items;

  return v_changes;
end;
$$;

revoke execute on function public.update_admin_order_items(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.update_admin_order_items(uuid, jsonb, timestamptz) to authenticated;


-- Change history for staff. WAREHOUSE does not see prices.
create function public.get_admin_order_changes(p_order_id uuid)
returns table (
  id uuid,
  change_id uuid,
  change_type text,
  actor_name text,
  product_id uuid,
  sku text,
  product_name text,
  before jsonb,
  after jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prices boolean := private.staff_can(array['OWNER', 'SALES', 'SUPPORT']::public.staff_role[]);
begin
  if not private.staff_can(array['OWNER', 'SALES', 'WAREHOUSE', 'SUPPORT']::public.staff_role[]) then
    raise exception 'Not authorized to view orders';
  end if;

  return query
  select
    l.id,
    l.change_id,
    l.change_type,
    coalesce(sp.full_name, au.email::text),
    l.product_id,
    l.sku,
    l.product_name,
    case when v_prices then l.before else l.before - 'unit_price' - 'line_total' - 'total' end,
    case when v_prices then l.after else l.after - 'unit_price' - 'line_total' - 'total' end,
    l.created_at
  from public.order_change_log as l
  left join public.staff_profiles as sp on sp.id = l.actor_user_id
  left join auth.users as au on au.id = l.actor_user_id
  where l.order_id = p_order_id
  order by l.created_at desc, l.change_type, l.sku;
end;
$$;

revoke execute on function public.get_admin_order_changes(uuid) from public, anon;
grant execute on function public.get_admin_order_changes(uuid) to authenticated;


-- Readable summary for the customer: what the seller changed. No staff
-- names, no technical data.
create function public.get_customer_order_changes(p_order_id uuid)
returns table (
  change_id uuid,
  change_type text,
  sku text,
  product_name text,
  quantity_before integer,
  quantity_after integer,
  price_before numeric,
  price_after numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.change_id,
    l.change_type,
    l.sku,
    l.product_name,
    (l.before ->> 'quantity')::integer,
    (l.after ->> 'quantity')::integer,
    coalesce(l.before ->> 'unit_price', l.before ->> 'total')::numeric,
    coalesce(l.after ->> 'unit_price', l.after ->> 'total')::numeric,
    l.created_at
  from public.order_change_log as l
  join public.orders as o
    on o.id = l.order_id
  where l.order_id = p_order_id
    and o.customer_id = (select auth.uid())
    and private.current_customer_price_group() is not null
    and l.change_type in ('ORDER_UPDATED', 'ITEM_ADDED', 'ITEM_REMOVED', 'ITEM_UPDATED')
  order by l.created_at desc, l.change_type, l.sku;
$$;

revoke execute on function public.get_customer_order_changes(uuid) from public, anon;
grant execute on function public.get_customer_order_changes(uuid) to authenticated;


-- Customer order lines with the product name.
create function public.get_customer_order_lines(p_order_id uuid)
returns table (
  product_id uuid,
  sku text,
  product_name text,
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
    coalesce(p.name, oi.sku),
    oi.quantity,
    oi.unit_price,
    oi.line_total
  from public.order_items as oi
  join public.orders as o
    on o.id = oi.order_id
  left join public.products as p
    on p.id = oi.product_id
  where oi.order_id = p_order_id
    and o.customer_id = (select auth.uid())
    and private.current_customer_price_group() is not null
  order by oi.created_at, oi.sku;
$$;

revoke execute on function public.get_customer_order_lines(uuid) from public, anon;
grant execute on function public.get_customer_order_lines(uuid) to authenticated;


-- Products to add to an order: available products with the customer's
-- effective catalog price (OWNER, SALES).
create or replace function public.search_admin_order_products(p_order_id uuid, p_search text)
returns table (
  id uuid,
  sku text,
  name text,
  stock integer,
  active boolean,
  catalog_price numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.customer_price_group;
  v_search text := nullif(trim(left(coalesce(p_search, ''), 100)), '');
begin
  if not private.staff_can(array['OWNER', 'SALES']::public.staff_role[]) then
    raise exception 'Not authorized to edit orders';
  end if;

  select cp.price_group into v_group
  from public.orders as o
  join public.customer_profiles as cp on cp.id = o.customer_id
  where o.id = p_order_id;

  if not found then
    raise exception 'Order not found';
  end if;

  return query
  select p.id, p.sku, p.name, p.stock, p.active,
    private.effective_price(v_group, pp.normal_price, pp.dealer_price, pp.vip_price, pp.sale_price)
  from public.products as p
  join public.product_prices as pp on pp.product_id = p.id
  where private.is_product_available(p.id)
    and (
      v_search is null
      or p.name ilike private.like_pattern(v_search)
      or p.sku ilike private.like_pattern(v_search)
    )
  order by p.name, p.sku
  limit 20;
end;
$$;


-- Confirm / cancel: same rules; the change is written to the history.
create or replace function public.update_admin_order_status(p_order_id uuid, p_status public.order_status)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_status not in ('CONFIRMED', 'CANCELLED') then
    raise exception 'Invalid order status transition';
  end if;

  -- Old revision flow: nothing stays open on a decided order.
  update public.order_revisions
  set status = 'SUPERSEDED', updated_at = now()
  where order_id = p_order_id
    and status in ('DRAFT', 'AWAITING_CUSTOMER');

  if p_status = 'CANCELLED' then
    -- One row per product (unique index), so each quantity returns once.
    update public.products as p
    set
      stock = p.stock + oi.quantity,
      updated_at = now()
    from public.order_items as oi
    where oi.order_id = p_order_id
      and oi.product_id = p.id;
  end if;

  update public.orders
  set
    status = p_status,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_change_log (
    order_id, change_id, actor_user_id, change_type, before, after
  )
  values (
    p_order_id,
    gen_random_uuid(),
    (select auth.uid()),
    'STATUS_CHANGED',
    jsonb_build_object('status', v_current_status),
    jsonb_build_object('status', p_status)
  );

  return p_status;
end;
$$;


-- ---------------------------------------------------------------------------
-- Customer-approval revision flow: switched off. Tables and history stay
-- (read functions remain); nothing can create, send or accept revisions.
-- ---------------------------------------------------------------------------

update public.order_revisions
set status = 'SUPERSEDED', updated_at = now()
where status in ('DRAFT', 'AWAITING_CUSTOMER');

revoke execute on function public.create_admin_order_revision(uuid) from authenticated;
revoke execute on function public.save_admin_order_revision(uuid, jsonb, text) from authenticated;
revoke execute on function public.send_admin_order_revision(uuid) from authenticated;
revoke execute on function public.resend_admin_order_revision(uuid) from authenticated;
revoke execute on function public.discard_admin_order_revision(uuid) from authenticated;
revoke execute on function public.respond_to_order_revision(uuid, boolean) from authenticated;
