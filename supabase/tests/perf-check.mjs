// Performance check with a large local catalog (not part of run-all):
//   node perf-check.mjs [products=10000] [orders=3000]
// Seeds products, categories, orders and favorites in a throwaway local
// database, then times the main RPCs and prints their plans.
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const PRODUCTS = Number(process.argv[2] ?? 10000);
const ORDERS = Number(process.argv[3] ?? 3000);
const server = await startServer();

try {
  const { c } = await createDatabase(`perf_${PRODUCTS}`);
  c.on("error", () => {});
  await seedUsers(c);

  await c.query(`
    insert into public.categories (name, slug)
    select 'Kat ' || g, 'kat-' || g from generate_series(1, 40) as g;
    insert into public.categories (name, slug, parent_id)
    select 'Alt ' || g, 'alt-' || g, (select id from public.categories where slug = 'kat-' || (1 + g % 40))
    from generate_series(1, 200) as g;
  `);
  await c.query(`
    insert into public.products (sku, name, stock, active, category_id, availability)
    select 'P-' || g, 'Məhsul ' || g, g % 50, g % 17 <> 0,
      (select id from public.categories where slug = 'alt-' || (1 + g % 200)),
      case when g % 25 = 0 then 'COMING_SOON'::public.product_availability else 'IN_STOCK' end
    from generate_series(1, ${PRODUCTS}) as g;
    insert into public.product_prices (product_id, normal_price, dealer_price, sale_price)
    select id, 10 + (random() * 100)::int, 9, case when random() < 0.1 then 5 end
    from public.products
    where not exists (select 1 from public.product_prices as pp where pp.product_id = products.id);
  `);
  await c.query(`
    insert into public.orders (customer_id, status, payment_status, order_type, total_amount, created_at)
    select
      case when g % 2 = 0 then '${IDS.normal}'::uuid else '${IDS.dealer}'::uuid end,
      (array['PENDING','CONFIRMED','CANCELLED'])[1 + g % 3]::public.order_status,
      (array['UNPAID','PAID','CUSTOMER_REPORTED'])[1 + g % 3]::public.payment_status,
      case when g % 10 = 0 then 'PREORDER'::public.order_type else 'STANDARD' end,
      100,
      now() - (g % 700) * interval '1 day'
    from generate_series(1, ${ORDERS}) as g;
    insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total)
    select o.id, p.id, p.sku, 2, 10, 20
    from public.orders as o
    cross join lateral (
      select id, sku from public.products
      where sku in ('P-' || (1 + abs(hashtext(o.id::text)) % ${PRODUCTS}), 'P-' || (1 + abs(hashtext(o.id::text || 'x')) % ${PRODUCTS}))
    ) as p
    on conflict do nothing;
    insert into public.customer_favorites (customer_id, product_id)
    select '${IDS.normal}', id from public.products where active and sku like 'P-1%' limit 300;
    analyze;
  `);
  const counts = (await c.query("select (select count(*) from public.products) p, (select count(*) from public.orders) o, (select count(*) from public.order_items) i")).rows[0];
  console.log("seeded", counts);

  const session = async (id) => (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  const S = { owner: await session(IDS.owner), normal: await session(IDS.normal) };
  async function timed(who, label, sql) {
    const id = who === "owner" ? IDS.owner : IDS.normal;
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated", aal: "aal1", session_id: S[who] })]);
    await c.query("set local role authenticated");
    await c.query(sql); // warm up
    const runs = [];
    let rows = 0;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      rows = (await c.query(sql)).rowCount;
      runs.push(performance.now() - t);
    }
    await c.query("rollback");
    runs.sort((a, b) => a - b);
    console.log(`${label.padEnd(44)} median ${runs[2].toFixed(1).padStart(7)} ms  rows ${rows}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  await timed("normal", "catalog page 1 (all)", "select * from public.get_customer_catalog_page(1, 24)");
  await timed("normal", "catalog page 50 (all, price sort)", "select * from public.get_customer_catalog_page(50, 24, null, null, 'price_asc')");
  await timed("normal", "catalog category kat-3 + subcategories", "select * from public.get_customer_catalog_page(1, 24, 'kat-3')");
  await timed("normal", "catalog search", "select * from public.get_customer_catalog_page(1, 24, null, 'Məhsul 99')");
  await timed("normal", "categories (sidebar)", "select * from public.get_customer_categories()");
  await timed("normal", "favorites page", "select * from public.get_customer_favorites_page(1, 24)");
  await timed("normal", "favorite ids for 24 products", "select public.get_customer_favorite_ids(array(select id from public.products limit 24))");
  await timed("normal", "customer orders", "select * from public.get_customer_orders()");
  await timed("owner", "admin products page", "select * from public.get_admin_products_page(1, 50)");
  await timed("owner", "admin products coming soon", "select * from public.get_admin_products_page(1, 50, null, null, 'coming_soon')");
  await timed("owner", "admin categories", "select * from public.get_admin_categories()");
  await timed("owner", "admin orders page", "select * from public.get_admin_orders_page(1, 30)");
  await timed("owner", "admin orders preorder filter", "select * from public.get_admin_orders_page(1, 30, null, null, null, 'PREORDER')");
  await timed("owner", "admin order counts", "select * from public.get_admin_order_counts()");
  await timed("owner", "report summary (1 year)", `select * from public.get_admin_report_summary('${yearAgo}', '${today}')`);
  await timed("owner", "report monthly (1 year)", `select * from public.get_admin_report_monthly('${yearAgo}', '${today}')`);
  await timed("owner", "report top products (1 year)", `select * from public.get_admin_report_products('${yearAgo}', '${today}', 10)`);
  await timed("owner", "report unsold products (1 year, page 1)", `select * from public.get_admin_report_unsold_products('${yearAgo}', '${today}', 1, 20)`);
  await timed("owner", "report top customers (1 year)", `select * from public.get_admin_report_customers('${yearAgo}', '${today}', 10)`);
  await timed("owner", "report orders for Excel (1 year)", `select * from public.get_admin_report_orders('${yearAgo}', '${today}')`);
  await timed("owner", "report products for Excel (1 year)", `select * from public.get_admin_report_products('${yearAgo}', '${today}', 20000)`);

  const plan = async (label, sql) => {
    const lines = (await c.query(`explain ${sql}`)).rows.map((r) => r["QUERY PLAN"]);
    console.log(`\n-- ${label}\n${lines.join("\n")}`);
  };
  await plan("orders in a period (report base)", `select count(*) from public.orders where created_at >= now() - interval '30 days' and created_at < now()`);
  await plan("order type filter", `select id from public.orders where order_type = 'PREORDER' order by created_at desc limit 30`);
  await plan("order items of a set of orders", `select oi.product_id, sum(oi.line_total) from public.orders o join public.order_items oi on oi.order_id = o.id where o.created_at >= now() - interval '30 days' group by 1`);
  await plan("category children in order", `select id from public.categories where parent_id = (select id from public.categories where slug = 'kat-1') order by sort_order`);

  await c.end();
} finally {
  await server.stop();
}
