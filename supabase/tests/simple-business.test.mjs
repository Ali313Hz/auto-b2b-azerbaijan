// NORMAL-first business model: optional dealer/VIP prices, sale prices,
// deep category tree, direct order editing with stock deltas and change
// history (local Postgres only).
import { startServer, createDatabase, pool } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  PM: "00000000-0000-4000-8000-000000000052",
  SUPPORT: "00000000-0000-4000-8000-000000000053",
  WAREHOUSE: "00000000-0000-4000-8000-000000000054",
  NORMAL: IDS.normal,
  DEALER: IDS.dealer,
  VIP: IDS.vip,
  NEWCUST: "00000000-0000-4000-8000-000000000055",
};

try {
  const { c } = await createDatabase("simple_tests");
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'sup@t'),
      ('${U.WAREHOUSE}', 'wh@t'), ('${U.NEWCUST}', 'new@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'Sup', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
  `);

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
  const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
  const stock = async (id) => (await one("select stock from public.products where id = $1", [id])).stock;

  // ---- 1. New customer: price group defaults to NORMAL (the app sends none).
  await c.query(`insert into public.customer_profiles (id, company_name, contact_name, active) values ('${U.NEWCUST}', 'New LLC', 'N', true)`);
  ok("new customer is NORMAL by default", (await one(`select price_group from public.customer_profiles where id = '${U.NEWCUST}'`)).price_group === "NORMAL");

  // ---- 3. Category tree: 5 levels, full path, cycle and descendant moves.
  const mkCat = async (name, slug, parent) =>
    (await run("OWNER", "select public.create_admin_category($1, $2, 0, true, $3) as id", [name, slug, parent])).rows?.[0]?.id;
  const L1 = await mkCat("Avtomobil işıqlandırması", "avto-isiq", null);
  const L2 = await mkCat("LED", "led", L1);
  const L3 = await mkCat("Far lampaları", "far-lampalari", L2);
  const L4 = await mkCat("H7", "h7", L3);
  const L5 = await mkCat("Premium", "premium", L4);
  ok("5 nested levels created", [L1, L2, L3, L4, L5].every(Boolean));
  const pmCreate = await as("PM", "select public.create_admin_category('Salon', 'salon-pm', 0, true, $1) as id", [L5]);
  ok("PRODUCT_MANAGER can create a 6th-level category", !pmCreate.error, pmCreate.error);
  const cats = (await as("OWNER", "select * from public.get_admin_categories()")).rows;
  const h7 = cats.find((x) => x.id === L5);
  ok("admin category depth/path", h7?.depth === 5 && h7.path === "Avtomobil işıqlandırması / LED / Far lampaları / H7 / Premium", JSON.stringify(h7));
  let r = await as("OWNER", "select public.update_admin_category($1, 'Avtomobil işıqlandırması', 'avto-isiq', 0, true, $2)", [L1, L4]);
  ok("cycle blocked (root under its descendant)", /cycle/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("OWNER", "select public.update_admin_category($1, 'LED', 'led', 0, true, $1)", [L2]);
  ok("self parent blocked", !!r.error);
  r = await as("OWNER", "select public.update_admin_category($1, 'H7', 'h7', 0, true, $2)", [L4, L5]);
  ok("move under own child blocked", /cycle/.test(r.error ?? ""), JSON.stringify(r));
  // Safe move: H7 subtree goes directly under LED; children follow.
  r = await run("OWNER", "select public.update_admin_category($1, 'H7', 'h7', 0, true, $2)", [L4, L2]);
  const moved = (await as("OWNER", "select * from public.get_admin_categories()")).rows.find((x) => x.id === L5);
  ok("moving parent works and keeps the subtree", !r.error && moved?.depth === 4 && moved.path === "Avtomobil işıqlandırması / LED / H7 / Premium", JSON.stringify([r, moved]));
  for (const who of ["SALES", "SUPPORT", "WAREHOUSE", "NORMAL"]) {
    r = await as(who, "select public.create_admin_category('Z', 'z-z', 0, true, null)");
    ok(`${who} cannot create categories`, !!r.error);
  }

  // ---- 2. Products: NORMAL only, or with optional dealer/VIP prices.
  const create = (who, sku, cat, stockN, n, d, v, s, active = true) =>
    as(who, "select public.create_admin_product($1, $2, $3, $4, $5, $6, $7, $8) as id", [sku, cat, stockN, n, d, v, s, active], true);
  r = await create("PM", "LED-H7-001", L5, 10, 45, null, null, null);
  const H7 = r.rows?.[0]?.id;
  ok("normal-only product created (PM)", !!H7, JSON.stringify(r));
  let pr = await one("select * from public.product_prices where product_id = $1", [H7]);
  ok("unchecked: no dealer/VIP prices stored", pr.normal_price == 45 && pr.dealer_price === null && pr.vip_price === null && pr.sale_price === null, JSON.stringify(pr));
  r = await create("OWNER", "LED-H4-001", L4, 5, 30, 25, 20, null);
  const H4 = r.rows?.[0]?.id;
  pr = await one("select * from public.product_prices where product_id = $1", [H4]);
  ok("checked: dealer/VIP prices stored", pr.normal_price == 30 && pr.dealer_price == 25 && pr.vip_price == 20, JSON.stringify(pr));
  r = await create("OWNER", "MAT-001", L1, 3, 20, null, null, null);
  const MAT = r.rows?.[0]?.id;
  r = await create("OWNER", "BAD-1", L1, 1, null, null, null, null);
  ok("normal price required", /Normal price is required/.test(r.error ?? ""), JSON.stringify(r));
  r = await create("OWNER", "BAD-2", L1, 1, 10, -1, null, null);
  ok("negative dealer price rejected", !!r.error);
  r = await create("OWNER", "BAD-3", L1, 1, 10, null, null, 10);
  ok("sale price must be lower than normal", /Sale price must be lower/.test(r.error ?? ""), JSON.stringify(r));
  for (const who of ["SALES", "SUPPORT", "WAREHOUSE", "NORMAL"]) {
    r = await create(who, `X-${who}`, L1, 1, 10, null, null, null);
    ok(`${who} cannot create products`, !!r.error);
  }

  // Dealer without own price pays NORMAL; with own price pays it.
  const catalogPrice = async (who, id) => (await as(who, "select * from public.get_customer_product($1)", [id])).rows?.[0];
  ok("dealer falls back to normal price", Number((await catalogPrice("DEALER", H7))?.price) === 45);
  ok("dealer own price used", Number((await catalogPrice("DEALER", H4))?.price) === 25);
  ok("normal customer price", Number((await catalogPrice("NORMAL", H4))?.price) === 30);

  // Category path visible to customers (5 levels) and products deep inside.
  const deep = await as("NORMAL", "select * from public.get_customer_catalog_page(1, 50, 'avto-isiq')");
  ok("root category lists products 4 levels down", deep.rows?.some((x) => x.id === H7), JSON.stringify(deep).slice(0, 200));
  await c.query("update public.categories set active = false where id = $1", [L2]);
  const hidden = await as("NORMAL", "select * from public.get_customer_catalog_page(1, 50)");
  ok("inactive 2nd-level ancestor hides 4th-level product", !hidden.rows.some((x) => x.id === H7) && hidden.rows.some((x) => x.id === MAT));
  r = await as("NORMAL", "select public.add_to_cart($1, 1)", [H7]);
  ok("cart rejects product under inactive deep ancestor", /Product not found/.test(r.error ?? ""));
  await c.query("update public.categories set active = true where id = $1", [L2]);

  // ---- 5 + 6. Sale: 45 -> 39.
  r = await as("PM", "select public.update_admin_product_pricing($1, 10, 45, null, null, 39)", [H7], true);
  ok("PM sets sale price", !r.error, r.error);
  r = await as("PM", "select public.update_admin_product_pricing($1, 10, 45, null, null, 45)", [H7]);
  ok("sale price equal to normal rejected", /Sale price must be lower/.test(r.error ?? ""));
  r = await as("WAREHOUSE", "select public.update_admin_product_pricing($1, 10, 45, null, null, 30)", [H7]);
  ok("WAREHOUSE cannot change prices", !!r.error);
  let item = await catalogPrice("NORMAL", H7);
  ok("catalog shows 39 with old price 45", Number(item?.price) === 39 && Number(item?.regular_price) === 45 && item?.on_sale === true, JSON.stringify(item));
  const page = (await as("NORMAL", "select * from public.get_customer_catalog_page(1, 50)")).rows;
  const card = page.find((x) => x.id === H7);
  ok("catalog card: price 39, regular 45, on_sale", Number(card?.price) === 39 && Number(card?.regular_price) === 45 && card?.on_sale === true);
  ok("catalog response has no dealer/VIP price columns", page.every((x) => !("dealer_price" in x) && !("vip_price" in x) && !("normal_price" in x)));
  ok("non-sale product not marked", page.find((x) => x.id === MAT)?.on_sale === false);
  // Dealer whose own price (25) is below the sale price (H4 has no sale): not on sale.
  ok("dealer own price not shown as sale", (await catalogPrice("DEALER", H4))?.on_sale === false);

  // Sale filter + pagination (on_sale only, page size 1).
  r = await as("OWNER", "select public.update_admin_product_pricing($1, 3, 20, null, null, 15)", [MAT], true);
  const s1 = (await as("NORMAL", "select * from public.get_customer_catalog_page(1, 1, null, null, 'name', true, true)")).rows;
  const s2 = (await as("NORMAL", "select * from public.get_customer_catalog_page(2, 1, null, null, 'name', true, true)")).rows;
  const s3 = (await as("NORMAL", "select * from public.get_customer_catalog_page(3, 1, null, null, 'name', true, true)")).rows;
  ok("sale filter: page 1 and 2 with total 2", s1.length === 1 && s2.length === 1 && Number(s1[0].total_count) === 2 && s1[0].id !== s2[0].id && s3.length === 0, JSON.stringify([s1, s2, s3]).slice(0, 300));
  ok("sale filter only returns sale products", [...s1, ...s2].every((x) => x.on_sale));
  const saleInCat = (await as("NORMAL", "select * from public.get_customer_catalog_page(1, 50, 'led', null, 'name', true, true)")).rows;
  ok("sale filter works with category", saleInCat.length === 1 && saleInCat[0].id === H7);
  const adminSale = (await as("OWNER", "select * from public.get_admin_products_page(1, 50, null, null, 'sale')")).rows;
  ok("admin product list sale filter", adminSale.length === 2 && adminSale.every((x) => x.sale_price !== null));
  const whSale = (await as("WAREHOUSE", "select * from public.get_admin_products_page(1, 50, null, null, 'sale')")).rows;
  ok("WAREHOUSE sale filter shows nothing (no prices)", whSale.length === 0);

  // Order snapshots 39; ending the sale later keeps 39 on the old order.
  await run("NORMAL", "select public.add_to_cart($1, 2)", [H7]);
  const cart = (await as("NORMAL", "select * from public.get_customer_cart()")).rows;
  ok("cart uses sale price", Number(cart[0]?.unit_price) === 39 && Number(cart[0]?.regular_price) === 45 && Number(cart[0]?.line_total) === 78, JSON.stringify(cart));
  const saleOrder = (await run("NORMAL", "select public.create_order_from_cart() as id")).rows[0].id;
  const soItem = await one("select * from public.order_items where order_id = $1", [saleOrder]);
  ok("order snapshots sale price 39", Number(soItem.unit_price) === 39 && Number(soItem.line_total) === 78);
  r = await as("OWNER", "select public.update_admin_product_pricing($1, $2, 45, null, null, null)", [H7, await stock(H7)], true);
  ok("sale can be switched off", !r.error, r.error);
  ok("sale disabled: catalog back to 45", Number((await catalogPrice("NORMAL", H7))?.price) === 45 && (await catalogPrice("NORMAL", H7))?.on_sale === false);
  const soAfter = await one("select o.total_amount, oi.unit_price from public.orders o join public.order_items oi on oi.order_id = o.id where o.id = $1", [saleOrder]);
  ok("old order stays 39 after sale ends", Number(soAfter.unit_price) === 39 && Number(soAfter.total_amount) === 78);

  // Old 5-argument update keeps existing dealer/VIP prices it is given and
  // drops a sale that would no longer be lower.
  await as("OWNER", "select public.update_admin_product_pricing($1, 3, 20, null, null, 15)", [MAT], true);
  await as("OWNER", "select public.update_admin_product($1, 3, 14, null, null)", [MAT], true);
  ok("old update clears an invalid sale", (await one("select sale_price from public.product_prices where product_id = $1", [MAT])).sale_price === null);

  // ---- 7-12. Order editing. Customer orders 2 × H7 (45) = 90.
  const pricesBefore = (await one("select string_agg(product_id||':'||normal_price||'/'||coalesce(dealer_price::text,'-')||'/'||coalesce(sale_price::text,'-'), ',' order by product_id) s from public.product_prices")).s;
  const h7Start = await stock(H7);
  await run("NORMAL", "select public.add_to_cart($1, 2)", [H7]);
  const orderId = (await run("NORMAL", "select public.create_order_from_cart() as id")).rows[0].id;
  ok("order reserves stock (-2)", (await stock(H7)) === h7Start - 2);
  const order = async () => one("select * from public.orders where id = $1", [orderId]);
  const items = async () => (await c.query("select product_id, quantity, unit_price::float8 p, line_total::float8 t from public.order_items where order_id = $1 order by sku", [orderId])).rows;
  const edit = (who, list, extra = null) =>
    as(who, "select public.update_admin_order_items($1, $2::jsonb, $3) as n", [orderId, JSON.stringify(list), extra], true);

  // Unauthorized roles.
  for (const who of ["SUPPORT", "WAREHOUSE", "PM", "NORMAL", "DEALER"]) {
    r = await as(who, "select public.update_admin_order_items($1, $2::jsonb)", [orderId, JSON.stringify([{ product_id: H7, quantity: 1, unit_price: "1.00" }])]);
    ok(`${who} cannot edit order`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  ok("unauthorized attempts changed nothing", (await stock(H7)) === h7Start - 2 && (await items())[0].quantity === 2);

  // Quantity decrease 2 -> 1: stock +1.
  r = await edit("SALES", [{ product_id: H7, quantity: 1 }]);
  ok("SALES decreases quantity", r.rows?.[0]?.n === 1, JSON.stringify(r));
  ok("qty decrease returns 1 to stock", (await stock(H7)) === h7Start - 1);
  ok("total 45 after decrease", Number((await order()).total_amount) === 45);

  // Double submit of the same list: no second stock change.
  r = await edit("SALES", [{ product_id: H7, quantity: 1 }]);
  ok("double submit is a no-op", r.rows?.[0]?.n === 0 && (await stock(H7)) === h7Start - 1);

  // Quantity increase 1 -> 4: stock -3.
  r = await edit("OWNER", [{ product_id: H7, quantity: 4 }]);
  ok("qty increase takes extra stock", !r.error && (await stock(H7)) === h7Start - 4, JSON.stringify(r));

  // Price override 45 -> 42: catalog unchanged, stock untouched.
  const before = await stock(H7);
  r = await edit("SALES", [{ product_id: H7, quantity: 4, unit_price: "42.00" }]);
  ok("price override saved", !r.error && (await items())[0].p === 42 && (await items())[0].t === 168, JSON.stringify(await items()));
  ok("price-only change does not touch stock", (await stock(H7)) === before);
  ok("catalog price unchanged by override", Number((await catalogPrice("NORMAL", H7))?.price) === 45);

  // Add product (catalog price used when none given) and remove one.
  const matStart = await stock(MAT);
  r = await edit("SALES", [{ product_id: H7, quantity: 4, unit_price: "42.00" }, { product_id: MAT, quantity: 2 }]);
  const withMat = await items();
  ok("add product uses catalog price and takes stock", !r.error && withMat.find((x) => x.product_id === MAT)?.p === 14 && (await stock(MAT)) === matStart - 2, JSON.stringify([r, withMat]));
  r = await edit("SALES", [{ product_id: MAT, quantity: 2 }]);
  ok("remove product returns its stock", !r.error && (await stock(H7)) === h7Start && (await items()).length === 1, JSON.stringify(r));
  ok("total recalculated on server", Number((await order()).total_amount) === 28);

  // Rejections.
  r = await edit("SALES", [{ product_id: MAT, quantity: 999 }]);
  ok("insufficient stock rejected with SKU", /Insufficient stock for MAT-001/.test(r.error ?? ""), JSON.stringify(r));
  r = await edit("SALES", []);
  ok("empty order rejected", /at least one product/.test(r.error ?? ""));
  r = await edit("SALES", [{ product_id: MAT, quantity: 1 }, { product_id: MAT, quantity: 1 }]);
  ok("duplicate product rejected", /Duplicate product/.test(r.error ?? ""));
  r = await edit("SALES", [{ product_id: MAT, quantity: 0 }]);
  ok("zero quantity rejected", /Invalid quantity/.test(r.error ?? ""));
  r = await edit("SALES", [{ product_id: MAT, quantity: 1, unit_price: "-5" }]);
  ok("negative price rejected", /Invalid price/.test(r.error ?? ""));
  r = await edit("SALES", [{ product_id: MAT, quantity: 1, unit_price: "1.999" }]);
  ok("3-decimal price rejected", /Invalid price/.test(r.error ?? ""));
  await c.query("update public.products set active = false where id = $1", [H4]);
  r = await edit("SALES", [{ product_id: MAT, quantity: 2 }, { product_id: H4, quantity: 1 }]);
  ok("inactive product cannot be added", /not available/.test(r.error ?? ""), JSON.stringify(r));
  await c.query("update public.products set active = true where id = $1", [H4]);
  const stale = (await one("select updated_at::text as u from public.orders where id = $1", [orderId])).u;
  await edit("SALES", [{ product_id: MAT, quantity: 1 }]);
  r = await edit("OWNER", [{ product_id: MAT, quantity: 3 }], stale);
  ok("stale view rejected (someone else changed it)", /changed by someone else/.test(r.error ?? ""), JSON.stringify(r));
  r = await edit("OWNER", [{ product_id: MAT, quantity: 1 }], stale);
  ok("stale view with identical list is a harmless no-op", r.rows?.[0]?.n === 0);
  ok("product_prices never changed by order edits", (await one("select string_agg(product_id||':'||normal_price||'/'||coalesce(dealer_price::text,'-')||'/'||coalesce(sale_price::text,'-'), ',' order by product_id) s from public.product_prices")).s === pricesBefore);

  // Two parallel saves of the same change: stock moves once.
  const pl = pool("simple_tests", 4);
  const parallel = async () => {
    const cl = await pl.connect();
    try {
      await cl.query("begin");
      await cl.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.SALES, role: "authenticated", aal: "aal1", session_id: sessions.SALES })]);
      await cl.query("set local role authenticated");
      const res = await cl.query("select public.update_admin_order_items($1, $2::jsonb) as n", [orderId, JSON.stringify([{ product_id: MAT, quantity: 2 }])]);
      await cl.query("commit");
      return res.rows[0].n;
    } catch (e) {
      await cl.query("rollback");
      return e.message;
    } finally {
      cl.release();
    }
  };
  const matBefore = await stock(MAT);
  const both = await Promise.all([parallel(), parallel()]);
  ok("parallel identical saves: one change, one no-op", both.sort().join(",") === "0,1", JSON.stringify(both));
  ok("parallel saves move stock once", (await stock(MAT)) === matBefore - 1);
  await pl.end();

  // ---- 9 + 10. History: admin detail, customer readable summary.
  const adminLog = (await as("SALES", "select * from public.get_admin_order_changes($1)", [orderId])).rows;
  ok("admin history has added/removed/updated rows", ["ITEM_ADDED", "ITEM_REMOVED", "ITEM_UPDATED", "ORDER_UPDATED"].every((t) => adminLog.some((x) => x.change_type === t)), JSON.stringify(adminLog.map((x) => x.change_type)));
  const qtyRow = adminLog.find((x) => x.change_type === "ITEM_UPDATED" && x.before?.quantity === 2 && x.after?.quantity === 1);
  ok("admin history keeps before/after (2 -> 1) with actor", !!qtyRow && qtyRow.actor_name === "Sales", JSON.stringify(qtyRow));
  const priceRow = adminLog.find((x) => x.change_type === "ITEM_UPDATED" && Number(x.before?.unit_price) === 45 && Number(x.after?.unit_price) === 42);
  ok("admin history keeps price 45 -> 42", !!priceRow);
  const whLog = (await as("WAREHOUSE", "select * from public.get_admin_order_changes($1)", [orderId])).rows;
  ok("WAREHOUSE history without prices", whLog.length === adminLog.length && whLog.every((x) => !("unit_price" in (x.before ?? {})) && !("unit_price" in (x.after ?? {})) && !("total" in (x.after ?? {}))));
  const custLog = (await as("NORMAL", "select * from public.get_customer_order_changes($1)", [orderId])).rows;
  ok("customer sees change summary", custLog.some((x) => x.change_type === "ITEM_UPDATED" && x.quantity_before === 2 && x.quantity_after === 1) && custLog.some((x) => x.change_type === "ITEM_REMOVED" && x.product_name === "LED-H7-001") && custLog.some((x) => x.change_type === "ITEM_ADDED"), JSON.stringify(custLog).slice(0, 300));
  ok("customer summary has no staff identity", custLog.every((x) => !("actor_name" in x) && !("actor_user_id" in x)));
  const custLines = (await as("NORMAL", "select * from public.get_customer_order_lines($1)", [orderId])).rows;
  ok("customer sees updated order lines", custLines.length === 1 && custLines[0].product_id === MAT && custLines[0].quantity === 2);
  ok("other customer cannot read changes (IDOR)", (await as("DEALER", "select * from public.get_customer_order_changes($1)", [orderId])).rows.length === 0);
  ok("other customer cannot read lines (IDOR)", (await as("DEALER", "select * from public.get_customer_order_lines($1)", [orderId])).rows.length === 0);
  r = await as("OWNER", "delete from public.order_change_log where order_id = $1", [orderId]);
  ok("change log cannot be deleted by API users", !!r.error);
  r = await c.query("begin").then(() => c.query("update public.order_change_log set sku = 'x'")).then(() => null, (e) => e.message);
  await c.query("rollback");
  ok("change log is append-only even for the owner role", /append-only/.test(r ?? ""), r);

  // ---- Cancel returns exactly the current quantities once.
  const matPreCancel = await stock(MAT);
  r = await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED')", [orderId]);
  ok("cancel returns current quantity once", !r.error && (await stock(MAT)) === matPreCancel + 2);
  r = await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED')", [orderId]);
  ok("second cancel changes nothing", !r.error && (await stock(MAT)) === matPreCancel + 2);
  r = await edit("SALES", [{ product_id: MAT, quantity: 1 }]);
  ok("cancelled order cannot be edited", /Only pending orders/.test(r.error ?? ""));
  const statusLog = (await as("OWNER", "select * from public.get_admin_order_changes($1)", [orderId])).rows.filter((x) => x.change_type === "STATUS_CHANGED");
  ok("status change kept in history once", statusLog.length === 1 && statusLog[0].after.status === "CANCELLED");

  // Confirmed order: no edits, history kept.
  await run("NORMAL", "select public.add_to_cart($1, 1)", [MAT]);
  const order2 = (await run("NORMAL", "select public.create_order_from_cart() as id")).rows[0].id;
  await run("WAREHOUSE", "select public.update_admin_order_status($1, 'CONFIRMED')", [order2]);
  r = await as("OWNER", "select public.update_admin_order_items($1, $2::jsonb)", [order2, JSON.stringify([{ product_id: MAT, quantity: 2 }])]);
  ok("confirmed order cannot be edited", /Only pending orders/.test(r.error ?? ""));
  ok("confirmed order stays in admin list", (await as("OWNER", "select * from public.get_admin_orders()")).rows.some((x) => x.order_id === order2 && x.status === "CONFIRMED"));

  // Old customer-approval flow is off.
  for (const [who, sql] of [["OWNER", "select public.create_admin_order_revision($1)"], ["NORMAL", "select public.respond_to_order_revision($1, true)"], ["SALES", "select public.send_admin_order_revision($1)"]]) {
    r = await as(who, sql, [order2]);
    ok(`old revision function denied: ${sql.slice(14, 45)}`, /permission denied/.test(r.error ?? ""), JSON.stringify(r));
  }

  // Audit: one entry per save, no prices/secrets.
  const audit = (await c.query("select details from public.security_audit_log where action = 'order_items_updated' and target_id = $1", [orderId])).rows;
  ok("audit entry per save without prices", audit.length >= 5 && audit.every((a) => Object.keys(a.details).sort().join(",") === "change_id,changes"), JSON.stringify(audit[0]));

  await c.end();
} catch (error) {
  failures.push(`THROWN: ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
