// Order revision / stock / security tests (local Postgres only).
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  PM: "00000000-0000-4000-8000-000000000042",
  SUPPORT: "00000000-0000-4000-8000-000000000043",
  WAREHOUSE: "00000000-0000-4000-8000-000000000044",
  DEALER: IDS.dealer,
  OTHER: IDS.normal,
};

try {
  const { c } = await createDatabase("revision_tests");
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'sup@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'Sup', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
  `);
  const cat = (await c.query("insert into public.categories (name, slug, sort_order, active) values ('A','a',0,true) returning id")).rows[0].id;
  const mk = async (sku, name, stock, prices) => {
    const id = (await c.query(`insert into public.products (sku, name, stock, active, category_id) values ($1, $2, $3, true, $4) returning id`, [sku, name, stock, cat])).rows[0].id;
    await c.query(`insert into public.product_prices (product_id, normal_price, dealer_price, vip_price) values ($1, $2, $3, $4)`, [id, ...prices]);
    return id;
  };
  const H7 = await mk("LED-H7-001", "H7 LED", 10, [50, 45, 40]);
  const H4 = await mk("LED-H4-001", "H4 LED", 5, [30, 25, 20]);
  const MAT = await mk("MAT-001", "Ayaqaltı", 3, [20, 18, 15]);

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
  const prices = async () => (await c.query("select string_agg(product_id||':'||normal_price||'/'||dealer_price||'/'||vip_price, ',' order by product_id) s from public.product_prices")).rows[0].s;
  const pricesBefore = await prices();

  // Dealer orders 2 × H7 (45) = 90.
  await run("DEALER", `select public.add_to_cart($1, 2)`, [H7]);
  const orderId = (await run("DEALER", "select public.create_order_from_cart() as id")).rows[0].id;
  ok("order created", !!orderId);
  ok("order reserves stock", (await stock(H7)) === 8);
  const order = async () => (await c.query("select * from public.orders where id = $1", [orderId])).rows[0];
  ok("order total 90", Number((await order()).total_amount) === 90);

  // ---- Roles: who can open a revision.
  for (const who of ["SUPPORT", "WAREHOUSE", "PM", "DEALER", "OTHER"]) {
    const r = await as(who, "select public.create_admin_order_revision($1) as id", [orderId]);
    ok(`${who} cannot create revision`, !!r.error, JSON.stringify(r));
  }
  ok("SALES can create revision (rolled back)", !(await as("SALES", "select public.create_admin_order_revision($1) as id", [orderId])).error);

  // ---- OWNER creates draft v2.
  const rev2 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  const revs = async () => (await c.query("select * from public.order_revisions where order_id = $1 order by version", [orderId])).rows;
  let all = await revs();
  ok("v1 original snapshot created", all.length === 2 && all[0].version === 1 && all[0].status === "ACCEPTED" && Number(all[0].total_amount) === 90, JSON.stringify(all.map((r) => [r.version, r.status])));
  ok("v2 draft", all[1].version === 2 && all[1].status === "DRAFT");
  const v1items = (await c.query("select * from public.order_revision_items where revision_id = $1", [all[0].id])).rows;
  ok("v1 snapshot has name+sku+qty+price", v1items.length === 1 && v1items[0].product_name === "H7 LED" && v1items[0].sku === "LED-H7-001" && v1items[0].quantity === 2 && Number(v1items[0].unit_price) === 45);
  const again = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  ok("create again returns same draft", again === rev2);

  // ---- Customer cannot see drafts; other customer sees nothing.
  const dv = await as("DEALER", "select * from public.get_customer_order_revisions($1)", [orderId]);
  ok("customer does not see draft", dv.rows && dv.rows.every((r) => r.status !== "DRAFT") && dv.rows.length === 1, JSON.stringify(dv));
  const ov = await as("OTHER", "select * from public.get_customer_order_revisions($1)", [orderId]);
  ok("other customer sees no revisions", ov.rows && ov.rows.length === 0, JSON.stringify(ov));

  // ---- Save: quantity 2→1, price 45→42 (override), client total ignored.
  const save = (who, rid, items, note = null) => run(who, "select public.save_admin_order_revision($1, $2::jsonb, $3) as total", [rid, JSON.stringify(items), note]);
  for (const who of ["SUPPORT", "WAREHOUSE", "PM", "DEALER"]) {
    const r = await as(who, "select public.save_admin_order_revision($1, $2::jsonb, null)", [rev2, JSON.stringify([{ product_id: H7, quantity: 1, unit_price: 1 }])]);
    ok(`${who} cannot save revision / change price`, !!r.error, JSON.stringify(r));
  }
  let s = await save("SALES", rev2, [{ product_id: H7, quantity: 1, unit_price: 42, line_total: 0.01, total: 0.01 }], "Stokda 1 ədəd qalıb");
  ok("SALES saves draft, total from DB", !s.error && Number(s.rows[0].total) === 42, JSON.stringify(s));
  ok("draft does not change stock", (await stock(H7)) === 8);
  ok("catalog prices unchanged after override", (await prices()) === pricesBefore);
  // Invalid input.
  for (const [name, items] of [
    ["quantity 0", [{ product_id: H7, quantity: 0 }]],
    ["negative quantity", [{ product_id: H7, quantity: -3 }]],
    ["fractional quantity", [{ product_id: H7, quantity: 1.5 }]],
    ["negative price", [{ product_id: H7, quantity: 1, unit_price: -1 }]],
    ["unknown product", [{ product_id: "00000000-0000-4000-8000-0000000000ff", quantity: 1 }]],
    ["duplicate product", [{ product_id: H7, quantity: 1 }, { product_id: H7, quantity: 2 }]],
    ["not an array", { product_id: H7 }],
  ]) {
    const r = await as("OWNER", "select public.save_admin_order_revision($1, $2::jsonb, null)", [rev2, JSON.stringify(items)]);
    ok(`invalid ${name} refused`, !!r.error, JSON.stringify(r));
  }
  // Default price = catalog price of the customer's group (DEALER 25 for H4).
  s = await save("OWNER", rev2, [{ product_id: H7, quantity: 1, unit_price: 42 }, { product_id: H4, quantity: 1 }], "Stokda 1 ədəd qalıb");
  ok("added product uses dealer catalog price", !s.error && Number(s.rows[0].total) === 67, JSON.stringify(s));
  s = await save("OWNER", rev2, [{ product_id: H7, quantity: 1, unit_price: "42.004" }], "Stokda 1 ədəd qalıb");
  ok("price rounded to 2 decimals, total 42", !s.error && Number(s.rows[0].total) === 42, JSON.stringify(s));

  // ---- Send.
  for (const who of ["SUPPORT", "WAREHOUSE", "PM", "DEALER"]) {
    ok(`${who} cannot send`, !!(await as(who, "select public.send_admin_order_revision($1)", [rev2])).error);
  }
  ok("send ok", !(await run("SALES", "select public.send_admin_order_revision($1)", [rev2])).error);
  ok("send does not change stock", (await stock(H7)) === 8);
  ok("sent revision not editable", !!(await as("OWNER", "select public.save_admin_order_revision($1, '[]'::jsonb, null)", [rev2])).error);
  const alerts = await as("DEALER", "select * from public.get_customer_order_alerts()");
  ok("customer gets alert", alerts.rows?.length === 1 && alerts.rows[0].revision_id === rev2, JSON.stringify(alerts));
  ok("other customer no alert", (await as("OTHER", "select * from public.get_customer_order_alerts()")).rows?.length === 0);
  const cv = await as("DEALER", "select * from public.get_customer_order_revisions($1)", [orderId]);
  ok("customer sees v2 with items + note", cv.rows?.[0]?.version === 2 && cv.rows[0].note === "Stokda 1 ədəd qalıb" && cv.rows[0].items.length === 1, JSON.stringify(cv));

  // ---- Resend keeps the same revision.
  const before = (await revs()).length;
  ok("resend ok", !(await run("SALES", "select public.resend_admin_order_revision($1)", [rev2])).error);
  all = await revs();
  ok("resend creates no revision, deletes nothing", all.length === before && all.find((r) => r.id === rev2).sent_count === 2);
  ok("SUPPORT cannot resend", !!(await as("SUPPORT", "select public.resend_admin_order_revision($1)", [rev2])).error);

  // ---- Other customer cannot answer; staff cannot answer as customer.
  ok("other customer cannot accept", !!(await as("OTHER", "select public.respond_to_order_revision($1, true)", [rev2])).error);
  ok("staff cannot accept", !!(await as("OWNER", "select public.respond_to_order_revision($1, true)", [rev2])).error);

  // ---- Accept (decrease 2→1, price 42): +1 back to stock, once.
  const a1 = await run("DEALER", "select public.respond_to_order_revision($1, true) as s", [rev2]);
  ok("accept ok", a1.rows?.[0]?.s === "ACCEPTED", JSON.stringify(a1));
  ok("decrease returns 1 to stock", (await stock(H7)) === 9, String(await stock(H7)));
  const o2 = await order();
  ok("order confirmed, total 42 from DB", o2.status === "CONFIRMED" && Number(o2.total_amount) === 42);
  const items2 = (await c.query("select * from public.order_items where order_id = $1", [orderId])).rows;
  ok("order items replaced with accepted revision", items2.length === 1 && items2[0].quantity === 1 && Number(items2[0].unit_price) === 42);
  const a2 = await run("DEALER", "select public.respond_to_order_revision($1, true) as s", [rev2]);
  ok("second accept is a no-op", a2.rows?.[0]?.s === "ACCEPTED" && (await stock(H7)) === 9, JSON.stringify(a2));
  ok("reject after accept refused", !!(await as("DEALER", "select public.respond_to_order_revision($1, false)", [rev2])).error);
  ok("catalog prices still unchanged", (await prices()) === pricesBefore);

  // ---- Confirmed order can be revised again (v3): increase H7 1→4, add H4 2, remove nothing.
  const rev3 = (await run("SALES", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  all = await revs();
  ok("confirmed order revisable (v3 draft)", all.find((r) => r.id === rev3)?.version === 3);
  ok("v3 starts from accepted items", (await c.query("select quantity from public.order_revision_items where revision_id = $1", [rev3])).rows[0]?.quantity === 1);
  await save("SALES", rev3, [{ product_id: H7, quantity: 4, unit_price: 42 }, { product_id: H4, quantity: 2 }]);
  await run("SALES", "select public.send_admin_order_revision($1)", [rev3]);
  // Make stock insufficient for H4 (needs 2, set 1) → accept fails, nothing changes.
  await c.query("update public.products set stock = 1 where id = $1", [H4]);
  const h7Before = await stock(H7);
  const fail = await run("DEALER", "select public.respond_to_order_revision($1, true)", [rev3]);
  ok("insufficient stock refuses accept", /Insufficient stock for LED-H4-001/.test(fail.error ?? ""), JSON.stringify(fail));
  ok("failed accept changes no stock", (await stock(H7)) === h7Before && (await stock(H4)) === 1);
  ok("failed accept leaves revision open", (await revs()).find((r) => r.id === rev3).status === "AWAITING_CUSTOMER");
  await c.query("update public.products set stock = 5 where id = $1", [H4]);
  const a3 = await run("DEALER", "select public.respond_to_order_revision($1, true) as s", [rev3]);
  ok("accept v3 ok", a3.rows?.[0]?.s === "ACCEPTED", JSON.stringify(a3));
  ok("increase takes +3 from stock (9→6)", (await stock(H7)) === 6, String(await stock(H7)));
  ok("added product takes 2 (5→3)", (await stock(H4)) === 3, String(await stock(H4)));
  ok("order total 4×42 + 2×25 = 218", Number((await order()).total_amount) === 218);

  // ---- v4: remove H4, price-only change on H7 (42 → 40). Removed returns stock, price-only no stock.
  const rev4 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  await save("OWNER", rev4, [{ product_id: H7, quantity: 4, unit_price: 40 }]);
  await run("OWNER", "select public.send_admin_order_revision($1)", [rev4]);
  // Reject first: nothing changes.
  const rj = await run("DEALER", "select public.respond_to_order_revision($1, false) as s", [rev4]);
  ok("reject ok", rj.rows?.[0]?.s === "REJECTED");
  ok("reject changes no stock", (await stock(H7)) === 6 && (await stock(H4)) === 3);
  ok("reject keeps order", Number((await order()).total_amount) === 218 && (await order()).status === "CONFIRMED");
  ok("accept after reject refused", !!(await as("DEALER", "select public.respond_to_order_revision($1, true)", [rev4])).error);
  const rev5 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  await save("OWNER", rev5, [{ product_id: H7, quantity: 4, unit_price: 40 }]);
  await run("OWNER", "select public.send_admin_order_revision($1)", [rev5]);
  await run("DEALER", "select public.respond_to_order_revision($1, true)", [rev5]);
  ok("removed product returned to stock (3→5)", (await stock(H4)) === 5, String(await stock(H4)));
  ok("price-only change keeps stock (6)", (await stock(H7)) === 6, String(await stock(H7)));
  ok("total 160", Number((await order()).total_amount) === 160);

  // ---- New draft while one is awaiting → old one SUPERSEDED, kept.
  const rev6 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  await save("OWNER", rev6, [{ product_id: H7, quantity: 3, unit_price: 40 }]);
  await run("OWNER", "select public.send_admin_order_revision($1)", [rev6]);
  const rev7 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [orderId])).rows[0].id;
  all = await revs();
  ok("awaiting revision superseded by new draft", all.find((r) => r.id === rev6).status === "SUPERSEDED" && all.find((r) => r.id === rev7).status === "DRAFT");
  ok("superseded cannot be accepted", !!(await as("DEALER", "select public.respond_to_order_revision($1, true)", [rev6])).error);
  ok("discard draft ok", !(await run("OWNER", "select public.discard_admin_order_revision($1)", [rev7])).error);
  all = await revs();
  ok("history keeps every version 1..7", all.map((r) => r.version).join(",") === "1,2,3,4,5,6,7", all.map((r) => r.version).join(","));
  ok("v2 snapshot unchanged in history", (await c.query("select quantity, unit_price from public.order_revision_items where revision_id = $1", [rev2])).rows.map((r) => `${r.quantity}@${r.unit_price}`).join() === "1@42.00");

  // ---- Product changes later do not change history.
  await c.query("update public.products set name = 'Renamed', sku = 'LED-H7-NEW' where id = $1", [H7]);
  const hist = (await c.query("select product_name, sku from public.order_revision_items where revision_id = $1", [rev2])).rows[0];
  ok("history keeps old name/sku", hist.product_name === "H7 LED" && hist.sku === "LED-H7-001");
  await c.query("update public.products set name = 'H7 LED', sku = 'LED-H7-001' where id = $1", [H7]);

  // ---- Revisions cannot be deleted or edited directly.
  for (const who of ["DEALER", "OWNER", "SALES"]) {
    ok(`${who} cannot delete revisions directly`, !!(await as(who, "delete from public.order_revisions")).error);
    ok(`${who} cannot read revision table directly`, !!(await as(who, "select * from public.order_revision_items")).error);
  }

  // ---- Staff read access.
  for (const [who, allowed] of [["OWNER", 1], ["SALES", 1], ["SUPPORT", 1], ["WAREHOUSE", 1], ["PM", 0], ["DEALER", 0]]) {
    const r = await as(who, "select * from public.get_admin_order_revisions($1)", [orderId]);
    ok(`${who} ${allowed ? "can" : "cannot"} read revision history`, allowed ? !r.error && r.rows.length === 7 : !!r.error);
    const l = await as(who, "select * from public.get_admin_order_lines($1)", [orderId]);
    ok(`${who} order lines ${allowed ? "ok" : "denied"}`, allowed ? !l.error : !!l.error);
  }
  for (const [who, allowed] of [["OWNER", 1], ["SALES", 1], ["SUPPORT", 0], ["WAREHOUSE", 0], ["PM", 0], ["DEALER", 0]]) {
    const r = await as(who, "select * from public.search_admin_order_products($1, 'LED')", [orderId]);
    ok(`${who} ${allowed ? "can" : "cannot"} search products with prices`, allowed ? !r.error && r.rows.length >= 2 && r.rows.length <= 20 && Number(r.rows.find((x) => x.sku === "LED-H4-001").catalog_price) === 25 : !!r.error, JSON.stringify(r?.rows?.map((x) => x.sku) ?? r));
  }

  // ---- Pending order: open revision withdrawn on confirm; cancel returns accepted quantities once.
  await run("DEALER", `select public.add_to_cart($1, 2)`, [MAT]);
  const order2 = (await run("DEALER", "select public.create_order_from_cart() as id")).rows[0].id;
  ok("MAT reserved (3→1)", (await stock(MAT)) === 1);
  const r21 = (await run("SALES", "select public.create_admin_order_revision($1) as id", [order2])).rows[0].id;
  await save("SALES", r21, [{ product_id: MAT, quantity: 1 }]);
  await run("SALES", "select public.send_admin_order_revision($1)", [r21]);
  await run("DEALER", "select public.respond_to_order_revision($1, true)", [r21]);
  ok("MAT 2→1 returns 1 (1→2)", (await stock(MAT)) === 2);
  // A third order to test cancel after an accepted revision is not possible (accept confirms);
  // test cancel on a pending order with an awaiting revision instead.
  await run("DEALER", `select public.add_to_cart($1, 2)`, [MAT]);
  const order3 = (await run("DEALER", "select public.create_order_from_cart() as id")).rows[0].id;
  ok("MAT reserved again (2→0)", (await stock(MAT)) === 0);
  const r31 = (await run("SALES", "select public.create_admin_order_revision($1) as id", [order3])).rows[0].id;
  await save("SALES", r31, [{ product_id: MAT, quantity: 1 }]);
  await run("SALES", "select public.send_admin_order_revision($1)", [r31]);
  ok("cancel by SALES ok", !(await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED')", [order3])).error);
  ok("cancel returns accepted quantity once (0→2)", (await stock(MAT)) === 2);
  ok("second cancel no double stock", !(await run("SALES", "select public.update_admin_order_status($1, 'CANCELLED')", [order3])).error && (await stock(MAT)) === 2);
  ok("open revision withdrawn on cancel", (await c.query("select status from public.order_revisions where id = $1", [r31])).rows[0].status === "SUPERSEDED");
  ok("customer cannot accept after cancel", !!(await as("DEALER", "select public.respond_to_order_revision($1, true)", [r31])).error && (await stock(MAT)) === 2);
  ok("cancelled order cannot be revised", /Cancelled/.test((await as("OWNER", "select public.create_admin_order_revision($1)", [order3])).error ?? ""));
  ok("cancelled order history kept", (await c.query("select count(*)::int n from public.order_revisions where order_id = $1", [order3])).rows[0].n === 2);
  ok("no alert for cancelled order", !(await as("DEALER", "select * from public.get_customer_order_alerts()")).rows.some((r) => r.order_id === order3));

  // ---- Customer cannot set prices: create_order_from_cart ignores client prices (only quantity), add_to_cart validates quantity.
  ok("add_to_cart rejects 0", !!(await as("DEALER", `select public.add_to_cart($1, 0)`, [H7])).error);
  ok("add_to_cart rejects huge", !!(await as("DEALER", `select public.add_to_cart($1, 1000000)`, [H7])).error);

  // ---- Audit entries, no secrets.
  const audit = (await c.query("select action, count(*)::int n from public.security_audit_log where action like 'order_revision_%' group by action order by action")).rows;
  const names = audit.map((a) => a.action);
  for (const a of ["order_revision_created", "order_revision_updated", "order_revision_sent", "order_revision_accepted", "order_revision_rejected", "order_revision_resent"]) {
    ok(`audit ${a}`, names.includes(a), names.join());
  }
  const auditText = (await c.query("select string_agg(coalesce(details::text, ''), ' ') t from public.security_audit_log where action like 'order_revision_%'")).rows[0].t;
  ok("audit has no password/secret/token", !/password|secret|token/i.test(auditText));

  // ---- Concurrency: two sessions accept the same revision at once → stock changes once.
  const order4 = await (async () => {
    await run("DEALER", `select public.add_to_cart($1, 1)`, [H4]);
    return (await run("DEALER", "select public.create_order_from_cart() as id")).rows[0].id;
  })();
  const r41 = (await run("OWNER", "select public.create_admin_order_revision($1) as id", [order4])).rows[0].id;
  await save("OWNER", r41, [{ product_id: H4, quantity: 3 }]);
  await run("OWNER", "select public.send_admin_order_revision($1)", [r41]);
  const h4b = await stock(H4);
  const { default: pg } = await import("pg");
  const mkClient = async () => { const cl = new pg.Client(c.connectionParameters); await cl.connect(); return cl; };
  const c1 = await mkClient(), c2 = await mkClient();
  const claims = JSON.stringify({ sub: U.DEALER, role: "authenticated", aal: "aal1", session_id: sessions.DEALER });
  for (const cl of [c1, c2]) {
    await cl.query("begin");
    await cl.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await cl.query("set local role authenticated");
  }
  const p1 = c1.query("select public.respond_to_order_revision($1, true) s", [r41]).then(async (r) => { await new Promise((res) => setTimeout(res, 300)); await c1.query("commit"); return r.rows[0].s; });
  await new Promise((res) => setTimeout(res, 50));
  const p2 = c2.query("select public.respond_to_order_revision($1, true) s", [r41]).then(async (r) => { await c2.query("commit"); return r.rows[0].s; });
  const [s1, s2] = await Promise.all([p1, p2]);
  ok("concurrent accepts both report ACCEPTED", s1 === "ACCEPTED" && s2 === "ACCEPTED", `${s1} ${s2}`);
  ok("concurrent accepts change stock once (+2 taken)", (await stock(H4)) === h4b - 2, `${h4b} → ${await stock(H4)}`);
  await c1.end(); await c2.end();

  // ---- Initial order still priced from the DB price group.
  ok("catalog prices never changed", (await prices()) === pricesBefore);

  await c.end();
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
