// BEFORE/AFTER timing for the faster_prices_and_customer_lookup migration
// on a large local data set (not part of run-all):
//   node perf-scale.mjs [products=10000] [orders=3000] [categories=500] [customers=2000]
// Categories form a 6-level tree. Local Postgres only, never production.
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const PRODUCTS = Number(process.argv[2] ?? 10000);
const ORDERS = Number(process.argv[3] ?? 3000);
const CATEGORIES = Number(process.argv[4] ?? 500);
const CUSTOMERS = Number(process.argv[5] ?? 2000);
const MIGRATION = "20261116100000_faster_prices_and_customer_lookup.sql";
const server = await startServer();

try {
  const before = migrationFiles().filter((f) => f < MIGRATION).at(-1);
  const { c } = await createDatabase(`perf_scale_${PRODUCTS}`, { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);

  // 6-level tree: 10 roots, then each new category goes under a random
  // category of the previous level.
  await c.query(`
    insert into public.categories (name, slug) select 'Kök ' || g, 'k-' || g from generate_series(1, 10) as g;
    create temp table lvl (id uuid, depth int);
    insert into lvl select id, 1 from public.categories;
  `);
  const perLevel = Math.ceil((CATEGORIES - 10) / 5);
  for (let depth = 2; depth <= 6; depth++) {
    await c.query(`
      insert into public.categories (name, slug, parent_id)
      select 'Kat ${depth}-' || g, 'c-${depth}-' || g,
        (select id from lvl where depth = ${depth - 1} order by md5(g::text || id::text) limit 1)
      from generate_series(1, ${perLevel}) as g;
      insert into lvl select id, ${depth} from public.categories where slug like 'c-${depth}-%';
    `);
  }
  await c.query(`
    insert into public.products (sku, name, stock, active, category_id, availability)
    select 'P-' || g, 'Məhsul ' || g, g % 50, g % 17 <> 0,
      (select id from lvl order by md5(g::text || id::text) limit 1),
      case when g % 25 = 0 then 'COMING_SOON'::public.product_availability else 'IN_STOCK' end
    from generate_series(1, ${PRODUCTS}) as g;
    insert into public.product_prices (product_id, normal_price, dealer_price, vip_price, sale_price)
    select id, 10 + (abs(hashtext(sku)) % 100), case when abs(hashtext(sku)) % 3 = 0 then 9 end,
      case when abs(hashtext(sku)) % 4 = 0 then 8 end, case when abs(hashtext(sku)) % 10 = 0 then 5 end
    from public.products where not exists (select 1 from public.product_prices as pp where pp.product_id = products.id);
    insert into auth.users (id, email)
    select gen_random_uuid(), 'c' || g || '@perf.local' from generate_series(1, ${CUSTOMERS}) as g;
    insert into public.customer_profiles (id, company_name, contact_name, price_group, active)
    select id, 'Firma ' || email, 'X', 'NORMAL', true from auth.users where email like '%@perf.local';
    insert into public.orders (customer_id, status, payment_status, order_type, total_amount, created_at)
    select (select id from public.customer_profiles order by md5(g::text || id::text) limit 1),
      (array['PENDING','CONFIRMED','CANCELLED'])[1 + g % 3]::public.order_status,
      (array['UNPAID','PAID','CUSTOMER_REPORTED'])[1 + g % 3]::public.payment_status,
      'STANDARD', 100, now() - (g % 700) * interval '1 day'
    from generate_series(1, ${ORDERS}) as g;
    insert into public.customer_favorites (customer_id, product_id)
    select '${IDS.dealer}', id from public.products where active limit 300;
    analyze;
  `);
  const counts = (await c.query(
    "select (select count(*) from public.products) p, (select count(*) from public.categories) cat, (select max(depth) from lvl) depth, (select count(*) from public.customer_profiles) cust, (select count(*) from public.orders) o"
  )).rows[0];
  console.log("seeded", JSON.stringify(counts));

  const session = async (id) => (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  const S = { owner: [IDS.owner, await session(IDS.owner)], dealer: [IDS.dealer, await session(IDS.dealer)] };
  const someCustomer = (await c.query("select id from public.customer_profiles where company_name like 'Firma%' limit 1")).rows[0].id;
  const rootSlug = "k-1";

  const cases = [
    ["dealer", "catalog page 1", "select * from public.get_customer_catalog_page(1, 24)"],
    ["dealer", "catalog price sort (page 50)", "select * from public.get_customer_catalog_page(50, 24, null, null, 'price_asc')"],
    ["dealer", "catalog sale only", "select * from public.get_customer_catalog_page(1, 24, null, null, 'name', true, true)"],
    ["dealer", "catalog root category + 5 levels below", `select * from public.get_customer_catalog_page(1, 24, '${rootSlug}')`],
    ["dealer", "sidebar categories", "select * from public.get_customer_categories()"],
    ["dealer", "favorites page", "select * from public.get_customer_favorites_page(1, 24)"],
    ["owner", "admin products page", "select * from public.get_admin_products_page(1, 50)"],
    ["owner", "admin categories (tree)", "select * from public.get_admin_categories()"],
    ["owner", "admin customers list", "select * from public.get_admin_customers()"],
    ["owner", "admin customer detail: whole list (before)", "select * from public.get_admin_customers()"],
    ["owner", "admin customer detail: one customer (after)", `select * from public.get_admin_customer('${someCustomer}')`],
    ["owner", "admin customer activity", `select * from public.get_admin_customer_activity('${someCustomer}')`],
    ["owner", "admin customer orders (20)", `select * from public.get_admin_customer_orders('${someCustomer}', 20)`],
  ];

  async function run(label) {
    const out = {};
    for (const [who, name, sql] of cases) {
      const [id, sid] = S[who];
      await c.query("begin");
      try {
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal1", session_id: sid })]);
        await c.query("set local role authenticated");
        let rows;
        try {
          rows = (await c.query(sql)).rows; // warm up
        } catch {
          out[name] = null;
          continue;
        }
        const runs = [];
        for (let i = 0; i < 7; i++) {
          const t = performance.now();
          await c.query(sql);
          runs.push(performance.now() - t);
        }
        runs.sort((a, b) => a - b);
        out[name] = { ms: runs[3], rows: rows.length, bytes: JSON.stringify(rows).length, result: JSON.stringify(rows) };
      } finally {
        await c.query("rollback");
      }
    }
    console.log(`-- ${label} done`);
    return out;
  }

  const b = await run("before");
  await c.query("begin");
  await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
  await c.query("commit");
  const a = await run("after");

  console.log(`\n${"query".padEnd(46)} ${"BEFORE ms".padStart(10)} ${"AFTER ms".padStart(10)} ${"rows".padStart(6)} ${"bytes".padStart(8)}  same`);
  for (const [, name] of cases) {
    const x = b[name];
    const y = a[name];
    const same = x && y ? (x.result === y.result ? "yes" : "NO") : "-";
    console.log(
      `${name.padEnd(46)} ${x ? x.ms.toFixed(1).padStart(10) : "n/a".padStart(10)} ${y ? y.ms.toFixed(1).padStart(10) : "n/a".padStart(10)} ${String((y ?? x)?.rows ?? "").padStart(6)} ${String((y ?? x)?.bytes ?? "").padStart(8)}  ${same}`
    );
  }

  await c.end();
} finally {
  await server.stop();
}
