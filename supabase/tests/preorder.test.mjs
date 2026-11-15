// "Tezliklə stokda" products and pre-orders
// (coming_soon_and_preorders migration; local Postgres only).
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const MIGRATION = "20261115130000_coming_soon_and_preorders.sql";
const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  PM: "00000000-0000-4000-8000-000000000062",
  SUPPORT: "00000000-0000-4000-8000-000000000063",
  WAREHOUSE: "00000000-0000-4000-8000-000000000064",
  NORMAL: IDS.normal,
  DEALER: IDS.dealer,
};

try {
  const before = migrationFiles().filter((f) => f < MIGRATION).at(-1);
  const { c } = await createDatabase("preorder_tests", { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'su@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'SU', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
  `);
  const mk = async (sku, stock) => {
    const id = (await c.query("insert into public.products (sku, name, stock, active) values ($1, $1, $2, true) returning id", [sku, stock])).rows[0].id;
    await c.query("insert into public.product_prices (product_id, normal_price, dealer_price) values ($1, 10, 8)", [id]);
    return id;
  };
  // Hand-made data that exists before the migration.
  const STOCKED = await mk("PRE-STOCK", 10);
  const EMPTY = await mk("PRE-EMPTY", 0);
  const SOON = await mk("PRE-SOON", 0);
  const legacyOrder = (await c.query(
    "insert into public.orders (customer_id, status, total_amount) values ($1, 'PENDING', 20) returning id",
    [U.NORMAL]
  )).rows[0].id;
  await c.query(
    "insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total) values ($1, $2, 'PRE-STOCK', 2, 10, 20)",
    [legacyOrder, STOCKED]
  );
  const productsBefore = (await c.query("select id, sku, name, stock, active, category_id, created_at from public.products order by id")).rows;
  const ordersBefore = (await c.query("select id, customer_id, status, total_amount, created_at, updated_at from public.orders order by id")).rows;
  const itemsBefore = (await c.query("select * from public.order_items order by id")).rows;

  for (const file of migrationFiles().filter((f) => f > before)) {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    await c.query("commit");
  }

  // ---- Data preservation.
  ok("products unchanged by the migration", JSON.stringify((await c.query("select id, sku, name, stock, active, category_id, created_at from public.products order by id")).rows) === JSON.stringify(productsBefore));
  ok("orders unchanged by the migration", JSON.stringify((await c.query("select id, customer_id, status, total_amount, created_at, updated_at from public.orders order by id")).rows) === JSON.stringify(ordersBefore));
  ok("order items unchanged", JSON.stringify((await c.query("select * from public.order_items order by id")).rows) === JSON.stringify(itemsBefore));
  ok("existing products are IN_STOCK", (await c.query("select bool_and(availability = 'IN_STOCK') v from public.products")).rows[0].v === true);
  ok("existing orders are STANDARD", (await c.query("select bool_and(order_type = 'STANDARD') v from public.orders")).rows[0].v === true);

  const sessions = {};
  for (const [k, id] of Object.entries(U)) {
    sessions[k] = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  }
  async function as(who, sql, params = [], commit = false) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[who], role: "authenticated", aal: "aal1", session_id: sessions[who] })]);
      await c.query("set local role authenticated");
      const r = await c.query(sql, params);
      await c.query(commit ? "commit" : "rollback");
      return { rows: r.rows };
    } catch (e) {
      await c.query("rollback");
      return { error: e.message };
    }
  }
  const run = (who, sql, params = []) => as(who, sql, params, true);
  const stock = async (id) => (await c.query("select stock from public.products where id = $1", [id])).rows[0].stock;
  const cartRows = async (who) => (await as(who, "select * from public.get_customer_cart()")).rows ?? [];

  // ---- Who may mark a product "Tezliklə stokda".
  let r = await as("SALES", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);
  ok("SALES cannot change availability", /Not authorized/.test(r.error ?? ""));
  r = await as("WAREHOUSE", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);
  ok("WAREHOUSE cannot change availability", /Not authorized/.test(r.error ?? ""));
  r = await as("NORMAL", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);
  ok("customer cannot change availability", /Not authorized/.test(r.error ?? ""));
  r = await run("NORMAL", "update public.products set availability = 'COMING_SOON' where id = $1", [EMPTY]);
  ok("customer cannot update products directly", (await c.query("select availability from public.products where id = $1", [EMPTY])).rows[0].availability === "IN_STOCK", JSON.stringify(r));
  r = await as("PM", "select public.set_admin_product_availability(gen_random_uuid(), 'COMING_SOON')");
  ok("unknown product rejected", /Product not found/.test(r.error ?? ""));
  r = await as("PM", "select public.set_admin_product_availability($1, null)", [SOON]);
  ok("missing availability rejected", /Invalid availability/.test(r.error ?? ""));
  r = await run("PM", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);
  ok("PRODUCT_MANAGER marks coming soon", !r.error, JSON.stringify(r));
  r = await run("OWNER", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);
  ok("repeating is safe", !r.error);

  // ---- Catalog shows it.
  r = await as("NORMAL", "select id, availability, stock from public.get_customer_catalog_page(1, 24)");
  ok("coming soon product visible in catalog", r.rows?.find((x) => x.id === SOON)?.availability === "COMING_SOON", JSON.stringify(r));
  r = await as("NORMAL", "select availability from public.get_customer_product($1)", [SOON]);
  ok("product page has availability", r.rows?.[0]?.availability === "COMING_SOON");

  // ---- Cart.
  r = await as("NORMAL", "select public.add_to_cart($1, 1)", [EMPTY]);
  ok("normal out-of-stock product still cannot be added", /Insufficient stock/.test(r.error ?? ""), JSON.stringify(r));
  r = await run("NORMAL", "select public.add_to_cart($1, 3) as q", [SOON]);
  ok("coming soon product added at stock 0", r.rows?.[0]?.q === 3, JSON.stringify(r));
  r = await run("NORMAL", "select public.change_cart_quantity($1, 2) as q", [SOON]);
  ok("pre-order quantity can grow past stock", r.rows?.[0]?.q === 5, JSON.stringify(r));
  r = await as("NORMAL", "select public.add_to_cart($1, 100001)", [SOON]);
  ok("pre-order quantity is capped", /Insufficient stock/.test(r.error ?? ""));
  r = await run("NORMAL", "select public.add_to_cart($1, 4) as q", [STOCKED]);
  ok("normal product added", r.rows?.[0]?.q === 4);
  r = await as("NORMAL", "select public.add_to_cart($1, 7)", [STOCKED]);
  ok("normal product still limited by stock", /Insufficient stock/.test(r.error ?? ""));
  let cart = await cartRows("NORMAL");
  ok("cart marks the pre-order line", cart.find((x) => x.product_id === SOON)?.is_preorder === true && cart.find((x) => x.product_id === STOCKED)?.is_preorder === false, JSON.stringify(cart));

  // ---- Checkout: one part at a time, never mixed.
  r = await as("NORMAL", "select public.create_order_from_cart(null)");
  ok("missing order type rejected", /Invalid order type/.test(r.error ?? ""));
  r = await run("NORMAL", "select public.create_order_from_cart('PREORDER') as id");
  const preorder = r.rows?.[0]?.id;
  ok("pre-order created", Boolean(preorder), JSON.stringify(r));
  let order = (await c.query("select order_type, total_amount, payment_status from public.orders where id = $1", [preorder])).rows[0];
  ok("order type PREORDER", order?.order_type === "PREORDER");
  ok("pre-order total uses the customer's price", Number(order?.total_amount) === 50);
  let items = (await c.query("select product_id, quantity, unit_price from public.order_items where order_id = $1", [preorder])).rows;
  ok("pre-order holds only the coming soon line", items.length === 1 && items[0].product_id === SOON && items[0].quantity === 5);
  ok("pre-order took no stock", (await stock(SOON)) === 0);
  cart = await cartRows("NORMAL");
  ok("normal line stays in the cart", cart.length === 1 && cart[0].product_id === STOCKED);
  r = await as("NORMAL", "select public.create_order_from_cart('PREORDER')");
  ok("second pre-order checkout finds nothing", /Cart is empty/.test(r.error ?? ""));

  r = await run("NORMAL", "select public.create_order_from_cart('STANDARD') as id");
  const standard = r.rows?.[0]?.id;
  order = (await c.query("select order_type from public.orders where id = $1", [standard])).rows[0];
  ok("normal order created as STANDARD", order?.order_type === "STANDARD", JSON.stringify(r));
  ok("normal order took stock", (await stock(STOCKED)) === 6);
  ok("cart empty afterwards", (await cartRows("NORMAL")).length === 0);

  // ---- Old call (deployed code) only creates a normal order.
  await run("NORMAL", "select public.add_to_cart($1, 1)", [SOON]);
  r = await as("NORMAL", "select public.create_order_from_cart()");
  ok("old checkout ignores pre-order lines", /Cart is empty/.test(r.error ?? ""), JSON.stringify(r));
  await run("NORMAL", "select public.add_to_cart($1, 1)", [STOCKED]);
  r = await run("NORMAL", "select public.create_order_from_cart() as id");
  const oldCall = r.rows?.[0]?.id;
  items = (await c.query("select product_id from public.order_items where order_id = $1", [oldCall])).rows;
  ok("old checkout creates STANDARD with in-stock lines only", items.length === 1 && items[0].product_id === STOCKED);
  ok("pre-order line still waits in the cart", (await cartRows("NORMAL")).some((x) => x.product_id === SOON));

  // ---- Bypass attempts: an out-of-stock IN_STOCK product never sneaks in.
  await c.query("update public.products set stock = 5 where id = $1", [EMPTY]);
  await run("NORMAL", "select public.add_to_cart($1, 5)", [EMPTY]);
  await c.query("update public.products set stock = 0 where id = $1", [EMPTY]);
  r = await as("NORMAL", "select public.create_order_from_cart('PREORDER') as id");
  const sneaky = r.rows?.[0]?.id;
  items = sneaky ? (await c.query("select product_id from public.order_items where order_id = $1", [sneaky])).rows : [];
  ok("in-stock product without stock never goes into a pre-order", !items.some((x) => x.product_id === EMPTY));
  r = await as("NORMAL", "select public.create_order_from_cart('STANDARD')");
  ok("normal checkout still stops at missing stock", /Insufficient stock/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("NORMAL", "select public.change_cart_quantity($1, 1)", [EMPTY]);
  ok("cannot raise a normal line above stock", /Insufficient stock/.test(r.error ?? ""));
  await run("NORMAL", "select public.remove_from_cart($1)", [EMPTY]);

  // A product that goes back to IN_STOCK leaves the pre-order part.
  await run("OWNER", "select public.set_admin_product_availability($1, 'IN_STOCK')", [SOON]);
  cart = await cartRows("NORMAL");
  ok("line follows the product's availability", cart.find((x) => x.product_id === SOON)?.is_preorder === false);
  r = await as("NORMAL", "select public.create_order_from_cart('STANDARD')");
  ok("back in stock but no stock: normal checkout refuses", /Insufficient stock/.test(r.error ?? ""));
  r = await as("NORMAL", "select public.create_order_from_cart('PREORDER')");
  ok("...and it is no longer a pre-order", /Cart is empty/.test(r.error ?? ""));
  await run("OWNER", "select public.set_admin_product_availability($1, 'COMING_SOON')", [SOON]);

  // Inactive coming soon product cannot be pre-ordered.
  await c.query("update public.products set active = false where id = $1", [SOON]);
  r = await as("NORMAL", "select public.create_order_from_cart('PREORDER')");
  ok("inactive coming soon product blocks pre-order", /unavailable product/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("NORMAL", "select public.add_to_cart($1, 1)", [SOON]);
  ok("inactive coming soon product cannot be added", /Product not found/.test(r.error ?? ""));
  await c.query("update public.products set active = true where id = $1", [SOON]);
  await run("NORMAL", "select public.remove_from_cart($1)", [SOON]);

  // ---- Staff: cancel / edit pre-orders without touching stock.
  await c.query("update public.products set stock = 3 where id = $1", [SOON]);
  r = await run("SALES", "select public.update_admin_order_items($1, $2::jsonb) as n", [preorder, JSON.stringify([{ product_id: SOON, quantity: 9 }])]);
  ok("staff raises pre-order quantity beyond stock", r.rows?.[0]?.n === 1, JSON.stringify(r));
  ok("pre-order edit takes no stock", (await stock(SOON)) === 3);
  r = await as("SALES", "select public.update_admin_order_items($1, $2::jsonb)", [preorder, JSON.stringify([{ product_id: SOON, quantity: 9 }, { product_id: STOCKED, quantity: 1 }])]);
  ok("in-stock product cannot be added to a pre-order", /Only coming soon products/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("SALES", "select id from public.search_admin_order_products($1, 'PRE')", [preorder]);
  ok("product search for a pre-order offers coming soon only", r.rows?.length === 1 && r.rows[0].id === SOON, JSON.stringify(r));
  r = await as("SALES", "select id from public.search_admin_order_products($1, 'PRE')", [standard]);
  ok("product search for a normal order offers all", (r.rows?.length ?? 0) >= 2);
  const stockedBefore = await stock(STOCKED);
  r = await run("SALES", "select public.update_admin_order_items($1, $2::jsonb) as n", [standard, JSON.stringify([{ product_id: STOCKED, quantity: 6 }])]);
  ok("normal order edit still moves stock", !r.error && (await stock(STOCKED)) === stockedBefore - 2, JSON.stringify(r));
  r = await as("SALES", "select public.update_admin_order_items($1, $2::jsonb)", [standard, JSON.stringify([{ product_id: STOCKED, quantity: 100 }])]);
  ok("normal order edit still checks stock", /Insufficient stock/.test(r.error ?? ""));

  r = await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED') as s", [preorder]);
  ok("pre-order cancelled", r.rows?.[0]?.s === "CANCELLED", JSON.stringify(r));
  ok("cancelling a pre-order returns no stock", (await stock(SOON)) === 3);
  const before2 = await stock(STOCKED);
  r = await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED') as s", [oldCall]);
  ok("cancelling a normal order still returns stock", (await stock(STOCKED)) === before2 + 1);

  // ---- Lists and filter.
  r = await as("SALES", "select order_id, order_type, total_count from public.get_admin_orders_page(1, 50, null, null, null, 'PREORDER')");
  ok("admin filter Ön sifariş", r.rows?.length === 1 && r.rows[0].order_id === preorder, JSON.stringify(r));
  r = await as("SALES", "select order_id from public.get_admin_orders_page(1, 50, null, null, null, 'STANDARD')");
  ok("admin filter Normal", r.rows?.length === 3 && !r.rows.some((x) => x.order_id === preorder));
  r = await as("SALES", "select * from public.get_admin_order_counts()");
  ok("counts per type", Number(r.rows?.[0]?.preorder) === 1 && Number(r.rows?.[0]?.standard) === 3, JSON.stringify(r));
  r = await as("WAREHOUSE", "select order_type from public.get_admin_order($1)", [preorder]);
  ok("order detail has type", r.rows?.[0]?.order_type === "PREORDER");
  r = await as("NORMAL", "select order_id, order_type from public.get_customer_orders()");
  ok("customer sees order types", r.rows?.find((x) => x.order_id === preorder)?.order_type === "PREORDER");
  r = await as("SUPPORT", "select order_type from public.get_admin_customer_orders($1)", [U.NORMAL]);
  ok("customer card has order types", r.rows?.some((x) => x.order_type === "PREORDER"));
  r = await as("PM", "select id, availability, total_count from public.get_admin_products_page(1, 50, null, null, 'coming_soon')");
  ok("admin product filter Tezliklə stokda", r.rows?.length === 1 && r.rows[0].id === SOON, JSON.stringify(r));
  r = await as("WAREHOUSE", "select availability, normal_price from public.get_admin_product($1)", [SOON]);
  ok("warehouse sees availability but no price", r.rows?.[0]?.availability === "COMING_SOON" && r.rows[0].normal_price === null);
  r = await as("NORMAL", "select * from public.get_admin_orders_page()");
  ok("customer cannot list admin orders", /Not authorized/.test(r.error ?? ""));
  r = await as("NORMAL", "select availability from public.get_customer_favorites_page()");
  ok("favorites page still works", !r.error, JSON.stringify(r));

  // ---- Legacy order untouched by everything above.
  ok("legacy order still STANDARD and unchanged", (await c.query("select order_type, total_amount from public.orders where id = $1", [legacyOrder])).rows[0].order_type === "STANDARD");

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
