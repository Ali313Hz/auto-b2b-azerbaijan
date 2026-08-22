
create or replace function public.create_admin_category(
  p_name text,
  p_slug text,
  p_sort_order integer,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_name text;
  v_slug text;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to create categories';
  end if;

  v_name := trim(p_name);
  v_slug := trim(p_slug);

  if v_name is null or v_name = '' then
    raise exception 'Category name is required';
  end if;

  if v_slug is null or v_slug = '' then
    raise exception 'Category slug is required';
  end if;

  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'Sort order cannot be negative';
  end if;

  if p_active is null then
    raise exception 'Active status is required';
  end if;

  if exists (
    select 1
    from public.categories as c
    where c.slug = v_slug
  ) then
    raise exception 'Category slug already exists';
  end if;

  insert into public.categories (
    name,
    slug,
    sort_order,
    active
  )
  values (
    v_name,
    v_slug,
    p_sort_order,
    p_active
  )
  returning id into v_category_id;

  return v_category_id;
end;
$$;

revoke execute
on function public.create_admin_category(
  text,
  text,
  integer,
  boolean
)
from public, anon;

grant execute
on function public.create_admin_category(
  text,
  text,
  integer,
  boolean
)
to authenticated;


create or replace function public.update_admin_category(
  p_category_id uuid,
  p_name text,
  p_slug text,
  p_sort_order integer,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_slug text;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to update categories';
  end if;

  v_name := trim(p_name);
  v_slug := trim(p_slug);

  if v_name is null or v_name = '' then
    raise exception 'Category name is required';
  end if;

  if v_slug is null or v_slug = '' then
    raise exception 'Category slug is required';
  end if;

  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'Sort order cannot be negative';
  end if;

  if p_active is null then
    raise exception 'Active status is required';
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
    updated_at = now()
  where id = p_category_id;

  if not found then
    raise exception 'Category not found';
  end if;
end;
$$;

revoke execute
on function public.update_admin_category(
  uuid,
  text,
  text,
  integer,
  boolean
)
from public, anon;

grant execute
on function public.update_admin_category(
  uuid,
  text,
  text,
  integer,
  boolean
)
to authenticated;