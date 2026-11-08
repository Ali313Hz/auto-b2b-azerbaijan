// Password reset / forced change / session cut-off / staff management tests.
// Local Postgres only.
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers, seedProducts } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const OWNER2 = "00000000-0000-4000-8000-000000000002";
const NEWSTAFF = "00000000-0000-4000-8000-000000000031";
const ARCHIVED = "00000000-0000-4000-8000-000000000015";
const MARKER = "Tmp#Marker-9fQ2xLz7";

try {
  const { c } = await createDatabase("pw_tests");
  await c.query("alter table auth.users add column encrypted_password text");
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values
      ('${OWNER2}', 'owner2@test.local'), ('${NEWSTAFF}', 'new@test.local'), ('${ARCHIVED}', 'arch@test.local');
    insert into public.staff_profiles (id, full_name, role, active) values ('${OWNER2}', 'Owner 2', 'OWNER', true);
    insert into public.customer_profiles (id, company_name, price_group, active, archived_at)
    values ('${ARCHIVED}', 'Archived', 'VIP', false, now());
    update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuuMARKERHASH';
  `);
  const cat = (await c.query("insert into public.categories (name, slug, sort_order, active) values ('A','a',0,true) returning id")).rows[0].id;
  await seedProducts(c, 30, [cat]);
  const pid = (await c.query("select id from public.products where active and stock > 5 limit 1")).rows[0].id;
  await c.query(`insert into storage.buckets (id, name, public) values ('product-media','product-media',false) on conflict do nothing;
                 insert into storage.objects (bucket_id, name) values ('product-media', '${pid}/a.jpg')`);

  // Creates a session row (like a login) at the given time offset.
  const login = async (sub, ago = "1 hour") =>
    (await c.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - $2::interval) returning id`, [sub, ago])).rows[0].id;

  // Runs sql as an API user with a session. commit=true keeps the changes.
  async function as(sub, session, sql, { commit = false, role = "authenticated" } = {}) {
    await c.query("begin");
    try {
      const claims = role === "anon" ? { role } : role === "service_role" ? { role } : { sub, role, aal: "aal1", session_id: session };
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await c.query(`set local role ${role}`);
      const r = await c.query(sql);
      await c.query(commit ? "commit" : "rollback");
      return { rows: r.rows };
    } catch (e) {
      await c.query("rollback");
      return { error: e.message };
    }
  }
  const catalog = (sub, s) => as(sub, s, "select * from public.get_customer_catalog_page()");
  const canShop = async (sub, s) => {
    const r = await catalog(sub, s);
    const cart = await as(sub, s, `select public.add_to_cart('${pid}', 1)`);
    const media = await as(sub, s, "select count(*)::int n from storage.objects where bucket_id = 'product-media'");
    return !r.error && r.rows.length > 0 && !cart.error && media.rows?.[0]?.n === 1;
  };
  const deniedShop = async (sub, s) => {
    const r = await catalog(sub, s);
    const cart = await as(sub, s, `select public.add_to_cart('${pid}', 1)`);
    const getCart = await as(sub, s, "select * from public.get_customer_cart()");
    const orders = await as(sub, s, "select * from public.get_customer_orders()");
    const prod = await as(sub, s, `select * from public.get_customer_product('${pid}')`);
    const media = await as(sub, s, "select count(*)::int n from storage.objects where bucket_id = 'product-media'");
    const order = await as(sub, s, "select public.create_order_from_cart()");
    return (!!r.error || r.rows.length === 0) && !!cart.error && !!order.error
      && (getCart.error || getCart.rows.length === 0) && (orders.error || orders.rows.length === 0)
      && (prod.error || prod.rows.length === 0) && media.rows?.[0]?.n === 0;
  };
  const isOwner = async (sub, s) => {
    const r = await as(sub, s, "select * from public.get_admin_customers()");
    const r2 = await as(sub, s, "select * from public.get_admin_products_page()");
    return !r.error && !r2.error;
  };

  const ownerS = await login(IDS.owner);

  // --- 1. Nobody can read a current password --------------------------
  let r = await as(IDS.owner, ownerS, "select encrypted_password from auth.users limit 1");
  ok("owner cannot read auth.users password hash directly", !!r.error, JSON.stringify(r));
  const outputs = [
    `select * from public.get_admin_customer_login('${IDS.normal}')`,
    "select * from public.get_admin_staff()",
    "select * from public.get_admin_customers()",
    `select * from public.get_admin_customer_delete_status('${IDS.normal}')`,
  ];
  for (const sql of outputs) {
    r = await as(IDS.owner, ownerS, sql);
    const text = JSON.stringify(r.rows);
    const cols = Object.keys(r.rows?.[0] ?? {});
    ok(`no password in ${sql.slice(14, 50)}`, !r.error && !text.includes("MARKERHASH") && !cols.some((k) => /password/.test(k) && !/^(must_change_password|temporary_password_expires_at)$/.test(k)), r.error ?? cols.join(","));
  }
  const pwCols = (await c.query(`select table_schema||'.'||table_name||'.'||column_name c, data_type from information_schema.columns
     where table_schema in ('public','private') and (column_name ilike '%pass%' or column_name ilike '%secret%' or column_name ilike '%token%')`)).rows;
  ok("only the flag/expiry password columns exist", pwCols.every((x) => /must_change_password|temporary_password_expires_at/.test(x.c) && x.data_type !== "text"), JSON.stringify(pwCols));
  const funcArgs = (await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ('public','private') and pg_get_function_arguments(p.oid) ilike '%password%'`)).rows;
  ok("no RPC takes a password argument", funcArgs.length === 0, JSON.stringify(funcArgs));

  // --- 2. Baseline: customer shops normally ---------------------------
  const normalOld = await login(IDS.normal, "2 hours");
  ok("customer can shop before reset", await canShop(IDS.normal, normalOld));
  r = await as(IDS.normal, normalOld, "select * from public.get_my_account_state()");
  ok("account state before reset", r.rows?.[0]?.account_type === "customer" && r.rows[0].must_change_password === false && r.rows[0].session_current === true, JSON.stringify(r));

  // --- 3. Who may reset ------------------------------------------------
  const salesS = await login(IDS.sales);
  const dealerS = await login(IDS.dealer);
  for (const [who, sub, s] of [["sales", IDS.sales, salesS], ["customer", IDS.dealer, dealerS]]) {
    r = await as(sub, s, `select public.mark_admin_password_reset('${IDS.normal}', 'customer')`);
    ok(`${who} cannot reset a customer password`, !!r.error, JSON.stringify(r));
    r = await as(sub, s, `select public.mark_admin_password_reset('${IDS.owner}', 'staff')`);
    ok(`${who} cannot reset a staff password`, !!r.error);
    r = await as(sub, s, `select * from public.get_admin_customer_login('${IDS.normal}')`);
    ok(`${who} cannot read customer login details`, !!r.error);
    r = await as(sub, s, "select * from public.get_admin_staff()");
    ok(`${who} cannot list staff`, !!r.error);
  }
  r = await as(null, null, `select public.mark_admin_password_reset('${IDS.normal}', 'customer')`, { role: "anon" });
  ok("anon cannot reset", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.sales}', 'customer')`);
  ok("customer reset rejects a staff target", r.error === "Customer not found", JSON.stringify(r));
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${OWNER2}', 'customer')`);
  ok("customer reset rejects another OWNER", r.error === "Customer not found", JSON.stringify(r));
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.normal}', 'staff')`);
  ok("staff reset rejects a customer target", r.error === "Staff member not found", JSON.stringify(r));
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.owner}', 'staff')`);
  ok("owner cannot reset own password via admin reset", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.normal}', 'admin')`);
  ok("invalid account type rejected", r.error === "Invalid account type");
  r = await as(IDS.owner, ownerS, `select public.complete_password_change('${IDS.normal}', null)`);
  ok("authenticated cannot call complete_password_change", !!r.error && /permission/.test(r.error), JSON.stringify(r));
  r = await as(IDS.normal, normalOld, `select public.complete_password_change('${IDS.normal}', '${normalOld}')`);
  ok("customer cannot clear own flag without a password change", !!r.error);

  // --- 4. OWNER resets the customer -----------------------------------
  const auditBefore = (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n;
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.normal}', 'customer') as exp`, { commit: true });
  ok("owner can reset customer", !r.error, r.error);
  const expDiffH = r.rows ? (new Date(r.rows[0].exp) - Date.now()) / 3600e3 : 0;
  ok("temporary password expires in ~24h", expDiffH > 23.9 && expDiffH < 24.1, String(expDiffH));
  // The Auth Admin API would now set the new password (bcrypt in auth.users).
  await c.query(`update auth.users set encrypted_password = '$2a$10$newhashnewhashnewhashnewhashnewhashnewhashnewha' where id = '${IDS.normal}'`);
  let prof = (await c.query(`select * from public.customer_profiles where id = '${IDS.normal}'`)).rows[0];
  ok("must_change_password true after reset", prof.must_change_password === true && prof.credentials_changed_at && prof.temporary_password_expires_at, JSON.stringify(prof));
  const audit = (await c.query("select * from public.security_audit_log order by id desc limit 5")).rows;
  const ev = audit.find((a) => a.action === "customer_password_reset");
  ok("audit has customer_password_reset", ev && ev.actor_user_id === IDS.owner && ev.target_type === "customer" && ev.target_id === IDS.normal && ev.details === null, JSON.stringify(audit));
  const allAudit = JSON.stringify((await c.query("select * from public.security_audit_log")).rows);
  ok("audit log never contains password material", !/MARKER|\$2a\$|password\"\s*:|newhash/i.test(allAudit.replace(/must_change_password|temporary_password_expires_at|customer_password_reset|staff_password_reset/g, "")));
  ok("audit rows added", (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n > auditBefore);
  // Temp password in no table (the DB never receives it; scan everything anyway).
  const tables = (await c.query("select table_schema, table_name from information_schema.tables where table_schema in ('public','private','auth','storage') and table_type='BASE TABLE'")).rows;
  let hits = 0;
  for (const t of tables) {
    hits += (await c.query(`select count(*)::int n from "${t.table_schema}"."${t.table_name}" x where x::text like '%${MARKER}%'`)).rows[0].n;
  }
  ok("temporary password text is in no table", hits === 0, String(hits));

  // --- 5. Old session after reset ---------------------------------------
  ok("old session loses all business access after reset", await deniedShop(IDS.normal, normalOld));
  r = await as(IDS.normal, normalOld, "select * from public.get_my_account_state()");
  ok("old session reported as not current", r.rows?.[0]?.session_current === false, JSON.stringify(r));

  // --- 6. Login with temporary password -> must change ------------------
  const tempS = await login(IDS.normal, "-1 second"); // created after the reset
  ok("temporary-password session cannot reach catalog/cart/orders/media", await deniedShop(IDS.normal, tempS));
  r = await as(IDS.normal, tempS, "select * from public.get_my_account_state()");
  ok("temp session: must change, current, not expired", r.rows?.[0]?.must_change_password === true && r.rows[0].session_current === true && r.rows[0].temporary_password_expired === false, JSON.stringify(r));
  r = await as(IDS.normal, tempS, `update public.customer_profiles set must_change_password = false where id = '${IDS.normal}'`);
  ok("customer cannot clear must_change directly", !!r.error, JSON.stringify(r));
  const otherTempS = await login(IDS.normal, "0 seconds");

  // --- 7. Password change completed by the server ---------------------
  r = await as(null, null, `select public.complete_password_change('${IDS.normal}', '${tempS}')`, { role: "service_role", commit: true });
  ok("service role completes password change", !r.error, r.error);
  prof = (await c.query(`select * from public.customer_profiles where id = '${IDS.normal}'`)).rows[0];
  ok("flags cleared after change", prof.must_change_password === false && prof.temporary_password_expires_at === null && prof.credentials_session_id === tempS, JSON.stringify(prof));
  ok("catalog opens after password change (same session)", await canShop(IDS.normal, tempS));
  ok("other session from before the change is cut off", await deniedShop(IDS.normal, otherTempS));
  ok("pre-reset session still cut off", await deniedShop(IDS.normal, normalOld));
  const freshS = await login(IDS.normal, "-3 seconds");
  ok("new login after change works", await canShop(IDS.normal, freshS));
  r = await as(IDS.normal, "00000000-0000-4000-8000-0000000000aa", "select * from public.get_customer_catalog_page()");
  ok("unknown session id denied", !!r.error || r.rows.length === 0);
  r = await as(IDS.normal, null, "select * from public.get_customer_catalog_page()");
  ok("token without session id denied", !!r.error || r.rows.length === 0);
  r = await as(IDS.dealer, freshS, "select * from public.get_customer_catalog_page()");
  ok("someone else's session id denied", !!r.error || r.rows.length === 0);
  await c.query("delete from auth.sessions where id = $1", [freshS]);
  ok("signed-out (deleted) session denied", await deniedShop(IDS.normal, freshS));
  // Voluntary change by a normal customer (no reset).
  const vipA = await login(IDS.vip, "3 hours");
  const vipB = await login(IDS.vip, "1 hour");
  r = await as(null, null, `select public.complete_password_change('${IDS.vip}', '${vipB}')`, { role: "service_role", commit: true });
  ok("voluntary change: changing session keeps working", !r.error && await canShop(IDS.vip, vipB), r.error);
  ok("voluntary change: other sessions cut off", await deniedShop(IDS.vip, vipA));

  // --- 8. Expired temporary password ----------------------------------
  await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.dealer}', 'customer')`, { commit: true });
  await c.query(`update public.customer_profiles set temporary_password_expires_at = now() - interval '1 minute' where id = '${IDS.dealer}'`);
  const dealerTemp = await login(IDS.dealer, "-1 second");
  r = await as(IDS.dealer, dealerTemp, "select * from public.get_my_account_state()");
  ok("expired temporary password reported", r.rows?.[0]?.temporary_password_expired === true, JSON.stringify(r));
  ok("expired temporary password: no business access", await deniedShop(IDS.dealer, dealerTemp));
  r = await as(null, null, `select public.complete_password_change('${IDS.dealer}', '${dealerTemp}')`, { role: "service_role" });
  ok("expired temporary password cannot be cleared", r.error === "Password change not allowed", JSON.stringify(r));
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${IDS.dealer}', 'customer')`, { commit: true });
  ok("owner can reset again after expiry", !r.error);
  const dealerTemp2 = await login(IDS.dealer, "-2 seconds");
  r = await as(null, null, `select public.complete_password_change('${IDS.dealer}', '${dealerTemp2}')`, { role: "service_role", commit: true });
  ok("new reset can be completed", !r.error && await canShop(IDS.dealer, dealerTemp2), r.error);

  // --- 9. Inactive / archived customers stay blocked -------------------
  for (const [who, id] of [["inactive", IDS.inactive], ["archived", ARCHIVED]]) {
    r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${id}', 'customer')`, { commit: true });
    ok(`owner can reset ${who} customer`, !r.error, r.error);
    const s = await login(id, "-1 second");
    r = await as(null, null, `select public.complete_password_change('${id}', '${s}')`, { role: "service_role" });
    ok(`${who} customer cannot complete change`, !!r.error);
    ok(`${who} customer no business access after reset`, await deniedShop(id, s));
    await c.query(`update public.customer_profiles set must_change_password = false where id = '${id}'`);
    ok(`${who} customer no business access even without the flag`, await deniedShop(id, s));
  }

  // --- 10. Staff accounts ------------------------------------------------
  const owner2Old = await login(OWNER2, "2 hours");
  ok("owner2 is owner before reset", await isOwner(OWNER2, owner2Old));
  r = await as(IDS.owner, ownerS, `select public.mark_admin_password_reset('${OWNER2}', 'staff')`, { commit: true });
  ok("owner can reset another staff member", !r.error, r.error);
  ok("audit staff_password_reset", (await c.query(`select 1 from public.security_audit_log where action='staff_password_reset' and target_id='${OWNER2}' and target_type='staff'`)).rowCount === 1);
  ok("staff old session loses admin access", !(await isOwner(OWNER2, owner2Old)));
  const owner2Temp = await login(OWNER2, "-1 second");
  ok("staff temp session has no admin access", !(await isOwner(OWNER2, owner2Temp)));
  r = await as(OWNER2, owner2Temp, "select public.current_user_is_owner() as v");
  ok("current_user_is_owner false while must change", r.rows?.[0]?.v === false, JSON.stringify(r));
  r = await as(OWNER2, owner2Temp, `select public.mark_admin_password_reset('${IDS.normal}', 'customer')`);
  ok("staff with temp password cannot reset others", !!r.error);
  r = await as(null, null, `select public.complete_password_change('${OWNER2}', '${owner2Temp}')`, { role: "service_role", commit: true });
  ok("staff change completes and admin access returns", !r.error && await isOwner(OWNER2, owner2Temp), r.error);

  // Staff role checks.
  r = await as(IDS.sales, salesS, "select * from public.get_admin_staff()");
  ok("SALES cannot use OWNER RPCs", !!r.error);
  r = await as(IDS.sales, salesS, "select * from public.get_admin_audit_log()");
  ok("SALES cannot read audit log", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${IDS.sales}', 'Sales X', 'PRODUCT_MANAGER', true)`, { commit: true });
  ok("owner changes staff role", !r.error, r.error);
  const roleEv = (await c.query(`select details from public.security_audit_log where action='staff_role_changed' and target_id='${IDS.sales}'`)).rows[0];
  ok("audit staff_role_changed", roleEv?.details?.from === "SALES" && roleEv.details.to === "PRODUCT_MANAGER", JSON.stringify(roleEv));
  r = await as(IDS.sales, salesS, `select public.update_admin_staff('${IDS.sales}', 'S', 'OWNER', true)`);
  ok("non-owner cannot promote self", !!r.error);
  r = await as(IDS.sales, salesS, `update public.staff_profiles set role = 'OWNER' where id = '${IDS.sales}'`);
  ok("staff cannot update own role directly", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${IDS.owner}', 'Owner', 'SALES', true)`);
  ok("owner cannot demote self", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${IDS.owner}', 'Owner', 'OWNER', false)`);
  ok("owner cannot deactivate self", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${OWNER2}', 'Owner 2', 'OWNER', false)`, { commit: true });
  ok("owner can deactivate another owner", !r.error, r.error);
  ok("audit staff_deactivated", (await c.query(`select 1 from public.security_audit_log where action='staff_deactivated' and target_id='${OWNER2}'`)).rowCount === 1);
  ok("deactivated owner loses access", !(await isOwner(OWNER2, owner2Temp)));
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${OWNER2}', 'Owner 2', 'OWNER', true)`, { commit: true });
  ok("audit staff_activated", !r.error && (await c.query(`select 1 from public.security_audit_log where action='staff_activated' and target_id='${OWNER2}'`)).rowCount === 1);
  // Last active owner protection (owner2 tries to demote owner while being the other owner).
  await c.query(`update public.staff_profiles set active = false where id = '${OWNER2}'`);
  r = await as(IDS.owner, ownerS, `select public.update_admin_staff('${IDS.owner}', 'Owner', 'OWNER', true)`);
  ok("owner can still edit own name", !r.error, r.error);
  await c.query(`update public.staff_profiles set active = true where id = '${OWNER2}'`);
  r = await as(OWNER2, owner2Temp, `select public.update_admin_staff('${IDS.owner}', 'Owner', 'SALES', true)`);
  ok("owner2 may demote owner while owner2 remains", !r.error, r.error);
  // Simulate the last-owner rule directly: owner2 is only owner left → cannot be removed by... (self rule) covered above.

  // Staff creation.
  r = await as(IDS.owner, ownerS, `select public.create_admin_staff_profile('${NEWSTAFF}', 'Yeni', 'WAREHOUSE') as exp`, { commit: true });
  ok("owner creates staff profile", !r.error, r.error);
  const ns = (await c.query(`select * from public.staff_profiles where id = '${NEWSTAFF}'`)).rows[0];
  ok("new staff must change password", ns?.must_change_password === true && ns.role === "WAREHOUSE");
  ok("audit staff_created", (await c.query(`select 1 from public.security_audit_log where action='staff_created' and target_id='${NEWSTAFF}'`)).rowCount === 1);
  r = await as(IDS.owner, ownerS, `select public.create_admin_staff_profile('${NEWSTAFF}', 'Yeni', 'WAREHOUSE')`);
  ok("duplicate staff profile rejected", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.create_admin_staff_profile('${IDS.vip}', 'X', 'SALES')`);
  ok("customer cannot become staff", !!r.error);
  r = await as(IDS.sales, salesS, `select public.create_admin_staff_profile('${IDS.vip}', 'X', 'OWNER')`);
  ok("non-owner cannot create staff", !!r.error);
  const newS = await login(NEWSTAFF, "-1 second");
  r = await as(NEWSTAFF, newS, "select * from public.get_my_account_state()");
  ok("new staff state: must change", r.rows?.[0]?.account_type === "staff" && r.rows[0].must_change_password === true, JSON.stringify(r));

  // --- 11. Security events ------------------------------------------------
  for (const a of ["customer_created", "customer_email_changed", "customer_activated", "customer_deactivated", "customer_archived"]) {
    r = await as(IDS.owner, ownerS, `select public.record_admin_security_event('${a}', '${IDS.vip}')`);
    ok(`event ${a} accepted`, !r.error, r.error);
  }
  r = await as(IDS.owner, ownerS, `select public.record_admin_security_event('customer_email_changed', '${IDS.sales}')`);
  ok("customer event rejects staff target", !!r.error);
  r = await as(IDS.owner, ownerS, `select public.record_admin_security_event('staff_email_changed', '${IDS.sales}')`);
  ok("staff_email_changed accepted", !r.error, r.error);
  r = await as(IDS.owner, ownerS, `select public.record_admin_security_event('password=${MARKER}', '${IDS.vip}')`);
  ok("arbitrary event text rejected", r.error === "Invalid security event");
  r = await as(IDS.sales, salesS, `select public.record_admin_security_event('customer_created', '${IDS.vip}')`);
  ok("non-owner cannot record events", !!r.error);

  // --- 12. Owner with a stale session -----------------------------------
  const ownerOld = await login(IDS.owner, "5 hours");
  r = await as(null, null, `select public.complete_password_change('${IDS.owner}', '${ownerS}')`, { role: "service_role", commit: true });
  ok("owner own change completes", !r.error, r.error);
  ok("owner's changing session keeps access", await isOwner(IDS.owner, ownerS));
  ok("owner's other old session cut off", !(await isOwner(IDS.owner, ownerOld)));
  r = await as(IDS.owner, ownerOld, `select public.mark_admin_password_reset('${IDS.vip}', 'customer')`);
  ok("stale owner session cannot reset passwords", !!r.error);
  r = await as(IDS.owner, ownerOld, `insert into storage.objects (bucket_id, name) values ('product-media', '${pid}/b.jpg')`);
  ok("stale owner session cannot upload media", !!r.error);
  r = await as(IDS.owner, ownerS, `insert into storage.objects (bucket_id, name) values ('product-media', '${pid}/b.jpg')`);
  ok("current owner session can upload media", !r.error, r.error);

  // Grants.
  const grants = (await c.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
      has_function_privilege('authenticated', p.oid, 'execute') auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_my_account_state','complete_password_change','mark_admin_password_reset',
      'get_admin_customer_login','get_admin_staff','create_admin_staff_profile','update_admin_staff','record_admin_security_event')`)).rows;
  ok("no new RPC executable by anon", grants.length === 8 && grants.every((g) => !g.anon), JSON.stringify(grants));
  ok("complete_password_change not executable by authenticated", grants.find((g) => g.proname === "complete_password_change")?.auth === false);
  const dropped = (await c.query(`select proname from pg_proc where proname in ('get_customer_catalog','get_admin_products')`)).rows;
  ok("unused old RPCs dropped", dropped.length === 0, JSON.stringify(dropped));

  await c.end();
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
