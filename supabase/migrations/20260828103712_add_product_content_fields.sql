alter table public.products
add column name text,
add column description text;

update public.products
set name = sku
where name is null;

alter table public.products
alter column name set not null;


drop function if exists public.get_admin_products();

create function public.get_admin_products()
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
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
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
    c.name as category_name,
    pp.normal_price,
    pp.dealer_price,
    pp.vip_price
  from public.products as p
  left join public.categories as c
    on c.id = p.category_id
  left join public.product_prices as pp
    on pp.product_id = p.id
  order by p.created_at desc;
end;
$$;

revoke execute
on function public.get_admin_products()
from public, anon;

grant execute
on function public.get_admin_products()
to authenticated;


drop function if exists public.get_customer_catalog();

create function public.get_customer_catalog()
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.sku,
    p.name,
    p.description,
    p.stock,
    case cp.price_group
      when 'NORMAL' then pp.normal_price
      when 'DEALER' then pp.dealer_price
      when 'VIP' then pp.vip_price
    end as price,
    c.id as category_id,
    c.name as category_name,
    c.slug as category_slug
  from public.customer_profiles as cp
  cross join public.products as p
  join public.product_prices as pp
    on pp.product_id = p.id
  left join public.categories as c
    on c.id = p.category_id
  where cp.id = auth.uid()
    and cp.active = true
    and p.active = true
    and (
      p.category_id is null
      or c.active = true
    );
$$;

revoke execute
on function public.get_customer_catalog()
from public, anon;

grant execute
on function public.get_customer_catalog()
to authenticated;


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
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
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

revoke execute
on function public.update_admin_product_content(
  uuid,
  text,
  text,
  uuid
)
from public, anon;

grant execute
on function public.update_admin_product_content(
  uuid,
  text,
  text,
  uuid
)
to authenticated;