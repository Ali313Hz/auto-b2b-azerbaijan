// Security regression tests for the rollout WITHOUT mandatory MFA
// (production migrations + M1-M3). Local Postgres only.
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers, seedProducts } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const gaps = [];

function ok(name, cond, extra = "") {
  if (cond) passed++;
  else failures.push(`${name} ${extra}`);
}

const ARCHIVED = "00000000-0000-4000-8000-000000000015";

try {
  const { c, applied } = await createDatabase("sec_tests_v2", { upTo: process.env.UP_TO });
  ok("enforce migration not present", !applied.some((f) => f.includes("enforce_mfa")), applied.slice(-4).join(","));
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${ARCHIVED}', 'arch@test.local');
    insert into public.customer_profiles (id, company_name, price_group, active, archived_at)
    values ('${ARCHIVED}', 'Archived', 'VIP', false, now());
  `);
  const cat = async (name, slug, parent, active = true) =>
    (await c.query("insert into public.categories (name, slug, sort_order, active, parent_id) values ($1,$2,0,$3,$4) returning id", [name, slug, active, parent])).rows[0].id;
  const A = await cat("A", "a", null);
  const B = await cat("B", "b", A);
  const C = await cat("C", "c", B);
  const R2 = await cat("R2", "r2", null, false);
  const D = await cat("D", "d", R2);
  const X = await cat("X", "x-off", null, false);
  const R3 = await cat("R3", "r3", null, false);
  const E = await cat("E", "e", R3);
  const F = await cat("F", "f", E);
  await seedProducts(c, 140, [A, B, C, D, X, F]);
  const prod = async (catId) => (await c.query("select p.id from public.products p where p.active and p.stock > 5 and p.category_id = $1 order by sku limit 1", [catId])).rows[0].id;
  const pC = await prod(C);
  const pD = await prod(D);
  const pX = await prod(X);
  const pF = await prod(F);
  const pOff = (await c.query("select p.id from public.products p where p.active and p.stock > 5 and p.category_id = $1 and p.id <> $2 order by sku limit 1", [C, pC])).rows[0].id;
  await c.query("update public.products set active = false where id = $1", [pOff]);
  const pB = await prod(B);

  // Run SQL as an API user (password session = aal1 by default). factor:
  // the user has a verified TOTP factor (inserted and rolled back).
  const sess = async (sub) => (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [sub])).rows[0].id;
  async function as(user, sql, params = []) {
    await c.query("begin");
    try {
      if (user.factor) {
        await c.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [user.sub]);
      }
      let sessionId;
      if (!user.anon) {
        const known = await c.query("select 1 from auth.users where id = $1", [user.sub]);
        if (known.rowCount) {
          sessionId = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [user.sub])).rows[0].id;
        }
      }
      const claims = user.anon ? { role: "anon" } : { sub: user.sub, role: "authenticated", aal: user.aal ?? "aal1", session_id: sessionId };
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await c.query(`set local role ${user.anon ? "anon" : "authenticated"}`);
      const r = await c.query(sql, params);
      await c.query("rollback");
      return { rows: r.rows };
    } catch (error) {
      await c.query("rollback");
      return { error: error.message };
    }
  }
  const U = {
    owner: { sub: IDS.owner },
    ownerFactorAal1: { sub: IDS.owner, factor: true },
    ownerFactorAal2: { sub: IDS.owner, factor: true, aal: "aal2" },
    dealer: { sub: IDS.dealer }, normal: { sub: IDS.normal }, vip: { sub: IDS.vip },
    dealerFactorAal1: { sub: IDS.dealer, factor: true },
    dealerFactorAal2: { sub: IDS.dealer, factor: true, aal: "aal2" },
    inactive: { sub: IDS.inactive }, archived: { sub: ARCHIVED },
    sales: { sub: IDS.sales }, anon: { anon: true },
    stranger: { sub: "00000000-0000-4000-8000-0000000000ff" },
  };

  // [name, sql, uses new helper-based check]
  const customerCalls = [
    ["catalog page", "select * from public.get_customer_catalog_page()", true],
    ["categories", "select * from public.get_customer_categories()", true],
    ["product", `select * from public.get_customer_product('${pC}')`, true],
    ["media", `select * from public.get_customer_product_media('${pC}')`, false],
    ["cart", "select * from public.get_customer_cart()", false],
    ["add_to_cart", `select public.add_to_cart('${pC}', 1)`, false],
    ["orders", "select * from public.get_customer_orders()", false],
    ["create order", "select public.create_order_from_cart()", false],
  ];
  const ownerCalls = [
    ["admin products page", "select * from public.get_admin_products_page()", true],
    ["admin product", `select * from public.get_admin_product('${pC}')`, true],
    ["admin categories", "select * from public.get_admin_categories()", true],
    ["dashboard", "select * from public.get_admin_dashboard_stats()", true],
    ["admin customers", "select * from public.get_admin_customers()", false],
    ["admin orders", "select * from public.get_admin_orders()", false],
    ["price group", `select public.set_customer_price_group('${IDS.normal}', 'VIP')`, false],
    ["customer active", `select public.set_customer_active('${IDS.normal}', false)`, false],
    ["archive", `select public.archive_admin_customer('${IDS.normal}')`, false],
    ["update product", `select public.update_admin_product('${pC}', 1, 1, 1, 1)`, false],
    ["product active", `select public.update_admin_product_active('${pC}', false)`, false],
    ["create category", "select public.create_admin_category('X', 'x', 0, true, null)", true],
    ["update category", `select public.update_admin_category('${A}', 'A', 'a', 0, true, null)`, true],
    ["audit log", "select * from public.get_admin_audit_log()", true],
    ["security event", `select public.record_admin_security_event('customer.mfa_reset', '${IDS.normal}')`, true],
    ["is owner", "select public.current_user_is_owner() as v", true],
  ];
  const emptyIsDenied = /catalog|categories|product|media|cart|orders/;

  // 1. Customer RPCs: password login works; other roles are denied.
  for (const [name, sql, helper] of customerCalls) {
    for (const u of ["inactive", "archived", "owner", "sales", "anon", "stranger"]) {
      const r = await as(U[u], sql);
      ok(`customer RPC ${name} denied for ${u}`, !!r.error || (r.rows.length === 0 && emptyIsDenied.test(name)), JSON.stringify(r).slice(0, 120));
    }
    for (const u of ["dealer", "dealerFactorAal2"]) {
      const r = await as(U[u], sql);
      ok(`customer RPC ${name} works for ${u}`, !r.error || r.error === "Cart is empty", r.error);
    }
    const r = await as(U.dealerFactorAal1, sql);
    const denied = !!r.error && r.error !== "Cart is empty" || (r.rows?.length === 0 && emptyIsDenied.test(name));
    if (helper) ok(`customer RPC ${name} denied for opted-in MFA user at aal1`, denied, JSON.stringify(r).slice(0, 120));
    else ok(`cart/order RPC ${name} has no MFA check (works at aal1 with a factor)`, !r.error || r.error === "Cart is empty", r.error);
  }

  // 2. Owner RPCs: OWNER only; SALES/customers/anon denied.
  for (const [name, sql, helper] of ownerCalls) {
    // SALES may use the customer/order/dashboard RPCs (staff role access).
    const salesAllowed = ["dashboard", "admin customers", "admin orders", "price group", "customer active"].includes(name);
    for (const u of ["dealer", "sales", "inactive", "anon", "stranger"]) {
      if (u === "sales" && salesAllowed) continue;
      const r = await as(U[u], sql);
      const denied = !!r.error || (name === "is owner" && r.rows[0].v === false);
      ok(`owner RPC ${name} denied for ${u}`, denied, JSON.stringify(r).slice(0, 120));
    }
    for (const u of ["owner", "ownerFactorAal2"]) {
      const r = await as(U[u], sql);
      ok(`owner RPC ${name} works for ${u}`, !r.error && !(name === "is owner" && r.rows[0].v !== true), r.error);
    }
    const r = await as(U.ownerFactorAal1, sql);
    const denied = !!r.error || (name === "is owner" && r.rows[0].v === false);
    if (helper) ok(`owner RPC ${name} denied for opted-in MFA owner at aal1`, denied, JSON.stringify(r).slice(0, 120));
    else if (!denied) gaps.push(`owner RPC ${name}: opted-in MFA owner at aal1 not blocked in DB (old RPC)`);
  }

  // Inactive owner.
  await c.query(`update public.staff_profiles set active = false where id = '${IDS.owner}'`);
  for (const [name, sql] of ownerCalls) {
    const r = await as(U.owner, sql);
    ok(`owner RPC ${name} denied for inactive owner`, !!r.error || (name === "is owner" && r.rows[0].v === false), JSON.stringify(r).slice(0, 100));
  }
  await c.query(`update public.staff_profiles set active = true where id = '${IDS.owner}'`);

  // 3. Price isolation.
  const prices = (await c.query("select * from public.product_prices where product_id = $1", [pC])).rows[0];
  for (const [u, col] of [["normal", "normal_price"], ["dealer", "dealer_price"], ["vip", "vip_price"]]) {
    const r = await as(U[u], `select * from public.get_customer_product('${pC}')`);
    ok(`price for ${u}`, Number(r.rows[0].price) === Number(prices[col]), JSON.stringify(r.rows[0]));
    ok(`no other price columns for ${u}`, !Object.keys(r.rows[0]).some((k) => /normal|dealer|vip/.test(k)));
    const page = await as(U[u], "select * from public.get_customer_catalog_page(1, 100, 'c')");
    const row = page.rows.find((x) => x.id === pC);
    ok(`catalog price for ${u}`, row && Number(row.price) === Number(prices[col]));
    ok(`catalog has no other price columns for ${u}`, !Object.keys(page.rows[0]).some((k) => /normal|dealer|vip/.test(k)));
  }

  // 4. Direct table access / self-escalation.
  for (const t of ["products", "product_prices", "orders", "carts", "categories", "product_media", "security_audit_log", "price_group_audit"]) {
    const r = await as(U.dealer, `select * from public.${t} limit 1`);
    ok(`direct select ${t} denied`, /permission denied/.test(r.error ?? "") || r.rows?.length === 0, JSON.stringify(r).slice(0, 100));
  }
  let r = await as(U.dealer, "select * from public.customer_profiles");
  ok("customer reads only own profile", r.rows?.length === 1 && r.rows[0].id === IDS.dealer, JSON.stringify(r).slice(0, 100));
  r = await as(U.dealer, `update public.customer_profiles set price_group = 'VIP' where id = '${IDS.dealer}'`);
  ok("customer cannot change own price group", /permission denied/.test(r.error ?? ""), JSON.stringify(r));
  r = await as(U.dealer, `update public.customer_profiles set active = true where id = '${IDS.dealer}'`);
  ok("customer cannot change own active flag", /permission denied/.test(r.error ?? ""), JSON.stringify(r));
  r = await as(U.dealer, `insert into public.staff_profiles (id, role) values ('${IDS.dealer}', 'OWNER')`);
  ok("customer cannot make self staff", /permission denied/.test(r.error ?? ""), JSON.stringify(r));
  r = await as(U.sales, `update public.staff_profiles set role = 'OWNER' where id = '${IDS.sales}'`);
  ok("sales cannot promote self", /permission denied/.test(r.error ?? "") || r.rows?.length === 0, JSON.stringify(r));
  r = await as(U.anon, "select private.is_active_owner()");
  ok("anon cannot call private helpers", /permission denied/.test(r.error ?? ""), JSON.stringify(r));
  r = await as(U.dealer, "select private.mfa_required() as v");
  ok("mfa_required() is false", r.rows?.[0].v === false, JSON.stringify(r));

  // 5. No pre-request hook, no restrictive MFA policies.
  const cfg = await c.query("select unnest(setconfig) s from pg_db_role_setting where setrole = 'authenticator'::regrole");
  ok("no pre-request hook configured", !cfg.rows.some((x) => /db_pre_request/.test(x.s)));
  const pol = await c.query("select count(*)::int n from pg_policies where policyname ilike '%MFA%'");
  ok("no MFA policies", pol.rows[0].n === 0);

  // 6. Storage (existing policies).
  const okName = `${pC}/0b6f5c3e-1d2a-4b3c-8d4e-5f6a7b8c9d0e.jpg`;
  const ins = (name) => `insert into storage.objects (bucket_id, name) values ('product-media', '${name}')`;
  r = await as(U.owner, ins(okName));
  ok("owner upload ok", !r.error, r.error);
  r = await as(U.owner, ins(okName.replace(".jpg", "-thumb.webp")));
  ok("owner thumbnail upload ok", !r.error, r.error);
  for (const u of ["dealer", "sales", "inactive", "stranger"]) {
    const res = await as(U[u], ins(okName));
    ok(`storage upload denied for ${u}`, !!res.error, JSON.stringify(res));
  }
  await c.query("insert into storage.buckets (id, name, public) values ('other','other',true) on conflict do nothing");
  r = await as(U.owner, `insert into storage.objects (bucket_id, name) values ('other', '${okName}')`);
  ok("upload to other bucket denied", !!r.error);
  await c.query(`insert into storage.objects (bucket_id, name) values ('product-media', '${okName}')`);
  r = await as(U.dealer, "select count(*)::int n from storage.objects where bucket_id = 'product-media'");
  ok("customer can read media", r.rows?.[0].n === 1, JSON.stringify(r));
  r = await as(U.dealer, `delete from storage.objects where name = '${okName}' returning id`);
  ok("customer cannot delete media", r.rows?.length === 0, JSON.stringify(r));
  r = await as(U.sales, `delete from storage.objects where name = '${okName}' returning id`);
  ok("sales cannot delete media", r.rows?.length === 0, JSON.stringify(r));
  r = await as(U.inactive, "select count(*)::int n from storage.objects where bucket_id = 'product-media'");
  if (r.rows?.[0].n !== 0) gaps.push("storage: any authenticated user (also inactive/sales) can read product-media objects (existing policy)");

  // 7. Hierarchy rules.
  const tryQ = async (sql) => { try { await c.query(sql); return null; } catch (e) { return e.message; } };
  ok("self parent rejected", !!(await tryQ(`update public.categories set parent_id = id where id = '${A}'`)));
  ok("cycle rejected", /cycle/.test(await tryQ(`update public.categories set parent_id = '${C}' where id = '${A}'`) ?? ""));
  ok("depth > 3 rejected", /too deep/.test(await tryQ(`insert into public.categories (name, slug, parent_id) values ('E','e','${C}')`) ?? ""));
  ok("subtree move too deep rejected", /too deep/.test(await tryQ(`update public.categories set parent_id = '${D}' where id = '${B}'`) ?? ""));
  r = await as(U.owner, `select public.update_admin_category('${A}', 'A', 'a', 0, true, '${C}')`);
  ok("RPC move into own descendant rejected", /cycle/.test(r.error ?? ""), JSON.stringify(r));
  r = await as(U.owner, "select public.create_admin_category('Bad', 'Bad Slug!', 0, true, null)");
  ok("bad slug rejected", !!r.error);
  r = await as(U.owner, `select public.create_admin_category('Sub', 'sub-ok', 0, true, '${A}')`);
  ok("valid subcategory created", !r.error, r.error);
  r = await as(U.sales, `select public.create_admin_category('Sub', 'sub-ok', 0, true, '${A}')`);
  ok("sales cannot create category", !!r.error);

  // 8. Inactive ancestor hides products in the new RPCs.
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100)");
  ok("inactive root hides child products", !r.rows.some((x) => x.id === pD) && r.rows.some((x) => x.id === pC));
  r = await as(U.dealer, `select * from public.get_customer_product('${pD}')`);
  ok("inactive ancestor product detail hidden", r.rows?.length === 0);
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, 'd')");
  ok("inactive category slug returns nothing", r.rows?.length === 0);
  r = await as(U.dealer, "select * from public.get_customer_categories()");
  ok("customer nav hides inactive subtree", !r.rows.some((x) => x.id === D || x.id === R2) && r.rows.some((x) => x.id === C));
  // Cart / order / media availability (product id known to the client).
  for (const [label, pid] of [["inactive product", pOff], ["inactive direct category", pX], ["inactive parent category", pD], ["inactive grandparent category", pF], ["unknown product", "00000000-0000-4000-8000-0000000000aa"]]) {
    r = await as(U.dealer, `select public.add_to_cart('${pid}', 1)`);
    ok(`add_to_cart rejects ${label}`, /Product not found/.test(r.error ?? ""), JSON.stringify(r));
    r = await as(U.dealer, `select * from public.get_customer_product_media('${pid}')`);
    ok(`product media rejects ${label}`, /not available/.test(r.error ?? ""), JSON.stringify(r).slice(0, 100));
  }
  r = await as(U.dealer, `select public.add_to_cart('${pB}', 1)`);
  ok("add_to_cart accepts available product", !r.error, r.error);

  // Item becomes unavailable after it was added: cart flags it, order and
  // quantity change are rejected, removing is still possible.
  for (const [label, setup] of [
    ["product deactivated", `update public.products set active = false where id = '${pB}'`],
    ["parent category deactivated", `update public.categories set active = false where id = '${A}'`],
    ["own category deactivated", `update public.categories set active = false where id = '${B}'`],
  ]) {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: IDS.normal, role: "authenticated", aal: "aal1", session_id: await sess(IDS.normal) })]);
    await c.query("set local role authenticated");
    await c.query(`select public.add_to_cart('${pB}', 1)`);
    await c.query("reset role");
    await c.query(setup);
    await c.query("set local role authenticated");
    const cart = (await c.query("select * from public.get_customer_cart()")).rows;
    ok(`cart marks item unavailable when ${label}`, cart.length === 1 && cart[0].available === false, JSON.stringify(cart));
    let err = null;
    await c.query("savepoint s1");
    try { await c.query(`select public.change_cart_quantity('${pB}', 1)`); } catch (e) { err = e.message; }
    await c.query("rollback to savepoint s1");
    ok(`quantity change rejected when ${label}`, /Cart item not found/.test(err ?? ""), err);
    err = null;
    try { await c.query("select public.create_order_from_cart()"); } catch (e) { err = e.message; }
    await c.query("rollback to savepoint s1");
    ok(`order rejected when ${label}`, /unavailable product/.test(err ?? ""), err);
    err = null;
    try { await c.query(`select public.remove_from_cart('${pB}')`); } catch (e) { err = e.message; }
    ok(`remove still allowed when ${label}`, err === null, err);
    await c.query("rollback");
  }

  // Archived (a DB constraint keeps them inactive) and inactive customers: no cart/order access.
  for (const u of ["archived", "inactive"]) {
    for (const sql of [`select public.change_cart_quantity('${pC}', 1)`, `select public.remove_from_cart('${pC}')`]) {
      r = await as(U[u], sql);
      ok(`${u}: ${sql.slice(14, 34)} denied`, /Active customer profile required/.test(r.error ?? ""), JSON.stringify(r));
    }
  }

  // 9. Subcategory inclusion.
  const all = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, 'a')");
  const only = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, 'a', null, 'name', false)");
  ok("root includes descendants", all.rows.some((x) => x.id === pC));
  ok("include_subcategories=false excludes descendants", !only.rows.some((x) => x.id === pC) && only.rows.length > 0);

  // 10. Input clamping / injection.
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100000)");
  ok("page size clamped to 100", r.rows.length <= 100);
  r = await as(U.owner, "select * from public.get_admin_products_page(1, 100000)");
  ok("admin page size clamped", r.rows.length <= 100);
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(-5, -5, null, null, 'name; drop table products')");
  ok("negative page/size + bad sort handled", !r.error && r.rows.length === 1, JSON.stringify(r).slice(0, 100));
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, null, '%')");
  ok("search wildcard is literal", r.rows.length === 0, String(r.rows?.length));
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, null, 'SKU-00001')");
  ok("search by sku", r.rows.length >= 1);
  r = await as(U.dealer, "select * from public.get_customer_catalog_page(1, 100, 'does-not-exist')");
  ok("unknown category returns empty, not all", r.rows.length === 0);

  // 11. Audit log.
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: IDS.owner, role: "authenticated", aal: "aal1", session_id: await sess(IDS.owner) })]);
  await c.query("set local role authenticated");
  await c.query(`select public.update_admin_product('${pC}', 7, 1, 2, 3)`);
  await c.query(`select public.set_customer_price_group('${IDS.normal}', 'DEALER')`);
  await c.query(`select public.record_admin_security_event('customer.password_changed', '${IDS.normal}')`);
  await c.query("commit");
  const audit = (await c.query("select * from public.security_audit_log order by id")).rows;
  ok("audit has product + price + profile changes by owner", audit.some((a) => a.action === "products.update" && a.actor_user_id === IDS.owner) && audit.some((a) => a.action === "product_prices.update") && audit.some((a) => a.action === "customer_profiles.update" && a.details.changed.includes("price_group")), JSON.stringify(audit.slice(-4)));
  ok("audit has security event", audit.some((a) => a.action === "customer.password_changed"));
  ok("audit stores no values", !JSON.stringify(audit).includes("DEALER"));
  ok("audit update blocked", /append-only/.test(await tryQ("update public.security_audit_log set action = 'x'") ?? ""));
  ok("audit delete blocked", /append-only/.test(await tryQ("delete from public.security_audit_log") ?? ""));
  ok("audit truncate blocked", /append-only/.test(await tryQ("truncate public.security_audit_log") ?? ""));
  r = await as(U.owner, "delete from public.security_audit_log returning id");
  ok("owner cannot delete audit via API", !!r.error, JSON.stringify(r).slice(0, 100));
  r = await as(U.dealer, "select * from public.get_admin_audit_log()");
  ok("customer cannot read audit", !!r.error);
  r = await as(U.owner, "select public.record_admin_security_event('customer.become_owner', gen_random_uuid())");
  ok("invalid security event rejected", /Invalid security event/.test(r.error ?? ""));

  // 12. Orders priced from DB; IDOR.
  const before = (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n;
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: IDS.vip, role: "authenticated", aal: "aal1", session_id: await sess(IDS.vip) })]);
  await c.query("set local role authenticated");
  await c.query(`select public.add_to_cart('${pC}', 2)`);
  const orderId = (await c.query("select public.create_order_from_cart() as id")).rows[0].id;
  await c.query("commit");
  const order = (await c.query("select total_amount from public.orders where id = $1", [orderId])).rows[0];
  const vipNow = (await c.query("select vip_price from public.product_prices where product_id = $1", [pC])).rows[0].vip_price;
  ok("order total uses VIP price from DB", Number(order.total_amount) === 2 * Number(vipNow), `${order.total_amount} vs ${vipNow}`);
  const after = (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n;
  ok("customer order adds no audit rows", after === before, `${before} -> ${after}`);
  r = await as(U.sales, `select public.update_admin_order_status('${orderId}', 'CANCELLED')`);
  ok("sales can process (cancel) orders", !r.error, JSON.stringify(r));
  r = await as(U.owner, `select public.update_admin_order_status('${orderId}', 'CANCELLED')`);
  ok("owner can cancel order (rolled back sales change)", !r.error, r.error);
  r = await as(U.dealer, `select * from public.get_customer_order_items('${orderId}')`);
  ok("IDOR: other customer's order items hidden", r.rows?.length === 0);

  await c.end();
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
console.log(`KNOWN GAPS (${gaps.length}):`);
for (const g of gaps) console.log("  GAP:", g);
process.exitCode = failures.length ? 1 : 0;
