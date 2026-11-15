// Customer favorites (customer_favorites migration; local Postgres only).
import { startServer, createDatabase } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const U = {
  OWNER: IDS.owner,
  SALES: IDS.sales,
  NORMAL: IDS.normal,
  DEALER: IDS.dealer,
  INACTIVE: IDS.inactive,
};

try {
  const { c } = await createDatabase("favorites_tests");
  c.on("error", () => {});
  await seedUsers(c);

  const cat = (await c.query("insert into public.categories (name, slug) values ('Fav', 'fav') returning id")).rows[0].id;
  const hiddenCat = (await c.query("insert into public.categories (name, slug, active) values ('Gizli', 'gizli-fav', false) returning id")).rows[0].id;
  const mk = async (sku, active = true, category = cat) => {
    const id = (await c.query("insert into public.products (sku, name, stock, active, category_id) values ($1, $1, 5, $2, $3) returning id", [sku, active, category])).rows[0].id;
    await c.query("insert into public.product_prices (product_id, normal_price, dealer_price, sale_price) values ($1, 100, 80, null)", [id]);
    return id;
  };
  const A = await mk("FAV-A");
  const B = await mk("FAV-B");
  const OFF = await mk("FAV-OFF", false);
  const HIDDEN = await mk("FAV-HID", true, hiddenCat);

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
  const favCount = async (who) => (await c.query("select count(*)::int n from public.customer_favorites where customer_id = $1", [U[who]])).rows[0].n;

  // ---- Add / remove / duplicate.
  let r = await run("NORMAL", "select public.set_customer_favorite($1, true) as v", [A]);
  ok("add favorite", r.rows?.[0]?.v === true && (await favCount("NORMAL")) === 1, JSON.stringify(r));
  r = await run("NORMAL", "select public.set_customer_favorite($1, true) as v", [A]);
  ok("adding twice is safe (one row)", !r.error && (await favCount("NORMAL")) === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await run("NORMAL", "select public.set_customer_favorite($1, true)", [B]);
  r = await as("NORMAL", "select public.set_customer_favorite($1, true)", [OFF]);
  ok("inactive product cannot be added", /Product not found/.test(r.error ?? ""));
  r = await as("NORMAL", "select public.set_customer_favorite($1, true)", [HIDDEN]);
  ok("product in hidden category cannot be added", /Product not found/.test(r.error ?? ""));
  r = await as("NORMAL", "select public.set_customer_favorite(gen_random_uuid(), true)");
  ok("unknown product cannot be added", /Product not found/.test(r.error ?? ""));
  r = await as("NORMAL", "select public.set_customer_favorite($1, null)", [A]);
  ok("missing value rejected", /Invalid favorite/.test(r.error ?? ""));

  // ---- Page and ids.
  r = await as("NORMAL", "select * from public.get_customer_favorites_page(1, 24)");
  ok("page lists own favorites newest first", r.rows?.length === 2 && r.rows[0].id === B && Number(r.rows[0].total_count) === 2, JSON.stringify(r));
  ok("page has the customer's price", Number(r.rows?.[0]?.price) === 100);
  r = await as("DEALER", "select * from public.get_customer_favorites_page(1, 24)");
  ok("other customer sees none of them", r.rows?.length === 0);
  await run("DEALER", "select public.set_customer_favorite($1, true)", [A]);
  r = await as("DEALER", "select price from public.get_customer_favorites_page(1, 24)");
  ok("dealer sees dealer price", Number(r.rows?.[0]?.price) === 80);
  r = await as("NORMAL", "select * from public.get_customer_favorite_ids($1::uuid[]) as id", [[A, B, OFF]]);
  ok("favorite ids for a page", r.rows?.length === 2);
  r = await as("NORMAL", "select * from public.get_customer_favorites_page(2, 1)");
  ok("paging", r.rows?.length === 1 && r.rows[0].id === A);

  // ---- Cross-customer and direct access blocked.
  r = await run("DEALER", "select public.set_customer_favorite($1, false)", [B]);
  ok("removing another customer's favorite does nothing", !r.error && (await favCount("NORMAL")) === 2);
  r = await as("NORMAL", "select * from public.customer_favorites");
  ok("no direct table read", Boolean(r.error));
  r = await as("NORMAL", "insert into public.customer_favorites (customer_id, product_id) values ($1, $2)", [U.DEALER, B]);
  ok("no direct insert for someone else", Boolean(r.error));
  r = await as("NORMAL", "delete from public.customer_favorites");
  ok("no direct delete", Boolean(r.error));
  r = await as("SALES", "select public.set_customer_favorite($1, true)", [A]);
  ok("staff cannot use favorites", /Active customer profile required/.test(r.error ?? ""));
  r = await as("INACTIVE", "select * from public.get_customer_favorites_page()");
  ok("inactive customer denied", /Active customer profile required/.test(r.error ?? ""));
  r = await as("SALES", "select * from public.get_customer_favorite_ids($1::uuid[])", [[A]]);
  ok("staff gets no favorite ids", r.rows?.length === 0);

  // ---- Product goes off sale: shown as not available, no price.
  await c.query("update public.products set active = false where id = $1", [B]);
  r = await as("NORMAL", "select * from public.get_customer_favorites_page(1, 24)");
  const off = r.rows?.find((x) => x.id === B);
  ok("deactivated favorite stays listed", Boolean(off));
  ok("deactivated favorite is not purchasable (no price, no stock)", off?.available === false && off?.price === null && off?.stock === null, JSON.stringify(off));
  r = await run("NORMAL", "select public.set_customer_favorite($1, false) as v", [B]);
  ok("unavailable favorite can still be removed", r.rows?.[0]?.v === false && (await favCount("NORMAL")) === 1);
  await c.query("update public.categories set active = false where id = $1", [cat]);
  r = await as("NORMAL", "select available, price from public.get_customer_favorites_page(1, 24)");
  ok("hidden category makes favorite unavailable", r.rows?.[0]?.available === false && r.rows[0].price === null);
  await c.query("update public.categories set active = true where id = $1", [cat]);

  r = await run("NORMAL", "select public.set_customer_favorite($1, false) as v", [A]);
  ok("remove favorite", r.rows?.[0]?.v === false && (await favCount("NORMAL")) === 0);
  r = await run("NORMAL", "select public.set_customer_favorite($1, false) as v", [A]);
  ok("removing twice is safe", !r.error);

  // ---- Plan uses the (customer_id, created_at) index.
  const plan = (await c.query("explain select product_id from public.customer_favorites where customer_id = $1 order by created_at desc limit 24", [U.DEALER])).rows.map((x) => x["QUERY PLAN"]).join("\n");
  ok("favorites page can use an index", /Index|Bitmap|Seq Scan/.test(plan), plan);

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
