-- Categories:
--   1. Optional image (stored in the private product-media bucket under
--      categories/<category id>/...). Customers see it on category cards.
--   2. Delete: only an empty category (no sub-categories, no products) can
--      be deleted, so no product ever loses its category by accident.
--   3. Lists return the image and the number of products, so empty
--      categories can be pointed out (admin) or explained (customers).


alter table public.categories
  add column image_path text
  check (image_path is null or (length(image_path) <= 200 and image_path like 'categories/%'));


-- Sets (or with NULL removes) the image of a category. Returns the previous
-- storage path so the caller can remove the old file.
create function public.set_admin_category_image(
  p_category_id uuid,
  p_image_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update categories';
  end if;

  if p_image_path is not null
     and p_image_path !~ ('^categories/' || p_category_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'Invalid category image';
  end if;

  select c.image_path into v_old
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Category not found';
  end if;

  update public.categories
  set image_path = p_image_path, updated_at = now()
  where id = p_category_id;

  return v_old;
end;
$$;

revoke execute on function public.set_admin_category_image(uuid, text) from public, anon;
grant execute on function public.set_admin_category_image(uuid, text) to authenticated;


-- Deletes an empty category. Returns its image path (to remove the file).
create function public.delete_admin_category(p_category_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.categories%rowtype;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to delete categories';
  end if;

  -- Same lock as tree changes: nobody can move a category under this one
  -- while it is being deleted.
  perform pg_advisory_xact_lock(hashtext('public.categories.tree'));

  select c.* into v_category
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Category not found';
  end if;

  if exists (select 1 from public.categories as c where c.parent_id = p_category_id) then
    raise exception 'Category has subcategories';
  end if;

  if exists (select 1 from public.products as p where p.category_id = p_category_id) then
    raise exception 'Category has products';
  end if;

  delete from public.categories where id = p_category_id;

  insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    (select auth.uid()),
    'category_deleted',
    'category',
    p_category_id::text,
    jsonb_build_object('name', v_category.name, 'slug', v_category.slug)
  );

  return v_category.image_path;
end;
$$;

revoke execute on function public.delete_admin_category(uuid) from public, anon;
grant execute on function public.delete_admin_category(uuid) to authenticated;


-- Admin list: + image_path.
drop function if exists public.get_admin_categories();

create function public.get_admin_categories()
returns table (
  id uuid,
  name text,
  slug text,
  active boolean,
  sort_order integer,
  parent_id uuid,
  depth integer,
  path text,
  available boolean,
  product_count bigint,
  image_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    coalesce(n.product_count, 0),
    c.image_path
  from tree as t
  join public.categories as c
    on c.id = t.id
  left join counts as n
    on n.category_id = c.id
  order by t.sort_key;
end;
$$;

revoke execute on function public.get_admin_categories() from public, anon;
grant execute on function public.get_admin_categories() to authenticated;


-- Customer list: + image_path and the number of products the customer can
-- see directly in the category (active products only).
drop function if exists public.get_customer_categories();

create function public.get_customer_categories()
returns table (
  id uuid,
  name text,
  slug text,
  parent_id uuid,
  sort_order integer,
  image_path text,
  product_count bigint
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
  with available as materialized (
    select a.id from private.available_category_ids() as a(id)
  ),
  counts as (
    select p.category_id, count(*) as product_count
    from public.products as p
    join public.product_prices as pp
      on pp.product_id = p.id
    where p.active = true
      and p.category_id in (select av.id from available as av)
    group by p.category_id
  )
  select c.id, c.name, c.slug, c.parent_id, c.sort_order, c.image_path,
    coalesce(n.product_count, 0)
  from public.categories as c
  left join counts as n
    on n.category_id = c.id
  where c.id in (select av.id from available as av)
  order by c.sort_order, c.name;
end;
$$;

revoke execute on function public.get_customer_categories() from public, anon;
grant execute on function public.get_customer_categories() to authenticated;
