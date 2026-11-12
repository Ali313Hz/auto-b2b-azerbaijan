// Category images, safe category delete and product counts for empty
// categories (local Postgres only).
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
  WAREHOUSE: "00000000-0000-4000-8000-000000000064",
  NORMAL: IDS.normal,
};

try {
  const { c } = await createDatabase("category_media_tests");
  await seedUsers(c);
  await c.query(`
    insert into auth.users (id, email) values ('${U.PM}', 'pm@t'), ('${U.WAREHOUSE}', 'wh@t');
    insert into public.staff_profiles (id, full_name, role, active) values
      ('${U.PM}', 'PM', 'PRODUCT_MANAGER', true), ('${U.WAREHOUSE}', 'WH', 'WAREHOUSE', true);
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
  const mkCat = async (name, slug, parent) =>
    (await run("OWNER", "select public.create_admin_category($1, $2, 0, true, $3) as id", [name, slug, parent])).rows?.[0]?.id;

  const root = await mkCat("İşıqlar", "isiqlar", null);
  const child = await mkCat("LED", "led-x", root);
  const empty = await mkCat("Boş", "bos", null);
  const hidden = await mkCat("Gizli", "gizli", null);
  await c.query("update public.categories set active = false where id = $1", [hidden]);
  ok("categories created", [root, child, empty, hidden].every(Boolean));

  const product = (await run("OWNER", "select public.create_admin_product('LED-1', $1, 5, 10, null, null, null, true) as id", [child])).rows?.[0]?.id;
  const draft = (await run("OWNER", "select public.create_admin_product('LED-2', $1, 5, 10, null, null, null, false) as id", [child])).rows?.[0]?.id;
  ok("products created", Boolean(product && draft));

  // ---- Image
  const goodPath = (id) => `categories/${id}/0f8fad5b-d9cb-469f-a165-70867728950e.webp`;
  let r = await run("OWNER", "select public.set_admin_category_image($1, $2) as old", [root, goodPath(root)]);
  ok("owner sets category image", !r.error && r.rows[0].old === null, JSON.stringify(r));
  r = await run("PM", "select public.set_admin_category_image($1, $2) as old", [root, goodPath(root).replace("0f8f", "1f8f")]);
  ok("PRODUCT_MANAGER replaces image, gets old path back", !r.error && r.rows[0].old === goodPath(root), JSON.stringify(r));
  for (const who of ["SALES", "WAREHOUSE", "NORMAL"]) {
    r = await as(who, "select public.set_admin_category_image($1, null)", [root]);
    ok(`${who} cannot change category image`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  for (const bad of [`categories/${child}/0f8fad5b-d9cb-469f-a165-70867728950e.webp`, `${root}/x.jpg`, `categories/${root}/../x.jpg`, `categories/${root}/0f8fad5b-d9cb-469f-a165-70867728950e.svg`]) {
    r = await as("OWNER", "select public.set_admin_category_image($1, $2)", [root, bad]);
    ok(`bad image path rejected: ${bad.slice(-30)}`, /Invalid category image/.test(r.error ?? ""), JSON.stringify(r));
  }
  r = await as("OWNER", "select public.set_admin_category_image(gen_random_uuid(), null)");
  ok("image on missing category rejected", /Category not found/.test(r.error ?? ""));

  // ---- Lists
  const admin = (await as("OWNER", "select * from public.get_admin_categories()")).rows;
  ok("admin list has image_path", admin.find((x) => x.id === root)?.image_path === goodPath(root).replace("0f8f", "1f8f"));
  ok("admin list counts all products (draft too)", Number(admin.find((x) => x.id === child)?.product_count) === 2);
  ok("admin list shows empty category with 0", Number(admin.find((x) => x.id === empty)?.product_count) === 0);
  r = await as("WAREHOUSE", "select count(*) from public.get_admin_categories()");
  ok("WAREHOUSE can still read the admin list", !r.error);

  const customer = (await as("NORMAL", "select * from public.get_customer_categories()")).rows;
  ok("customer list has image", customer.find((x) => x.id === root)?.image_path?.startsWith(`categories/${root}/`));
  ok("customer count = active products only", Number(customer.find((x) => x.id === child)?.product_count) === 1, JSON.stringify(customer));
  ok("customer sees empty category with 0", Number(customer.find((x) => x.id === empty)?.product_count) === 0);
  ok("inactive category hidden from customer", !customer.some((x) => x.id === hidden));
  r = await as("SALES", "select * from public.get_customer_categories()");
  ok("staff cannot use customer category list", /Active customer profile required/.test(r.error ?? ""));

  // ---- Delete
  r = await as("OWNER", "select public.delete_admin_category($1)", [root]);
  ok("category with sub-categories cannot be deleted", /Category has subcategories/.test(r.error ?? ""), JSON.stringify(r));
  r = await as("OWNER", "select public.delete_admin_category($1)", [child]);
  ok("category with products cannot be deleted", /Category has products/.test(r.error ?? ""), JSON.stringify(r));
  for (const who of ["SALES", "WAREHOUSE", "NORMAL"]) {
    r = await as(who, "select public.delete_admin_category($1)", [empty]);
    ok(`${who} cannot delete categories`, /Not authorized/.test(r.error ?? ""), JSON.stringify(r));
  }
  r = await run("PM", "select public.delete_admin_category($1) as image", [empty]);
  ok("PRODUCT_MANAGER deletes empty category", !r.error && r.rows[0].image === null, JSON.stringify(r));
  ok("empty category gone", (await c.query("select 1 from public.categories where id = $1", [empty])).rowCount === 0);
  const audit = (await c.query("select details from public.security_audit_log where action = 'category_deleted' and target_id = $1", [empty])).rows;
  ok("delete is audited with name", audit.length === 1 && audit[0].details.name === "Boş", JSON.stringify(audit));
  r = await as("OWNER", "select public.delete_admin_category($1)", [empty]);
  ok("deleting twice says not found", /Category not found/.test(r.error ?? ""));

  // Move the products away, then the branch can be deleted bottom-up and the
  // image path comes back for file clean-up.
  await run("OWNER", "select public.update_admin_product_content($1, 'LED-1', null, $2)", [product, hidden]);
  await run("OWNER", "select public.update_admin_product_content($1, 'LED-2', null, $2)", [draft, hidden]);
  r = await run("OWNER", "select public.delete_admin_category($1)", [child]);
  ok("emptied child deleted", !r.error, JSON.stringify(r));
  r = await run("OWNER", "select public.delete_admin_category($1) as image", [root]);
  ok("root deleted after its child, returns image path", !r.error && r.rows[0].image?.startsWith(`categories/${root}/`), JSON.stringify(r));
  ok("products kept their (new) category", (await c.query("select count(*)::int n from public.products where category_id = $1", [hidden])).rows[0].n === 2);

  await c.end();
} catch (error) {
  failures.push(`THROWN: ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
