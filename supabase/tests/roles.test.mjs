// Staff role matrix tests (local Postgres only).
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers, seedProducts } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  PRODUCT_MANAGER: "00000000-0000-4000-8000-000000000022",
  SUPPORT: "00000000-0000-4000-8000-000000000023",
  WAREHOUSE: "00000000-0000-4000-8000-000000000024",
  INACTIVE_PM: "00000000-0000-4000-8000-000000000025",
  TEMP_SALES: "00000000-0000-4000-8000-000000000026",
  CUSTOMER: IDS.dealer,
};

try {
  const { c } = await createDatabase("roles_tests");
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values
      ('${U.PRODUCT_MANAGER}', 'pm@t'), ('${U.SUPPORT}', 'sup@t'), ('${U.WAREHOUSE}', 'wh@t'),
      ('${U.INACTIVE_PM}', 'ipm@t'), ('${U.TEMP_SALES}', 'ts@t');
    insert into public.staff_profiles (id, full_name, role, active, must_change_password) values
      ('${U.PRODUCT_MANAGER}', 'PM', 'PRODUCT_MANAGER', true, false),
      ('${U.SUPPORT}', 'Sup', 'SUPPORT', true, false),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true, false),
      ('${U.INACTIVE_PM}', 'IPM', 'PRODUCT_MANAGER', false, false),
      ('${U.TEMP_SALES}', 'TS', 'SALES', true, true);
  `);
  const cat = (await c.query("insert into public.categories (name, slug, sort_order, active) values ('A','a',0,true) returning id")).rows[0].id;
  await seedProducts(c, 20, [cat]);
  const pid = (await c.query("select id from public.products where active and stock > 5 limit 1")).rows[0].id;
  const media = (await c.query(`insert into public.product_media (product_id, media_type, storage_path, mime_type, is_primary) values ($1::uuid, 'IMAGE', $2, 'image/jpeg', false) returning id`, [pid, pid + '/a.jpg'])).rows[0].id;
  await c.query(`insert into storage.buckets (id, name, public) values ('product-media','product-media',false) on conflict do nothing;
                 insert into storage.objects (bucket_id, name) values ('product-media', '${pid}/a.jpg')`);
  // An order for the dealer.
  await c.query("begin");
  const sDealer = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [IDS.dealer])).rows[0].id;
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: IDS.dealer, role: "authenticated", aal: "aal1", session_id: sDealer })]);
  await c.query("set local role authenticated");
  await c.query(`select public.add_to_cart('${pid}', 1)`);
  const orderId = (await c.query("select public.create_order_from_cart() as id")).rows[0].id;
  await c.query("commit");

  const sessions = {};
  for (const [k, id] of Object.entries(U)) {
    sessions[k] = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  }

  async function as(who, sql) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U[who], role: "authenticated", aal: "aal1", session_id: sessions[who] })]);
      await c.query("set local role authenticated");
      const r = await c.query(sql);
      await c.query("rollback");
      return { rows: r.rows };
    } catch (e) {
      await c.query("rollback");
      return { error: e.message };
    }
  }

  const O = "OWNER", S = "SALES", P = "PRODUCT_MANAGER", W = "WAREHOUSE", H = "SUPPORT";
  // [name, sql, allowed roles]
  // Same items again = no change (the role check still runs first).
  const sameItems = JSON.stringify((await c.query("select product_id, quantity from public.order_items where order_id = $1", [orderId])).rows);
  const calls = [
    ["dashboard", "select * from public.get_admin_dashboard_stats()", [O, S, P, W, H]],
    ["customers list", "select * from public.get_admin_customers()", [O, S, H]],
    ["customer profile edit", `select public.update_admin_customer_profile('${IDS.normal}', 'X', 'Y', '')`, [O, S]],
    ["customer price group", `select public.set_customer_price_group('${IDS.normal}', 'VIP')`, [O, S]],
    ["customer active", `select public.set_customer_active('${IDS.normal}', false)`, [O, S]],
    ["customer archive", `select public.archive_admin_customer('${IDS.normal}')`, [O]],
    ["customer restore", `select public.restore_admin_customer('${IDS.normal}')`, [O]],
    ["customer delete status", `select * from public.get_admin_customer_delete_status('${IDS.normal}')`, [O]],
    ["customer login", `select * from public.get_admin_customer_login('${IDS.normal}')`, [O]],
    ["customer password reset", `select public.mark_admin_password_reset('${IDS.normal}', 'customer')`, [O]],
    ["orders list", "select * from public.get_admin_orders()", [O, S, W, H]],
    ["order items", `select * from public.get_admin_order_items('${orderId}')`, [O, S, W, H]],
    ["order status", `select public.update_admin_order_status('${orderId}', 'CONFIRMED')`, [O, S, W]],
    ["order edit items", `select public.update_admin_order_items('${orderId}', '${sameItems}'::jsonb)`, [O, S]],
    ["order change history", `select * from public.get_admin_order_changes('${orderId}')`, [O, S, W, H]],
    ["order product search", `select * from public.search_admin_order_products('${orderId}', 'a')`, [O, S]],
    ["old revision create (off)", `select public.create_admin_order_revision('${orderId}')`, []],
    ["old revision answer (off)", `select public.respond_to_order_revision('${orderId}', true)`, []],
    ["products page", "select * from public.get_admin_products_page()", [O, P, W]],
    ["product", `select * from public.get_admin_product('${pid}')`, [O, P, W]],
    ["product media list", `select * from public.get_admin_product_media('${pid}')`, [O, P, W]],
    ["categories", "select * from public.get_admin_categories()", [O, P, W]],
    ["product stock", `select public.update_admin_product_stock('${pid}', 7)`, [O, P, W]],
    ["product prices+stock", `select public.update_admin_product('${pid}', 7, 1, 1, 1)`, [O, P]],
    ["product active", `select public.update_admin_product_active('${pid}', false)`, [O, P]],
    ["product content", `select public.update_admin_product_content('${pid}', 'N', 'D', null)`, [O, P]],
    ["product create", "select public.create_admin_product('NEW-1', null, 1, 1, 1, 1, true)", [O, P]],
    ["product create (optional prices)", "select public.create_admin_product('NEW-2', null, 1, 10, null, null, 8, true)", [O, P]],
    ["product pricing", `select public.update_admin_product_pricing('${pid}', 7, 10, null, null, 9)`, [O, P]],
    ["media create", `select public.create_admin_product_media('${pid}', 'IMAGE', '${pid}/b.jpg', 'b.jpg', 'image/jpeg')`, [O, P]],
    ["media primary", `select public.set_admin_product_primary_media('${media}')`, [O, P]],
    ["media delete", `select public.delete_admin_product_media('${media}')`, [O, P]],
    ["category create", "select public.create_admin_category('N', 'n-new', 0, true, null)", [O, P]],
    ["category update", `select public.update_admin_category('${cat}', 'A', 'a', 0, true, null)`, [O, P]],
    ["storage upload", `insert into storage.objects (bucket_id, name) values ('product-media', '${pid}/c.jpg')`, [O, P]],
    ["storage delete", `delete from storage.objects where name = '${pid}/a.jpg' returning 1 as x`, [O, P]],
    ["staff list", "select * from public.get_admin_staff()", [O]],
    ["staff update", `select public.update_admin_staff('${U.SUPPORT}', 'Sup', 'SALES', true)`, [O]],
    ["audit log", "select * from public.get_admin_audit_log()", [O]],
    ["security event", `select public.record_admin_security_event('customer_created', '${IDS.normal}')`, [O]],
    ["is owner", "select public.current_user_is_owner() as v", [O]],
  ];

  const who = [O, S, P, W, H, "INACTIVE_PM", "TEMP_SALES", "CUSTOMER"];
  for (const [name, sql, allowed] of calls) {
    for (const w of who) {
      const r = await as(w, sql);
      const permitted =
        !r.error &&
        !(name === "is owner" && r.rows[0].v !== true) &&
        !(name === "storage delete" && r.rows.length === 0);
      const expect = allowed.includes(w);
      ok(`${name}: ${w} ${expect ? "allowed" : "denied"}`, permitted === expect, r.error ?? "");
    }
  }

  // Prices hidden from WAREHOUSE, visible to OWNER / PM.
  for (const [w, visible] of [[O, true], [P, true], [W, false]]) {
    const page = await as(w, "select * from public.get_admin_products_page()");
    const one = await as(w, `select * from public.get_admin_product('${pid}')`);
    const has = (rows) => rows.every((x) => x.normal_price !== null && x.dealer_price !== null && x.vip_price !== null);
    const none = (rows) => rows.every((x) => x.normal_price === null && x.dealer_price === null && x.vip_price === null && x.sale_price === null);
    const pageHas = (rows) => rows.every((x) => x.normal_price !== null && x.has_group_prices !== null);
    const pageNone = (rows) => rows.every((x) => x.normal_price === null && x.sale_price === null && x.has_group_prices === null);
    ok(`prices ${visible ? "visible" : "hidden"} for ${w}`, page.rows?.length > 0 && one.rows?.length === 1 && (visible ? pageHas(page.rows) && has(one.rows) : pageNone(page.rows) && none(one.rows)));
    ok(`product list has no dealer/VIP columns (${w})`, page.rows?.every((x) => !("dealer_price" in x) && !("vip_price" in x)));
  }
  // Media readable by any active staff, not by temp-password staff.
  for (const [w, n] of [[S, 1], [H, 1], [W, 1], ["TEMP_SALES", 0], ["INACTIVE_PM", 0]]) {
    const r = await as(w, "select count(*)::int n from storage.objects where bucket_id = 'product-media'");
    ok(`media read for ${w} = ${n}`, r.rows?.[0]?.n === n, JSON.stringify(r));
  }
  // get_my_staff_role.
  for (const [w, role] of [[O, O], [W, W], ["TEMP_SALES", null], ["INACTIVE_PM", null], ["CUSTOMER", null]]) {
    const r = await as(w, "select public.get_my_staff_role() as r");
    ok(`get_my_staff_role ${w}`, r.rows?.[0]?.r === role, JSON.stringify(r));
  }
  // Staff changes are audited with the actor.
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.WAREHOUSE, role: "authenticated", aal: "aal1", session_id: sessions.WAREHOUSE })]);
  await c.query("set local role authenticated");
  await c.query(`select public.update_admin_product_stock('${pid}', 9)`);
  await c.query("commit");
  const a = (await c.query(`select * from public.security_audit_log where actor_user_id = '${U.WAREHOUSE}' order by id desc limit 1`)).rows[0];
  ok("warehouse stock change audited", a?.action === "products.update" && a.details?.changed?.includes("stock"), JSON.stringify(a));
  // SALES cannot change own role directly.
  const r = await as(S, `update public.staff_profiles set role = 'OWNER' where id = '${U.SALES}'`);
  ok("sales cannot self-promote via table", !!r.error);

  await c.end();
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
