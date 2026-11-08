// Fake catalog data for local performance tests only (never production).
export const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  normal: "00000000-0000-4000-8000-000000000011",
  dealer: "00000000-0000-4000-8000-000000000012",
  vip: "00000000-0000-4000-8000-000000000013",
  inactive: "00000000-0000-4000-8000-000000000014",
  sales: "00000000-0000-4000-8000-000000000021",
};

export async function seedUsers(c) {
  await c.query(`
    insert into auth.users (id, email) values
      ('${IDS.owner}', 'owner@test.local'),
      ('${IDS.normal}', 'normal@test.local'),
      ('${IDS.dealer}', 'dealer@test.local'),
      ('${IDS.vip}', 'vip@test.local'),
      ('${IDS.inactive}', 'inactive@test.local'),
      ('${IDS.sales}', 'sales@test.local');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${IDS.owner}', 'Owner', 'OWNER', true),
      ('${IDS.sales}', 'Sales', 'SALES', true);
    insert into public.customer_profiles (id, company_name, contact_name, price_group, active) values
      ('${IDS.normal}', 'Normal LLC', 'N', 'NORMAL', true),
      ('${IDS.dealer}', 'Dealer LLC', 'D', 'DEALER', true),
      ('${IDS.vip}', 'VIP LLC', 'V', 'VIP', true),
      ('${IDS.inactive}', 'Inactive LLC', 'I', 'NORMAL', false);
  `);
}

const words = [
  "LED", "Lampa", "Ayaqaltı", "Örtük", "Sükan", "Güzgü", "Antena", "Kamera",
  "Sensor", "Şarj", "Kabel", "Tutacaq", "Filtr", "Qayış", "Fara", "Stop",
  "Xenon", "Halogen", "Salon", "Bagaj", "Spoyler", "Disk", "Təkər", "Qapaq",
];

// Inserts n products spread over the given category ids.
export async function seedProducts(c, n, categoryIds) {
  await c.query(
    `
    insert into public.products (id, sku, name, description, stock, active, category_id, created_at)
    select
      gen_random_uuid(),
      'SKU-' || lpad(g::text, 6, '0'),
      (array[${words.map((w) => `'${w}'`).join(",")}])[1 + (g % ${words.length})]
        || ' ' || (array[${words.map((w) => `'${w}'`).join(",")}])[1 + ((g / 7) % ${words.length})]
        || ' model ' || g,
      repeat('Uzun məhsul təsviri. ', 20) || g,
      (g * 7) % 120,
      (g % 20) <> 0,
      ($1::uuid[])[1 + (g % array_length($1::uuid[], 1))],
      now() - (g || ' minutes')::interval
    from generate_series(1, $2) as g;
  `,
    [categoryIds, n]
  );
  await c.query(`
    insert into public.product_prices (product_id, normal_price, dealer_price, vip_price)
    select id, 100 + (abs(hashtext(id::text)) % 900), 90 + (abs(hashtext(id::text)) % 800),
           80 + (abs(hashtext(id::text)) % 700)
    from public.products p
    where not exists (select 1 from public.product_prices pp where pp.product_id = p.id);
  `);
  // Every product: one primary image + two extra images; every 3rd: a video.
  await c.query(`
    insert into public.product_media (product_id, media_type, storage_path, mime_type, is_primary, sort_order)
    select p.id, 'IMAGE', p.id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', i = 1, i
    from public.products p cross join generate_series(1, 3) as i
    where not exists (select 1 from public.product_media pm where pm.product_id = p.id);
    insert into public.product_media (product_id, media_type, storage_path, mime_type, is_primary, sort_order)
    select p.id, 'VIDEO', p.id || '/' || gen_random_uuid() || '.mp4', 'video/mp4', false, 0
    from public.products p
    where (abs(hashtext(p.id::text)) % 3) = 0;
  `);
  await c.query("analyze");
}

export async function seedFlatCategories(c, count = 30) {
  const { rows } = await c.query(
    `
    insert into public.categories (name, slug, sort_order, active)
    select 'Kateqoriya ' || g, 'kateqoriya-' || g, g, g <> ${count}
    from generate_series(1, $1) as g
    returning id;
  `,
    [count]
  );
  return rows.map((r) => r.id);
}
