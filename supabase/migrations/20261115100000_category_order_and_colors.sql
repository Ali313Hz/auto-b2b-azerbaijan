-- Category order and colours (forward-only, no data removed):
--   1. sort_order is now per parent: siblings are numbered 1..n under each
--      parent. Existing rows are renumbered in exactly the order they are
--      shown today (sort_order, name, id), so nothing moves on screen. The
--      old values are kept in security_audit_log (category_sort_normalized).
--   2. New categories and categories moved to another parent go to the end
--      of their new siblings (trigger), whatever the caller sends.
--   3. move_admin_category: up / down / top / bottom inside the same parent
--      only (OWNER, PRODUCT_MANAGER). A category can never be reordered
--      among another parent's children.
--   4. Optional colour for main categories (NULL = automatic colour in the
--      app). Sub-categories use a lighter tint of their main category.


-- ---------------------------------------------------------------------------
-- 1. Per-parent numbering of the existing categories
-- ---------------------------------------------------------------------------

-- Old values first, so the previous numbers can always be looked up.
insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
select
  null,
  'category_sort_normalized',
  'category',
  null,
  jsonb_build_object(
    'previous_sort_order',
    coalesce(jsonb_object_agg(c.id::text, c.sort_order), '{}'::jsonb)
  )
from public.categories as c;

with numbered as (
  select
    c.id,
    row_number() over (
      partition by c.parent_id
      order by c.sort_order, c.name, c.id
    )::integer as position
  from public.categories as c
)
update public.categories as c
set sort_order = n.position
from numbered as n
where n.id = c.id
  and c.sort_order is distinct from n.position;

-- Siblings in display order (admin tree, customer tree, reordering).
create index categories_parent_sort_idx
  on public.categories (parent_id, sort_order);

-- The (parent_id) index is covered by the new one.
drop index if exists public.categories_parent_id_idx;


-- ---------------------------------------------------------------------------
-- 2. New / moved categories go to the end of their siblings
-- ---------------------------------------------------------------------------

create or replace function private.place_category_last()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  -- Same lock as the parent check and reordering.
  perform pg_advisory_xact_lock(hashtext('public.categories.tree'));

  select coalesce(max(c.sort_order), 0) + 1
  into new.sort_order
  from public.categories as c
  where c.parent_id is not distinct from new.parent_id
    and c.id <> new.id;

  return new;
end;
$$;

create trigger categories_place_last
before insert or update of parent_id on public.categories
for each row execute function private.place_category_last();


-- Edit form: the position is no longer typed by hand (↑ / ↓ buttons), so
-- p_sort_order is accepted for compatibility but ignored. A new parent puts
-- the category at the end of its new siblings (trigger above).
create or replace function public.update_admin_category(
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_sort_order integer,
  p_active boolean,
  p_parent_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    active = p_active,
    parent_id = p_parent_id,
    updated_at = now()
  where id = p_category_id;

  if not found then
    raise exception 'Category not found';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Reordering inside one parent
-- ---------------------------------------------------------------------------

-- p_direction: 'up', 'down', 'top', 'bottom'. Returns the new position
-- (1 = first). Siblings are renumbered 1..n; only rows whose number really
-- changes are written.
create function public.move_admin_category(
  p_category_id uuid,
  p_direction text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_ids uuid[];
  v_index integer;
  v_count integer;
  v_target integer;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to reorder categories';
  end if;

  if p_direction is null or p_direction not in ('up', 'down', 'top', 'bottom') then
    raise exception 'Invalid move';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.categories.tree'));

  select c.parent_id
  into v_parent
  from public.categories as c
  where c.id = p_category_id;

  if not found then
    raise exception 'Category not found';
  end if;

  -- Current order of the siblings (the category itself included).
  select array_agg(s.id order by s.sort_order, s.name, s.id)
  into v_ids
  from (
    select c.id, c.sort_order, c.name
    from public.categories as c
    where c.parent_id is not distinct from v_parent
    for update
  ) as s;

  v_count := cardinality(v_ids);
  v_index := array_position(v_ids, p_category_id);

  v_target := case p_direction
    when 'up' then greatest(v_index - 1, 1)
    when 'down' then least(v_index + 1, v_count)
    when 'top' then 1
    else v_count
  end;

  if v_target <> v_index then
    v_ids := array_remove(v_ids, p_category_id);
    v_ids := v_ids[1:v_target - 1] || p_category_id || v_ids[v_target:];
  end if;

  update public.categories as c
  set sort_order = o.position, updated_at = now()
  from unnest(v_ids) with ordinality as o(id, position)
  where c.id = o.id
    and c.sort_order <> o.position;

  if v_target <> v_index then
    insert into public.security_audit_log (actor_user_id, action, target_type, target_id, details)
    values (
      (select auth.uid()),
      'category_reordered',
      'category',
      p_category_id::text,
      jsonb_build_object('from', v_index, 'to', v_target, 'direction', p_direction)
    );
  end if;

  return v_target;
end;
$$;

revoke execute on function public.move_admin_category(uuid, text) from public, anon;
grant execute on function public.move_admin_category(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Optional colour of a main category
-- ---------------------------------------------------------------------------

alter table public.categories
  add column color text
  check (color is null or color ~ '^#[0-9a-f]{6}$');

create function public.set_admin_category_color(
  p_category_id uuid,
  p_color text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_color text := lower(nullif(trim(p_color), ''));
  v_parent uuid;
begin
  if not private.staff_can(array['OWNER', 'PRODUCT_MANAGER']::public.staff_role[]) then
    raise exception 'Not authorized to update categories';
  end if;

  if v_color is not null and v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Invalid colour';
  end if;

  select c.parent_id into v_parent
  from public.categories as c
  where c.id = p_category_id
  for update;

  if not found then
    raise exception 'Category not found';
  end if;

  if v_parent is not null then
    raise exception 'Only main categories have a colour';
  end if;

  update public.categories
  set color = v_color, updated_at = now()
  where id = p_category_id;
end;
$$;

revoke execute on function public.set_admin_category_color(uuid, text) from public, anon;
grant execute on function public.set_admin_category_color(uuid, text) to authenticated;


-- Admin list: + colour, + number of direct sub-categories. Same order as
-- before (sort_order is now per parent).
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
  image_path text,
  color text,
  root_id uuid
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
      c.id as root_id,
      1 as depth,
      c.name::text as path,
      c.active as available,
      array[lpad(c.sort_order::text, 10, '0') || c.name || c.id::text] as sort_key
    from public.categories as c
    where c.parent_id is null

    union all

    select
      c.id,
      t.root_id,
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
    c.image_path,
    r.color,
    t.root_id
  from tree as t
  join public.categories as c
    on c.id = t.id
  join public.categories as r
    on r.id = t.root_id
  left join counts as n
    on n.category_id = c.id
  order by t.sort_key;
end;
$$;

revoke execute on function public.get_admin_categories() from public, anon;
grant execute on function public.get_admin_categories() to authenticated;
