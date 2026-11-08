// set_admin_customer_password_state tests (local Postgres only).
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

try {
  const { c } = await createDatabase("pwset_tests");
  await seedUsers(c);
  const ARCH = "00000000-0000-4000-8000-000000000031";
  const PM = "00000000-0000-4000-8000-000000000032";
  await c.query(`
    insert into auth.users (id, email) values ('${ARCH}', 'arch@t'), ('${PM}', 'pm@t');
    insert into public.customer_profiles (id, company_name, contact_name, price_group, active, archived_at)
      values ('${ARCH}', 'Arch', 'A', 'NORMAL', false, now());
    insert into public.staff_profiles (id, full_name, role, active) values ('${PM}', 'PM', 'PRODUCT_MANAGER', true);
    -- VIP starts in the old "temporary password" state.
    update public.customer_profiles set must_change_password = true,
      temporary_password_expires_at = now() + interval '1 day',
      credentials_changed_at = now() - interval '1 hour' where id = '${IDS.vip}';
  `);

  const sess = async (uid, ago = "1 hour") =>
    (await c.query(`insert into auth.sessions (user_id, created_at) values ($1, now() - $2::interval) returning id`, [uid, ago])).rows[0].id;

  async function as(uid, sid, sql, commit = false) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated", aal: "aal1", session_id: sid })]);
      await c.query("set local role authenticated");
      const r = await c.query(sql);
      await c.query(commit ? "commit" : "rollback");
      return { rows: r.rows };
    } catch (e) {
      await c.query("rollback");
      return { error: e.message };
    }
  }

  const ownerS = await sess(IDS.owner);
  const salesS = await sess(IDS.sales);
  const pmS = await sess(PM);
  const vipOld = await sess(IDS.vip, "2 hours");
  const call = (id) => `select public.set_admin_customer_password_state('${id}')`;

  // Authorization.
  for (const [who, uid, sid] of [["SALES", IDS.sales, salesS], ["PRODUCT_MANAGER", PM, pmS], ["customer", IDS.normal, await sess(IDS.normal)]]) {
    const r = await as(uid, sid, call(IDS.vip));
    ok(`${who} denied`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  const anon = await c.query("select has_function_privilege('anon', 'public.set_admin_customer_password_state(uuid)', 'execute') v");
  ok("anon has no execute", anon.rows[0].v === false);

  // Targets.
  const own = await as(IDS.owner, ownerS, call(IDS.owner));
  ok("owner self refused", own.error === "Customer not found", own.error);
  const staff = await as(IDS.owner, ownerS, call(PM));
  ok("staff target refused", staff.error === "Customer not found", staff.error);
  const sales = await as(IDS.owner, ownerS, call(IDS.sales));
  ok("sales staff target refused", sales.error === "Customer not found", sales.error);
  const arch = await as(IDS.owner, ownerS, call(ARCH));
  ok("archived refused", arch.error === "Archived customer cannot be changed", arch.error);
  const none = await as(IDS.owner, ownerS, call("00000000-0000-4000-8000-0000000000ff"));
  ok("missing refused", none.error === "Customer not found", none.error);
  const nul = await as(IDS.owner, ownerS, "select public.set_admin_customer_password_state(null)");
  ok("null refused", nul.error === "Customer not found", nul.error);

  // Stale OWNER session (credentials changed after it) is refused.
  await c.query(`update public.staff_profiles set credentials_changed_at = now() where id = '${IDS.owner}'`);
  const stale = await as(IDS.owner, ownerS, call(IDS.vip));
  ok("stale owner session refused", /Not authorized/.test(stale.error ?? ""), stale.error);
  await c.query(`update public.staff_profiles set credentials_changed_at = null where id = '${IDS.owner}'`);

  // VIP before: temporary state, old session cannot use the catalog.
  const before = await as(IDS.vip, vipOld, "select count(*)::int n from public.get_customer_catalog_page()");
  ok("vip blocked before (must change)", !!before.error || before.rows[0].n === 0, JSON.stringify(before));

  // Success.
  const auditBefore = (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n;
  const done = await as(IDS.owner, ownerS, call(IDS.vip), true);
  ok("owner sets customer password state", !done.error, done.error);
  const p = (await c.query(`select * from public.customer_profiles where id = '${IDS.vip}'`)).rows[0];
  ok("must_change false", p.must_change_password === false);
  ok("expiry cleared", p.temporary_password_expires_at === null);
  ok("credentials_changed_at set", p.credentials_changed_at && Date.now() - new Date(p.credentials_changed_at) < 60000);
  ok("trusted session cleared", p.credentials_session_id === null);
  const audit = (await c.query(`select * from public.security_audit_log where action = 'customer_password_changed' order by id desc limit 1`)).rows[0];
  ok("audit row", audit && audit.actor_user_id === IDS.owner && audit.target_id === IDS.vip && audit.target_type === "customer", JSON.stringify(audit));
  ok("audit has no details", audit && (audit.details === null || !/pass|secret|token/i.test(JSON.stringify(audit.details))), JSON.stringify(audit?.details));
  const auditAll = (await c.query(`select string_agg(coalesce(details::text,''), ' ') t from public.security_audit_log`)).rows[0].t ?? "";
  ok("no password text in any audit details", !/password\"\s*:/.test(auditAll), auditAll.slice(0, 200));
  const auditAfter = (await c.query("select count(*)::int n from public.security_audit_log")).rows[0].n;
  ok("audit rows added (profile update + event)", auditAfter - auditBefore >= 1);

  // Old session: no business access. New session (after change): full access.
  const oldCat = await as(IDS.vip, vipOld, "select count(*)::int n from public.get_customer_catalog_page()");
  ok("old session catalog blocked", !!oldCat.error || oldCat.rows[0].n === 0, JSON.stringify(oldCat));
  const oldCart = await as(IDS.vip, vipOld, "select count(*)::int n from public.get_customer_cart()");
  ok("old session cart blocked", !!oldCart.error || oldCart.rows[0].n === 0, JSON.stringify(oldCart));
  const oldState = await as(IDS.vip, vipOld, "select * from public.get_my_account_state()");
  ok("old session not current", oldState.rows?.[0]?.session_current === false, JSON.stringify(oldState));

  const vipNew = await sess(IDS.vip, "0 seconds");
  const st = await as(IDS.vip, vipNew, "select * from public.get_my_account_state()");
  const s0 = st.rows?.[0];
  ok("new session current, no forced change", s0 && s0.session_current === true && s0.must_change_password === false && s0.temporary_password_expired === false && s0.active === true, JSON.stringify(st));
  const grp = await as(IDS.vip, vipNew, "select private.current_customer_price_group()::text g");
  ok("new session has VIP price group (catalog access)", grp.rows?.[0]?.g === "VIP", JSON.stringify(grp));
  const cat = await as(IDS.vip, vipNew, "select count(*)::int n from public.get_customer_catalog_page()");
  ok("new session catalog RPC works", !cat.error, cat.error);

  // Other customers untouched.
  const others = (await c.query(`select count(*)::int n from public.customer_profiles where id <> '${IDS.vip}' and credentials_changed_at is not null`)).rows[0].n;
  ok("other customers untouched", others === 0, String(others));

  await c.end();
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
