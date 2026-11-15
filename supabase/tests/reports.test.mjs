// Sales reports (sales_reports migration; local Postgres only).
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

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
  const { c } = await createDatabase("reports_tests");
  c.on("error", () => {});
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'su@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'SU', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
    update public.customer_profiles set company_name = 'Alfa MMC' where id = '${U.NORMAL}';
    update public.customer_profiles set company_name = 'Beta MMC' where id = '${U.DEALER}';
    delete from public.order_items; delete from public.orders;
    update public.products set active = false;
  `);
  const mk = async (sku) => {
    const id = (await c.query("insert into public.products (sku, name, stock, active) values ($1, $1, 50, true) returning id", [sku])).rows[0].id;
    await c.query("insert into public.product_prices (product_id, normal_price) values ($1, 10)", [id]);
    return id;
  };
  const A = await mk("REP-A");
  const B = await mk("REP-B");
  const NEVER = await mk("REP-NEVER");

  // [customer, status, payment, type, created_at (UTC), [[product, qty, unit]]]
  const orders = [
    // October (Baku time)
    [U.NORMAL, "CONFIRMED", "PAID", "STANDARD", "2026-10-05T10:00:00Z", [[A, 2, 10], [B, 1, 30]]], // 50 sale, paid
    [U.DEALER, "CONFIRMED", "UNPAID", "STANDARD", "2026-10-10T10:00:00Z", [[A, 1, 10]]], // 10 sale
    [U.NORMAL, "PENDING", "UNPAID", "STANDARD", "2026-10-15T10:00:00Z", [[B, 3, 30]]], // 90 pending, not a sale
    [U.NORMAL, "CANCELLED", "UNPAID", "STANDARD", "2026-10-20T10:00:00Z", [[A, 100, 10]]], // never counted
    [U.DEALER, "PENDING", "PAID", "PREORDER", "2026-10-25T10:00:00Z", [[B, 2, 30]]], // 60 sale (paid pre-order)
    [U.DEALER, "PENDING", "CUSTOMER_REPORTED", "PREORDER", "2026-10-26T10:00:00Z", [[B, 1, 30]]], // 30 pending
    // 31 Oct 21:30 UTC = 1 Nov 01:30 in Baku -> November
    [U.NORMAL, "CONFIRMED", null, "STANDARD", "2026-10-31T21:30:00Z", [[A, 4, 10]]], // 40 sale (Nov)
    // 31 Oct 19:30 UTC = 31 Oct 23:30 in Baku -> October
    [U.NORMAL, "CONFIRMED", null, "STANDARD", "2026-10-31T19:30:00Z", [[A, 1, 10]]], // 10 sale (Oct)
    // December: an older pending order with no payment information at all
    [U.DEALER, "PENDING", null, "STANDARD", "2026-12-10T10:00:00Z", [[B, 1, 25]]], // 25 pending
  ];
  const ids = [];
  for (const [customer, status, payment, type, at, lines] of orders) {
    const total = lines.reduce((s, [, q, u]) => s + q * u, 0);
    const id = (await c.query(
      "insert into public.orders (customer_id, status, payment_status, order_type, total_amount, created_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [customer, status, payment, type, total, at]
    )).rows[0].id;
    ids.push(id);
    for (const [product, q, u] of lines) {
      await c.query(
        "insert into public.order_items (order_id, product_id, sku, quantity, unit_price, line_total) values ($1, $2, (select sku from public.products where id = $2), $3, $4, $5)",
        [id, product, q, u, q * u]
      );
    }
  }
  // Catalog price changes afterwards: reports must keep the saved prices.
  await c.query("update public.product_prices set normal_price = 999");

  const sessions = {};
  for (const [k, id] of Object.entries(U)) {
    sessions[k] = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  }
  async function as(who, sql, params = []) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[who], role: "authenticated", aal: "aal1", session_id: sessions[who] })]);
      await c.query("set local role authenticated");
      const r = await c.query(sql, params);
      await c.query("rollback");
      return { rows: r.rows };
    } catch (e) {
      await c.query("rollback");
      return { error: e.message };
    }
  }

  // ---- Who can see reports.
  const fns = [
    "select * from public.get_admin_report_summary('2026-10-01', '2026-10-31')",
    "select * from public.get_admin_report_monthly('2026-10-01', '2026-10-31')",
    "select * from public.get_admin_report_products('2026-10-01', '2026-10-31', 10)",
    "select * from public.get_admin_report_unsold_products('2026-10-01', '2026-10-31')",
    "select * from public.get_admin_report_customers('2026-10-01', '2026-10-31', 10)",
    "select * from public.get_admin_report_orders('2026-10-01', '2026-10-31')",
  ];
  for (const who of ["PM", "SUPPORT", "WAREHOUSE", "NORMAL", "DEALER"]) {
    for (const sql of fns) {
      const r = await as(who, sql);
      ok(`${who} denied: ${sql.slice(21, 60)}`, /Not authorized to view reports/.test(r.error ?? ""), JSON.stringify(r));
    }
  }
  for (const who of ["OWNER", "SALES"]) {
    for (const sql of fns) {
      const r = await as(who, sql);
      ok(`${who} allowed: ${sql.slice(21, 60)}`, !r.error, JSON.stringify(r));
    }
  }
  let r = await c.query("select * from public.get_admin_report_summary('2026-10-01', '2026-10-31')").catch((e) => ({ error: e.message }));
  ok("no user (anon / service without staff) denied", /Not authorized/.test(r.error ?? ""));
  r = await as("OWNER", "select private.report_period('2026-10-01', '2026-10-31')");
  ok("private helper not callable", Boolean(r.error));

  // ---- Period checks.
  r = await as("OWNER", "select * from public.get_admin_report_summary('2026-10-31', '2026-10-01')");
  ok("reversed period rejected", /Invalid report period/.test(r.error ?? ""));
  r = await as("OWNER", "select * from public.get_admin_report_summary(null, '2026-10-01')");
  ok("missing date rejected", /Invalid report period/.test(r.error ?? ""));
  r = await as("OWNER", "select * from public.get_admin_report_summary('2000-01-01', '2026-10-01')");
  ok("too long period rejected", /Invalid report period/.test(r.error ?? ""));

  // ---- October KPIs.
  r = await as("SALES", "select * from public.get_admin_report_summary('2026-10-01', '2026-10-31')");
  const oct = r.rows?.[0] ?? {};
  ok("order count excludes cancelled", Number(oct.order_count) === 6, JSON.stringify(oct));
  ok("confirmed count", Number(oct.confirmed_count) === 3);
  ok("sale count (confirmed or paid)", Number(oct.sale_count) === 4);
  ok("sales total uses saved prices", Number(oct.sales_total) === 130, JSON.stringify(oct));
  ok("average sale", Number(oct.average_order) === 32.5);
  ok("paid total", Number(oct.paid_total) === 110);
  ok("pending not yet sale", Number(oct.pending_count) === 2 && Number(oct.pending_total) === 120);
  ok("pre-orders counted", Number(oct.preorder_count) === 2);
  ok("cancelled shown separately", Number(oct.cancelled_count) === 1);

  // ---- Baku time boundary + monthly series.
  r = await as("OWNER", "select * from public.get_admin_report_summary('2026-11-01', '2026-11-30')");
  ok("order at 01:30 Baku on 1 Nov belongs to November", Number(r.rows?.[0]?.sales_total) === 40, JSON.stringify(r));
  r = await as("OWNER", "select * from public.get_admin_report_monthly('2026-09-01', '2026-12-31')");
  const months = r.rows ?? [];
  ok("monthly has every month", months.length === 4, JSON.stringify(months));
  ok("empty month is zero", Number(months[0]?.sales_total) === 0 && Number(months[0]?.order_count) === 0);
  ok("monthly October", Number(months[1]?.sales_total) === 130 && Number(months[1]?.paid_total) === 110);
  ok("monthly November", Number(months[2]?.sales_total) === 40);
  ok("month value is first day", String(months[1]?.month).includes("2026") && new Date(months[1].month).getDate() >= 1);

  // ---- Products / customers.
  r = await as("OWNER", "select * from public.get_admin_report_products('2026-10-01', '2026-11-30', 10)");
  const prod = r.rows ?? [];
  ok("top product by amount", prod[0]?.product_id === B && Number(prod[0]?.sales_total) === 90 && Number(prod[0]?.quantity) === 3, JSON.stringify(prod));
  ok("cancelled lines not in product sales", Number(prod.find((x) => x.product_id === A)?.quantity) === 8);
  r = await as("OWNER", "select * from public.get_admin_report_unsold_products('2026-10-01', '2026-11-30', 1, 20)");
  ok("unsold active products", r.rows?.length === 1 && r.rows[0].product_id === NEVER && Number(r.rows[0].total_count) === 1, JSON.stringify(r));
  r = await as("OWNER", "select * from public.get_admin_report_unsold_products('2026-12-01', '2026-12-31', 1, 2)");
  ok("unsold paged", r.rows?.length === 2 && Number(r.rows[0].total_count) === 3);
  r = await as("OWNER", "select * from public.get_admin_report_customers('2026-10-01', '2026-10-31', 10)");
  ok("top customers by sales", r.rows?.[0]?.company_name === "Beta MMC" && Number(r.rows[0].sales_total) === 70 && r.rows[1]?.company_name === "Alfa MMC" && Number(r.rows[1].sales_total) === 60, JSON.stringify(r));
  r = await as("OWNER", "select * from public.get_admin_report_orders('2026-10-01', '2026-10-31')");
  ok("orders for Excel exclude cancelled", r.rows?.length === 6 && !r.rows.some((x) => x.status === "CANCELLED"));
  ok("orders for Excel mark sales", r.rows?.filter((x) => x.is_sale).length === 4);
  ok("orders for Excel: is_sale is never empty", r.rows?.every((x) => typeof x.is_sale === "boolean"));

  // ---- Pending order without any payment information (older orders).
  r = await as("OWNER", "select * from public.get_admin_report_summary('2026-12-01', '2026-12-31')");
  const dec = r.rows?.[0] ?? {};
  ok("pending order without payment info is pending", Number(dec.pending_count) === 1 && Number(dec.pending_total) === 25, JSON.stringify(dec));
  ok("pending order without payment info is not a sale", Number(dec.sale_count) === 0 && Number(dec.sales_total) === 0);
  r = await as("OWNER", "select * from public.get_admin_report_orders('2026-12-01', '2026-12-31')");
  ok("Excel: pending order without payment info is_sale = false", r.rows?.length === 1 && r.rows[0].is_sale === false, JSON.stringify(r));

  // ---- Nothing was changed by reading.
  const after = (await c.query("select count(*)::int n, sum(total_amount)::numeric s from public.orders")).rows[0];
  ok("reports change no data", after.n === 9 && Number(after.s) === 50 + 10 + 90 + 1000 + 60 + 30 + 40 + 10 + 25);

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
