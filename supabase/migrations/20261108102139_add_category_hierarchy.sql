-- Hierarchical categories: categories.parent_id -> categories.id.
-- At most 3 levels (main -> sub -> sub-sub). Cycles and self-parenting
-- are rejected by a trigger. Categories are still never hard deleted.

alter table public.categories
add column parent_id uuid
references public.categories(id)
on delete restrict;

alter table public.categories
add constraint categories_not_own_parent_check
check (parent_id is null or parent_id <> id);

create index categories_parent_id_idx
on public.categories (parent_id);


create or replace function private.validate_category_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_depth integer := 0;
  v_subtree_height integer := 1;
  v_cursor uuid := new.parent_id;
begin
  -- A root category cannot form a cycle, and existing trees are at most 3
  -- levels deep, so moving a subtree to the root is always valid.
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Category cannot be its own parent';
  end if;

  -- Serialize tree changes so two concurrent moves cannot form a cycle.
  perform pg_advisory_xact_lock(hashtext('public.categories.tree'));

  -- Walk up from the new parent. Reaching the category itself is a cycle.
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'Category hierarchy cannot contain a cycle';
    end if;

    v_parent_depth := v_parent_depth + 1;

    if v_parent_depth > 10 then
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
      where s.level < 10
    )
    select coalesce(max(level), 0) + 1
    into v_subtree_height
    from subtree;
  end if;

  if v_parent_depth + v_subtree_height > 3 then
    raise exception 'Category hierarchy too deep';
  end if;

  return new;
end;
$$;

create trigger categories_validate_parent
before insert or update of parent_id on public.categories
for each row execute function private.validate_category_parent();


-- A category is available when it and all of its ancestors are active.
-- The tree is at most 3 levels deep, so two joins cover every ancestor.
create or replace function private.is_category_available(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select
        c.active
        and coalesce(parent.active, true)
        and coalesce(grandparent.active, true)
      from public.categories as c
      left join public.categories as parent
        on parent.id = c.parent_id
      left join public.categories as grandparent
        on grandparent.id = parent.parent_id
      where c.id = p_category_id
    ),
    false
  );
$$;

revoke all on function private.is_category_available(uuid) from public, anon;
grant execute on function private.is_category_available(uuid) to authenticated, service_role;


-- Admin category list with hierarchy information and product counts.
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
  product_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_owner() then
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
$$;

revoke execute on function public.get_admin_categories() from public, anon;
grant execute on function public.get_admin_categories() to authenticated;


-- New overloads with an explicit parent. The old 4/5-argument versions
-- (still OWNER-only) remain and leave parent_id unchanged.
create function public.create_admin_category(
  p_name text,
  p_slug text,
  p_sort_order integer,
  p_active boolean,
  p_parent_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_name text := nullif(trim(p_name), '');
  v_slug text := nullif(trim(p_slug), '');
begin
  if not private.is_active_owner() then
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
$$;

revoke execute on function public.create_admin_category(text, text, integer, boolean, uuid) from public, anon;
grant execute on function public.create_admin_category(text, text, integer, boolean, uuid) to authenticated;


create function public.update_admin_category(
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
  if not private.is_active_owner() then
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
$$;

revoke execute on function public.update_admin_category(uuid, text, text, integer, boolean, uuid) from public, anon;
grant execute on function public.update_admin_category(uuid, text, text, integer, boolean, uuid) to authenticated;
