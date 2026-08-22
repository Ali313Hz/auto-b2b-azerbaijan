insert into public.categories (
  name,
  slug,
  active,
  sort_order
)
values (
  'LED Aydınlatma',
  'led-aydinlatma',
  true,
  10
)
on conflict (slug) do update
set
  name = excluded.name,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.products
set
  category_id = (
    select id
    from public.categories
    where slug = 'led-aydinlatma'
  ),
  updated_at = now()
where sku = 'LED-H7-DEMO';