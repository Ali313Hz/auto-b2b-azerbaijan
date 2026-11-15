// faster_prices_and_customer_lookup migration: every price the customer
// sees or pays is exactly the same before and after; get_admin_customer
// returns the same row as the full list and keeps the role check.
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const MIGRATION = "20261116100000_faster_prices_and_customer_lookup.sql";
const STAFF = {
  PM: "00000000-0000-4000-8000-000000000072",
  WAREHOUSE: "00000000-0000-4000-8000-000000000074",
  SUPPORT: "00000000-0000-4000-8000-000000000073",
};

try {
  const before = migrationFiles().filter((f) => f < MIGRATION).at(-1);
  const { c } = await createDatabase("price_speed_tests", { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${STAFF.PM}', 'pm@t'), ('${STAFF.WAREHOUSE}', 'wh@t'), ('${STAFF.SUPPORT}', 'su@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${STAFF.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${STAFF.WAREHOUSE}', 'WH', 'WAREHOUSE', true),
      ('${STAFF.SUPPORT}', 'SU', 'SUPPORT', true);
    insert into public.categories (name, slug) values ('Ana', 'ana');
    insert into public.products (sku, name, stock, active, category_id, availability)
    select 'S-' || g, 'Məhsul ' || (g % 41), 3 + g % 7, true,
      case when g % 2 = 0 then (select id from public.categories where slug = 'ana') end,
      case when g % 6 = 0 then 'COMING_SOON'::public.product_availability else 'IN_STOCK' end
    from generate_series(1, 240) as g;
    -- Every combination: dealer/vip price missing or set, sale price
    -- missing, below or above the group price (always below normal).
    insert into public.product_prices (product_id, normal_price, dealer_price, vip_price, sale_price)
    select id, n,
      case when h % 3 <> 0 then 30 + h % 10 end,
      case when h % 4 <> 0 then 25 + h % 10 end,
      case abs(hashtext(sku || 's')) % 3 when 0 then null when 1 then 10 + h % 10 else n - 1 - h % 3 end
    from (
      select id, sku, abs(hashtext(sku)) as h, 45 + abs(hashtext(sku)) % 45 as n
      from public.products
      where not exists (select 1 from public.product_prices as pp where pp.product_id = products.id)
    ) as x;
    insert into public.customer_favorites (customer_id, product_id)
    select cp.id, p.id from public.customer_profiles as cp cross join (select id from public.products limit 60) as p
    where cp.id in ('${IDS.normal}', '${IDS.dealer}', '${IDS.vip}');
  `);

  const who = { NORMAL: IDS.normal, DEALER: IDS.dealer, VIP: IDS.vip, OWNER: IDS.owner, SALES: IDS.sales, ...STAFF };
  const sessions = {};
  for (const [k, id] of Object.entries(who)) {
    sessions[k] = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  }
  async function as(k, sql, params = []) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who[k], role: "authenticated", aal: "aal1", session_id: sessions[k] })]);
      await c.query("set local role authenticated");
      // Several statements (no params) return one result each; keep the last.
      const res = await c.query(sql, params.length ? params : undefined);
      return JSON.stringify((Array.isArray(res) ? res.at(-1) : res).rows);
    } catch (e) {
      return `ERROR ${e.message}`;
    } finally {
      await c.query("rollback");
    }
  }

  const productIds = (await c.query("select id from public.products order by sku limit 40")).rows.map((r) => r.id);
  // Customers cannot read the products table, so the ids are picked here.
  const ids = async (where, n) =>
    (await c.query(`select id from public.products where ${where} order by sku limit ${n}`)).rows.map((r) => `'${r.id}'`).join(", ");
  const inStock = await ids("availability = 'IN_STOCK'", 5);
  const mixed = await ids("true", 8);
  // A cart with a few in-stock products, then the order it creates.
  const orderFlow = `
    select public.add_to_cart(id, 1) from unnest(array[${inStock}]::uuid[]) as id;
    select set_config('test.order_id', public.create_order_from_cart('STANDARD')::text, true);
    select oi.sku, oi.unit_price, oi.line_total, ord.total_amount
    from public.get_customer_orders() as ord
    cross join lateral public.get_customer_order_items(ord.order_id) as oi
    where ord.order_id = current_setting('test.order_id')::uuid
    order by oi.sku`;
  // Cart with in-stock and coming-soon products.
  const cartFlow = `
    select public.add_to_cart(id, 1) from unnest(array[${mixed}]::uuid[]) as id;
    select * from public.get_customer_cart()`;

  const calls = [];
  for (const k of ["NORMAL", "DEALER", "VIP"]) {
    for (const sort of ["name", "price_asc", "price_desc"]) {
      for (const sale of [false, true]) {
        for (const page of [1, 2, 5]) calls.push([k, "select * from public.get_customer_catalog_page($1, 24, null, null, $2, true, $3)", [page, sort, sale]]);
      }
    }
    calls.push([k, "select * from public.get_customer_catalog_page(1, 100, 'ana')", []]);
    calls.push([k, "select * from public.get_customer_favorites_page(1, 100)", []]);
    for (const id of productIds) calls.push([k, "select * from public.get_customer_product($1)", [id]]);
    calls.push([k, cartFlow, []]);
    calls.push([k, orderFlow, []]);
  }
  calls.push(["OWNER", "select * from public.get_admin_products_page(1, 100, null, null, null, false, 'sku')", []]);
  calls.push(["OWNER", "select * from public.get_admin_customers()", []]);

  const beforeRows = [];
  for (const [k, sql, params] of calls) beforeRows.push(await as(k, sql, params));

  await c.query("begin");
  await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
  await c.query("commit");

  let same = 0;
  for (let i = 0; i < calls.length; i++) {
    const after = await as(calls[i][0], calls[i][1], calls[i][2]);
    // Order ids/times differ per run; compare only the price columns there.
    if (after === beforeRows[i]) same++;
    else failures.push(`different result for ${calls[i][0]} ${calls[i][1].slice(0, 70)} ${JSON.stringify(calls[i][2])}\n   before ${beforeRows[i].slice(0, 200)}\n   after  ${after.slice(0, 200)}`);
  }
  ok(`all ${calls.length} price-dependent calls identical before/after`, same === calls.length);
  const firstError = beforeRows.findIndex((r) => r.startsWith("ERROR"));
  ok("no errors before", firstError < 0, firstError < 0 ? "" : `${beforeRows[firstError]} in ${calls[firstError][0]} ${calls[firstError][1].slice(0, 120)}`);
  ok("results not empty", beforeRows.filter((r) => r.startsWith("[{")).length > calls.length * 0.9);
  ok("orders were really created in the check", beforeRows.filter((r) => r.includes("total_amount")).length === 3);
  ok("carts were really filled in the check", beforeRows.filter((r) => r.includes("line_total") && !r.includes("total_amount")).length >= 3);

  // Helpers are inlinable now (no own search_path) and still private.
  const helpers = (await c.query(`
    select p.proname, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('group_price', 'effective_price')`)).rows;
  ok("price helpers have no own search_path", helpers.length === 2 && helpers.every((h) => h.proconfig === null));
  ok("price helpers not callable by API roles", helpers.every((h) => !h.auth && !h.anon));
  const r = await as("DEALER", "select private.effective_price('DEALER', 10, 5, 4, null)");
  ok("customer cannot call price helper", r.startsWith("ERROR"));

  // get_admin_customer.
  const list = JSON.parse(await as("OWNER", "select * from public.get_admin_customers()"));
  for (const row of list) {
    const one = JSON.parse(await as("OWNER", "select * from public.get_admin_customer($1)", [row.id]));
    ok(`get_admin_customer = list row (${row.company_name})`, one.length === 1 && JSON.stringify(one[0]) === JSON.stringify(row), JSON.stringify(one));
  }
  ok("unknown customer -> no row", (await as("OWNER", "select * from public.get_admin_customer(gen_random_uuid())")) === "[]");
  for (const k of ["OWNER", "SALES", "SUPPORT"]) {
    ok(`${k} can read one customer`, !(await as(k, "select * from public.get_admin_customer($1)", [IDS.normal])).startsWith("ERROR"));
  }
  for (const k of ["PM", "WAREHOUSE", "NORMAL", "DEALER"]) {
    ok(`${k} cannot read a customer`, /Not authorized to view customers/.test(await as(k, "select * from public.get_admin_customer($1)", [IDS.normal])));
  }
  const anon = await c.query("select has_function_privilege('anon', 'public.get_admin_customer(uuid)', 'execute') a").then((x) => x.rows[0].a);
  ok("anon cannot call get_admin_customer", anon === false);

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures.slice(0, 20)) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
