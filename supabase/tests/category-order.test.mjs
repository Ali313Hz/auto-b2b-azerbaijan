// Per-parent category order, reordering, colours and data preservation
// of the category_order_and_colors migration (local Postgres only).
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const MIGRATION = "20261115100000_category_order_and_colors.sql";
const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  PM: "00000000-0000-4000-8000-000000000062",
  SUPPORT: "00000000-0000-4000-8000-000000000063",
  WAREHOUSE: "00000000-0000-4000-8000-000000000064",
  NORMAL: IDS.normal,
};

try {
  // Database as it is in production before this migration.
  const before = migrationFiles().filter((f) => f < MIGRATION).at(-1);
  const { c } = await createDatabase("category_order_tests", { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.SUPPORT}', 'su@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.SUPPORT}', 'SU', 'SUPPORT', true),
      ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
  `);

  // Start without the demo rows of the first migrations.
  await c.query(`
    delete from public.product_prices; delete from public.product_media; delete from public.products;
    delete from public.categories;
  `);

  // Hand-made looking data: duplicate numbers, gaps, a big number.
  const ins = async (name, sort, parent = null, active = true) =>
    (await c.query(
      "insert into public.categories (name, slug, sort_order, active, parent_id) values ($1, $2, $3, $4, $5) returning id",
      [name, name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 7), sort, active, parent]
    )).rows[0].id;
  const R1 = await ins("Isiqlandirma", 0);
  const R2 = await ins("Aksesuar", 0);
  const R3 = await ins("Salon", 525);
  const R4 = await ins("Elektrik", 3);
  const A = await ins("LED", 2, R1);
  await ins("Halogen", 2, R1);
  const C = await ins("Xenon", 0, R1);
  const D = await ins("Far", 1, A);
  await ins("Stop", 1, A);
  const F = await ins("Dumanlıq", 10, A, false);
  const G = await ins("H7", 4, D);
  await c.query(`
    insert into public.products (sku, name, category_id, stock, active) values
      ('P1', 'P1', '${A}', 3, true), ('P2', 'P2', '${D}', 0, true), ('P3', 'P3', '${G}', 1, false),
      ('P4', 'P4', null, 1, true);
    insert into public.product_prices (product_id, normal_price)
      select id, 10 from public.products p where not exists (select 1 from public.product_prices x where x.product_id = p.id);
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

  const snapshot = async () => ({
    order: (await as("OWNER", "select id from public.get_admin_categories()")).rows.map((r) => r.id),
    // Customers build the tree per parent, so compare each parent's children.
    customerOrder: JSON.stringify(
      Object.entries(
        (await as("NORMAL", "select id, parent_id from public.get_customer_categories()")).rows.reduce(
          (m, r) => ((m[r.parent_id ?? "root"] ??= []).push(r.id), m),
          {}
        )
      ).sort()
    ),
    rows: (await c.query("select id, name, slug, active, parent_id, image_path from public.categories order by id")).rows,
    products: (await c.query("select id, sku, category_id, stock, active from public.products order by id")).rows,
    prices: (await c.query("select count(*)::int n from public.product_prices")).rows[0].n,
  });
  const old = await snapshot();
  ok("old snapshot has every category", old.order.length === 11);

  // ---- Apply this migration (and any later ones) exactly like production.
  for (const file of migrationFiles().filter((f) => f > before)) {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    await c.query("commit");
  }

  const now = await snapshot();
  ok("admin display order unchanged", JSON.stringify(now.order) === JSON.stringify(old.order), JSON.stringify({ old: old.order, now: now.order }));
  ok("customer order unchanged", now.customerOrder === old.customerOrder, now.customerOrder + " vs " + old.customerOrder);
  ok("category rows unchanged (name, slug, active, parent, image)", JSON.stringify(now.rows) === JSON.stringify(old.rows));
  ok("products unchanged", JSON.stringify(now.products) === JSON.stringify(old.products));
  ok("prices unchanged", now.prices === old.prices);

  const sorts = (await c.query("select parent_id, array_agg(sort_order order by sort_order) s from public.categories group by parent_id")).rows;
  ok("siblings numbered 1..n under every parent", sorts.every((r) => r.s.every((v, i) => v === i + 1)), JSON.stringify(sorts));
  const audit = (await c.query("select details from public.security_audit_log where action = 'category_sort_normalized'")).rows;
  ok("old sort numbers kept in the audit log", audit.length === 1 && audit[0].details.previous_sort_order[R3] === 525 && audit[0].details.previous_sort_order[C] === 0, JSON.stringify(audit));

  const children = async (parent) =>
    (await as("OWNER", "select id from public.get_admin_categories() where parent_id is not distinct from $1", [parent])).rows.map((r) => r.id);
  const sortOf = async (id) => (await c.query("select sort_order from public.categories where id = $1", [id])).rows[0].sort_order;

  // Root order now: R1 (0, Isiq..), R2 (0, Aksesuar) -> by name: Aksesuar, Isiqlandirma; then Elektrik (3), Salon (525)
  ok("root order as before", JSON.stringify(await children(null)) === JSON.stringify([R2, R1, R4, R3]));

  // ---- Reorder roots
  let r = await run("OWNER", "select public.move_admin_category($1, 'up') as pos", [R3]);
  ok("root moved up", r.rows?.[0]?.pos === 3, JSON.stringify(r));
  ok("root order after up", JSON.stringify(await children(null)) === JSON.stringify([R2, R1, R3, R4]));
  r = await run("PM", "select public.move_admin_category($1, 'top') as pos", [R4]);
  ok("PRODUCT_MANAGER moves root to top", r.rows?.[0]?.pos === 1);
  ok("root order after top", JSON.stringify(await children(null)) === JSON.stringify([R4, R2, R1, R3]));
  r = await run("OWNER", "select public.move_admin_category($1, 'up') as pos", [R4]);
  ok("first stays first on up", r.rows?.[0]?.pos === 1);
  r = await run("OWNER", "select public.move_admin_category($1, 'bottom') as pos", [R2]);
  ok("root to bottom", r.rows?.[0]?.pos === 4 && JSON.stringify(await children(null)) === JSON.stringify([R4, R1, R3, R2]));
  r = await run("OWNER", "select public.move_admin_category($1, 'down') as pos", [R2]);
  ok("last stays last on down", r.rows?.[0]?.pos === 4);

  // ---- Reorder children: only siblings change.
  const childBefore = await children(R1);
  const otherBefore = (await c.query("select id, sort_order from public.categories where parent_id is distinct from $1 order by id", [R1])).rows;
  r = await run("OWNER", "select public.move_admin_category($1, 'down') as pos", [childBefore[0]]);
  ok("child moved down", r.rows?.[0]?.pos === 2);
  const childAfter = await children(R1);
  ok("child order after down", JSON.stringify(childAfter) === JSON.stringify([childBefore[1], childBefore[0], childBefore[2]]));
  const otherAfter = (await c.query("select id, sort_order from public.categories where parent_id is distinct from $1 order by id", [R1])).rows;
  ok("no category outside the parent changed", JSON.stringify(otherAfter) === JSON.stringify(otherBefore));
  ok("child keeps its parent", (await c.query("select parent_id from public.categories where id = $1", [childBefore[0]])).rows[0].parent_id === R1);
  r = await run("OWNER", "select public.move_admin_category($1, 'top') as pos", [G]);
  ok("only child stays at 1", r.rows?.[0]?.pos === 1);

  const reorderAudit = (await c.query("select count(*)::int n from public.security_audit_log where action = 'category_reordered'")).rows[0].n;
  ok("reorders audited (no-op moves not)", reorderAudit === 4, String(reorderAudit));

  for (const who of ["SALES", "SUPPORT", "WAREHOUSE", "NORMAL"]) {
    r = await as(who, "select public.move_admin_category($1, 'up')", [R1]);
    ok(`${who} cannot reorder`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  r = await as("OWNER", "select public.move_admin_category($1, 'left')", [R1]);
  ok("invalid direction rejected", /Invalid move/.test(r.error ?? ""));
  r = await as("OWNER", "select public.move_admin_category(gen_random_uuid(), 'up')");
  ok("missing category rejected", /Category not found/.test(r.error ?? ""));
  r = await as("OWNER", "select public.move_admin_category($1, $2::text)", [R1, null]);
  ok("null direction rejected", /Invalid move/.test(r.error ?? ""));

  // ---- New and moved categories go to the end of their siblings.
  r = await run("OWNER", "select public.create_admin_category('Yeni', 'yeni', 0, true, $1) as id", [R1]);
  const NEW = r.rows?.[0]?.id;
  ok("new category is last among siblings", (await children(R1)).at(-1) === NEW && (await sortOf(NEW)) === 4);
  r = await run("OWNER", "select public.create_admin_category('Kok', 'kok', 0, true, null) as id");
  ok("new root is last", (await children(null)).at(-1) === r.rows?.[0]?.id);
  r = await run("OWNER", "select public.update_admin_category($1, 'Far', 'far-x', 0, true, $2)", [D, R2]);
  ok("moved category goes to the end of the new parent", !r.error && (await children(R2)).at(-1) === D, JSON.stringify(r));
  ok("its sub-categories moved with it", (await children(D)).includes(G));
  const sortD = await sortOf(D);
  r = await run("OWNER", "select public.update_admin_category($1, 'Far 2', 'far-x', 999, true, $2)", [D, R2]);
  ok("edit without moving keeps the position (typed number ignored)", !r.error && (await sortOf(D)) === sortD);

  // ---- Cycle and depth still blocked.
  r = await as("OWNER", "select public.update_admin_category($1, 'Aksesuar', 'aks', 0, true, $2)", [R2, G]);
  ok("cycle blocked", /cycle/.test(r.error ?? ""), JSON.stringify(r));
  let parent = null;
  const chain = [];
  for (let i = 1; i <= 10; i++) {
    r = await run("OWNER", "select public.create_admin_category($1, $2, 0, true, $3) as id", [`L${i}`, `deep-${i}`, parent]);
    parent = r.rows?.[0]?.id;
    chain.push(parent);
  }
  ok("10 levels deep allowed", chain.every(Boolean));
  r = await as("OWNER", "select public.create_admin_category('L11', 'deep-11', 0, true, $1)", [parent]);
  ok("11th level rejected", /too deep/.test(r.error ?? ""));
  r = await run("OWNER", "select public.move_admin_category($1, 'top')", [chain[9]]);
  ok("deepest category can be reordered", !r.error);
  const deep = (await as("OWNER", "select depth, path, root_id from public.get_admin_categories() where id = $1", [chain[9]])).rows[0];
  ok("deep path and root", deep.depth === 10 && deep.path.startsWith("L1 / L2") && deep.root_id === chain[0], JSON.stringify(deep));

  // ---- Colours
  r = await run("OWNER", "select public.set_admin_category_color($1, '#E11D48')", [R1]);
  ok("owner sets root colour (stored lower case)", !r.error && (await c.query("select color from public.categories where id = $1", [R1])).rows[0].color === "#e11d48");
  const list = (await as("OWNER", "select id, color, root_id from public.get_admin_categories()")).rows;
  ok("children get the root colour in the list", list.filter((x) => x.root_id === R1).every((x) => x.color === "#e11d48"));
  r = await as("OWNER", "select public.set_admin_category_color($1, '#123456')", [childAfter[0]]);
  ok("sub-category colour rejected", /Only main categories/.test(r.error ?? ""));
  for (const bad of ["red", "#12345", "#12345g", "javascript:x"]) {
    r = await as("OWNER", "select public.set_admin_category_color($1, $2)", [R1, bad]);
    ok(`invalid colour rejected: ${bad}`, /Invalid colour/.test(r.error ?? ""));
  }
  r = await run("PM", "select public.set_admin_category_color($1, null)", [R1]);
  ok("colour can be cleared (automatic)", !r.error && (await c.query("select color from public.categories where id = $1", [R1])).rows[0].color === null);
  for (const who of ["SALES", "WAREHOUSE", "NORMAL"]) {
    r = await as(who, "select public.set_admin_category_color($1, '#123456')", [R1]);
    ok(`${who} cannot set colours`, /Not authorized/.test(r.error ?? ""));
  }
  r = await as("NORMAL", "update public.categories set sort_order = 1");
  ok("customer cannot write categories directly", Boolean(r.error));

  // ---- Customer tree follows the same order.
  const cust = (await as("NORMAL", "select id, parent_id from public.get_customer_categories()")).rows;
  const custRoots = cust.filter((x) => !x.parent_id).map((x) => x.id);
  const adminRoots = (await children(null)).filter((id) => custRoots.includes(id));
  ok("customer roots in admin order", JSON.stringify(custRoots) === JSON.stringify(adminRoots), JSON.stringify({ custRoots, adminRoots }));
  ok("inactive category still hidden from customers", !cust.some((x) => x.id === F));

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
  console.log(error.stack);
} finally {
  await server.stop();
}

console.log(`PASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
