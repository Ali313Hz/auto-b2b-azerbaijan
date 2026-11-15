// Payment status, order contact details and customer activity
// (payment_status_and_customer_activity migration; local Postgres only).
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const MIGRATION = "20261115110000_payment_status_and_customer_activity.sql";
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
  const { c } = await createDatabase("payment_activity_tests", { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'su@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'SU', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
    update public.customer_profiles set phone = '+994 50 111 22 33', created_at = '2026-09-01T10:00:00Z' where id = '${U.NORMAL}';
    update auth.users set last_sign_in_at = '2026-11-14T08:30:00Z' where id = '${U.NORMAL}';
  `);
  const product = (await c.query(`
    insert into public.products (sku, name, stock, active) values ('PAY-1', 'Lampa', 100, true) returning id`)).rows[0].id;
  await c.query("insert into public.product_prices (product_id, normal_price) values ($1, 10)", [product]);

  // Orders that already exist before the migration (hand-made data).
  const legacy = {};
  for (const [key, status, total, day] of [
    ["pending", "PENDING", 20, "2026-10-01"],
    ["confirmed", "CONFIRMED", 30, "2026-10-05"],
    ["cancelled", "CANCELLED", 40, "2026-10-07"],
  ]) {
    legacy[key] = (await c.query(
      "insert into public.orders (customer_id, status, total_amount, created_at) values ($1, $2, $3, $4) returning id",
      [U.NORMAL, status, total, `${day}T12:00:00Z`]
    )).rows[0].id;
    await c.query(
      "insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total) values ($1, $2, 'PAY-1', $3, 10, $4)",
      [legacy[key], product, total / 10, total]
    );
  }
  const dealerOrder = (await c.query(
    "insert into public.orders (customer_id, status, total_amount) values ($1, 'PENDING', 10) returning id",
    [U.DEALER]
  )).rows[0].id;
  const snapshot = async () =>
    (await c.query("select id, customer_id, status, total_amount, created_at from public.orders order by id")).rows;
  const itemsBefore = (await c.query("select * from public.order_items order by id")).rows;
  const ordersBefore = await snapshot();

  for (const file of migrationFiles().filter((f) => f > before)) {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    await c.query("commit");
  }

  ok("orders unchanged by the migration", JSON.stringify(await snapshot()) === JSON.stringify(ordersBefore));
  ok("order items unchanged", JSON.stringify((await c.query("select * from public.order_items order by id")).rows) === JSON.stringify(itemsBefore));
  const legacyPayments = (await c.query("select payment_status from public.orders")).rows;
  ok("existing orders are not marked unpaid (NULL = not recorded)", legacyPayments.every((r) => r.payment_status === null));

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
  const pay = async (id) => (await c.query("select payment_status, payment_reported_at, payment_confirmed_at, payment_confirmed_by, updated_at from public.orders where id = $1", [id])).rows[0];
  const auditCount = async (action, id) =>
    (await c.query("select count(*)::int n from public.security_audit_log where action = $1 and target_id = $2", [action, id])).rows[0].n;

  // ---- New order starts UNPAID.
  let r = await run("NORMAL", "select public.add_to_cart($1, 2)", [product]);
  r = await run("NORMAL", "select public.create_order_from_cart() as id");
  const fresh = r.rows?.[0]?.id;
  ok("new order created", Boolean(fresh), JSON.stringify(r));
  ok("new order is UNPAID", (await pay(fresh)).payment_status === "UNPAID");

  // ---- Customer reports payment.
  const updatedBefore = (await pay(fresh)).updated_at;
  r = await run("NORMAL", "select public.report_order_payment($1) as s", [fresh]);
  ok("customer reports own order", r.rows?.[0]?.s === "CUSTOMER_REPORTED", JSON.stringify(r));
  const reported = await pay(fresh);
  ok("reported time stored", reported.payment_reported_at !== null);
  ok("payment change does not touch updated_at (no edit conflicts)", String(reported.updated_at) === String(updatedBefore));
  r = await run("NORMAL", "select public.report_order_payment($1) as s", [fresh]);
  ok("second press is safe (same status)", r.rows?.[0]?.s === "CUSTOMER_REPORTED");
  ok("second press not audited twice", (await auditCount("payment_reported", fresh)) === 1);
  ok("reported time not moved by second press", String((await pay(fresh)).payment_reported_at) === String(reported.payment_reported_at));

  r = await as("NORMAL", "select public.report_order_payment($1)", [dealerOrder]);
  ok("cannot report another customer's order", /Order not found/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("NORMAL", "select public.report_order_payment($1)", [legacy.cancelled]);
  ok("cannot report a cancelled order", /Order is cancelled/.test(r.error ?? ""));
  r = await run("NORMAL", "select public.report_order_payment($1) as s", [legacy.confirmed]);
  ok("older confirmed order can be reported", r.rows?.[0]?.s === "CUSTOMER_REPORTED");
  r = await as("NORMAL", "select public.set_admin_order_payment($1, true)", [fresh]);
  ok("customer cannot confirm own payment", /Not authorized/.test(r.error ?? ""));
  r = await as("NORMAL", "update public.orders set payment_status = 'PAID' where id = $1", [fresh]);
  ok("customer cannot write orders directly", Boolean(r.error));
  r = await as("SALES", "select public.report_order_payment($1)", [fresh]);
  ok("staff cannot use the customer report", /Active customer profile required/.test(r.error ?? ""));
  await c.query("update public.customer_profiles set active = false where id = $1", [U.DEALER]);
  r = await as("DEALER", "select public.report_order_payment($1)", [dealerOrder]);
  ok("inactive customer cannot report", /Active customer profile required/.test(r.error ?? ""));
  await c.query("update public.customer_profiles set active = true where id = $1", [U.DEALER]);

  // ---- Staff decisions.
  for (const who of ["SUPPORT", "WAREHOUSE", "PM"]) {
    r = await as(who, "select public.set_admin_order_payment($1, true)", [fresh]);
    ok(`${who} cannot confirm payment`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  r = await run("SALES", "select public.set_admin_order_payment($1, true) as s", [fresh]);
  ok("SALES confirms payment", r.rows?.[0]?.s === "PAID", JSON.stringify(r));
  const paid = await pay(fresh);
  ok("confirmed time and person stored", paid.payment_confirmed_at !== null && paid.payment_confirmed_by === U.SALES);
  ok("payment_confirmed audited", (await auditCount("payment_confirmed", fresh)) === 1);
  r = await run("OWNER", "select public.set_admin_order_payment($1, true) as s", [fresh]);
  ok("confirming twice is safe", r.rows?.[0]?.s === "PAID" && (await auditCount("payment_confirmed", fresh)) === 1);
  r = await as("OWNER", "select public.set_admin_order_payment($1, false)", [fresh]);
  ok("paid order cannot be rejected", /Payment already confirmed/.test(r.error ?? ""));
  r = await run("NORMAL", "select public.report_order_payment($1) as s", [fresh]);
  ok("report after PAID keeps PAID", r.rows?.[0]?.s === "PAID" && (await pay(fresh)).payment_status === "PAID");

  r = await run("OWNER", "select public.set_admin_order_payment($1, false) as s", [legacy.confirmed]);
  ok("OWNER rejects a reported payment", r.rows?.[0]?.s === "REJECTED", JSON.stringify(r));
  ok("payment_rejected audited", (await auditCount("payment_rejected", legacy.confirmed)) === 1);
  ok("rejected has no confirmation data", (await pay(legacy.confirmed)).payment_confirmed_at === null);
  r = await run("NORMAL", "select public.report_order_payment($1) as s", [legacy.confirmed]);
  ok("customer can report again after rejection", r.rows?.[0]?.s === "CUSTOMER_REPORTED");
  r = await as("OWNER", "select public.set_admin_order_payment($1, false)", [legacy.pending]);
  ok("cannot reject when nothing was reported", /No payment report to reject/.test(r.error ?? ""));
  r = await run("SALES", "select public.set_admin_order_payment($1, true) as s", [legacy.pending]);
  ok("staff can confirm a payment that was never reported (cash)", r.rows?.[0]?.s === "PAID");
  r = await as("OWNER", "select public.set_admin_order_payment($1, true)", [legacy.cancelled]);
  ok("cancelled order payment cannot be confirmed", /Order is cancelled/.test(r.error ?? ""));
  r = await as("OWNER", "select public.set_admin_order_payment($1, null)", [legacy.confirmed]);
  ok("missing decision rejected", /Invalid payment decision/.test(r.error ?? ""));
  ok("order statuses never changed by payments", (await c.query("select status from public.orders where id = $1", [legacy.pending])).rows[0].status === "PENDING");

  // ---- Admin order list and detail.
  const page = async (who, args = "") => as(who, `select * from public.get_admin_orders_page(1, 50${args})`);
  r = await page("SALES");
  const row = r.rows?.find((x) => x.order_id === fresh);
  ok("SALES sees phone and email in the list", row?.phone === "+994 50 111 22 33" && row?.email === "normal@test.local", JSON.stringify(row));
  ok("list has payment status and total count", row?.payment_status === "PAID" && Number(row?.total_count) === 5);
  r = await page("WAREHOUSE");
  ok("WAREHOUSE sees no phone", r.rows?.every((x) => x.phone === null));
  r = await page("SUPPORT");
  ok("SUPPORT sees phone (read-only)", r.rows?.some((x) => x.phone === "+994 50 111 22 33"));
  r = await page("PM");
  ok("PRODUCT_MANAGER cannot list orders", /Not authorized/.test(r.error ?? ""));
  r = await page("NORMAL");
  ok("customer cannot list admin orders", /Not authorized/.test(r.error ?? ""));
  r = await page("OWNER", ", null, 'CUSTOMER_REPORTED'");
  ok("filter: payment reported", r.rows?.length === 1 && r.rows[0].order_id === legacy.confirmed, JSON.stringify(r.rows?.map((x) => x.order_id)));
  r = await page("OWNER", ", null, 'UNKNOWN'");
  ok("filter: not recorded (older orders)", r.rows?.length === 2 && r.rows.every((x) => x.payment_status === null));
  r = await page("OWNER", ", 'CANCELLED'");
  ok("filter: status", r.rows?.length === 1 && r.rows[0].order_id === legacy.cancelled);
  r = await page("OWNER", ", null, null, '111 22'");
  ok("search by phone", r.rows?.length === 4);
  r = await page("WAREHOUSE", ", null, null, '111 22'");
  ok("WAREHOUSE cannot search by phone", r.rows?.length === 0);
  r = await page("OWNER", `, null, null, '#${fresh.slice(0, 8).toUpperCase()}'`);
  ok("search by order number", r.rows?.length === 1 && r.rows[0].order_id === fresh);
  r = await as("OWNER", "select * from public.get_admin_orders_page(2, 2)");
  ok("paging", r.rows?.length === 2 && Number(r.rows[0].total_count) === 5);
  r = await as("SALES", "select * from public.get_admin_order_counts()");
  ok("tab counts", Number(r.rows?.[0]?.total) === 5 && Number(r.rows?.[0]?.payment_reported) === 1 && Number(r.rows?.[0]?.paid) === 2, JSON.stringify(r.rows));
  r = await as("OWNER", "select * from public.get_admin_order($1)", [fresh]);
  ok("detail: confirmed-by name and contact", r.rows?.[0]?.payment_confirmed_by_name === "Sales" && r.rows[0].phone === "+994 50 111 22 33" && r.rows[0].contact_name === "N", JSON.stringify(r.rows));
  r = await as("WAREHOUSE", "select phone from public.get_admin_order($1)", [fresh]);
  ok("detail: WAREHOUSE no phone", r.rows?.[0]?.phone === null);
  r = await as("NORMAL", "select * from public.get_admin_order($1)", [fresh]);
  ok("detail: customer denied", /Not authorized/.test(r.error ?? ""));
  r = await as("NORMAL", "select * from public.get_customer_orders()");
  ok("customer list has own orders with payment status", r.rows?.length === 4 && r.rows.every((x) => "payment_status" in x));
  r = await as("SALES", "select payment_reported_orders from public.get_admin_dashboard_stats()");
  ok("dashboard counts reported payments", Number(r.rows?.[0]?.payment_reported_orders) === 1);

  // ---- Customer activity.
  r = await as("SALES", "select * from public.get_admin_customer_activity($1)", [U.NORMAL]);
  const act = r.rows?.[0];
  ok("registered date = profile created_at", act && new Date(act.registered_at).toISOString() === "2026-09-01T10:00:00.000Z", JSON.stringify(act));
  ok("last login from Auth", act && new Date(act.last_sign_in_at).toISOString() === "2026-11-14T08:30:00.000Z");
  const lastOrder = (await c.query("select max(created_at) m from public.orders where customer_id = $1", [U.NORMAL])).rows[0].m;
  ok("last order date", act && new Date(act.last_order_at).getTime() === new Date(lastOrder).getTime());
  ok("order counts", Number(act?.order_count) === 4 && Number(act?.confirmed_order_count) === 1);
  ok("purchase total = confirmed orders only (cancelled/pending excluded)", Number(act?.purchase_total) === 30, String(act?.purchase_total));
  ok("paid total = confirmed payments", Number(act?.paid_total) === 40, String(act?.paid_total));
  ok("phone, email, status", act?.phone === "+994 50 111 22 33" && act?.email === "normal@test.local" && act?.active === true);
  r = await as("SUPPORT", "select * from public.get_admin_customer_activity($1)", [U.NORMAL]);
  ok("SUPPORT can view activity", !r.error && r.rows.length === 1);
  for (const who of ["WAREHOUSE", "PM", "NORMAL", "DEALER"]) {
    r = await as(who, "select * from public.get_admin_customer_activity($1)", [U.NORMAL]);
    ok(`${who} cannot view activity`, /Not authorized/.test(r.error ?? ""));
    r = await as(who, "select * from public.get_admin_customer_orders($1)", [U.NORMAL]);
    ok(`${who} cannot view customer orders`, /Not authorized/.test(r.error ?? ""));
  }
  r = await as("OWNER", "select * from public.get_admin_customer_orders($1, 2)", [U.NORMAL]);
  ok("latest orders, newest first, limited", r.rows?.length === 2 && r.rows[0].order_id === fresh, JSON.stringify(r.rows));
  r = await as("NORMAL", "update auth.users set last_sign_in_at = now() where id = $1", [U.NORMAL]);
  ok("customer cannot set own last login", Boolean(r.error));
  r = await as("OWNER", "select * from public.get_admin_customer_activity($1)", [U.DEALER]);
  ok("customer without orders: zeros", Number(r.rows?.[0]?.order_count) === 1 && Number(r.rows?.[0]?.purchase_total) === 0);

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
