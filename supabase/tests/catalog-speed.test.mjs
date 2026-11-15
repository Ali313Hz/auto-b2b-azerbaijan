// catalog_page_speed migration: the faster catalog returns exactly what the
// previous version returned, for every sort, filter, page and price group.
import fs from "node:fs";
import path from "node:path";

import { startServer, createDatabase, migrationFiles, MIGRATIONS_DIR } from "./db.mjs";
import { IDS, seedUsers } from "./seed.mjs";

const server = await startServer();
let passed = 0;
const failures = [];
const ok = (name, cond, extra = "") => (cond ? passed++ : failures.push(`${name} ${extra}`));

const MIGRATION = "20261115150000_catalog_page_speed.sql";

try {
  const before = migrationFiles().filter((f) => f < MIGRATION).at(-1);
  const { c } = await createDatabase("catalog_speed_tests", { upTo: before });
  c.on("error", () => {});
  await seedUsers(c);

  await c.query(`
    insert into public.categories (name, slug) values ('Ana', 'ana'), ('Gizli', 'gizli');
    update public.categories set active = false where slug = 'gizli';
    insert into public.categories (name, slug, parent_id) select 'Alt', 'alt', id from public.categories where slug = 'ana';
    insert into public.products (sku, name, stock, active, category_id, availability, created_at)
    select 'S-' || g, 'Məhsul ' || (g % 37), g % 7, g % 11 <> 0,
      (select id from public.categories where slug = (array['ana','alt','gizli'])[1 + g % 3]),
      case when g % 5 = 0 then 'COMING_SOON'::public.product_availability else 'IN_STOCK' end,
      now() - g * interval '1 hour'
    from generate_series(1, 300) as g;
    insert into public.product_prices (product_id, normal_price, dealer_price, vip_price, sale_price)
    select id,
      20 + (abs(hashtext(sku)) % 80),
      case when abs(hashtext(sku)) % 3 = 0 then 15 + (abs(hashtext(sku)) % 50) end,
      case when abs(hashtext(sku)) % 4 = 0 then 12 + (abs(hashtext(sku)) % 40) end,
      case when abs(hashtext(sku)) % 5 = 0 then 10 + (abs(hashtext(sku || 's')) % 9) end
    from public.products
    where not exists (select 1 from public.product_prices as pp where pp.product_id = products.id);
  `);

  const who = { NORMAL: IDS.normal, DEALER: IDS.dealer, VIP: IDS.vip };
  const sessions = {};
  for (const [k, id] of Object.entries(who)) {
    sessions[k] = (await c.query("insert into auth.sessions (user_id, created_at) values ($1, now() - interval '1 hour') returning id", [id])).rows[0].id;
  }
  async function as(k, sql, params) {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who[k], role: "authenticated", aal: "aal1", session_id: sessions[k] })]);
      await c.query("set local role authenticated");
      return JSON.stringify((await c.query(sql, params)).rows);
    } catch (e) {
      return `ERROR ${e.message}`;
    } finally {
      await c.query("rollback");
    }
  }

  const calls = [];
  for (const k of Object.keys(who)) {
    for (const sort of ["name", "price_asc", "price_desc", "newest", "sku", "bogus"]) {
      for (const onSale of [false, true]) {
        for (const [cat, sub] of [[null, true], ["ana", true], ["ana", false], ["gizli", true]]) {
          for (const [page, size] of [[1, 24], [3, 24], [1, 100], [99, 24]]) {
            calls.push([k, [page, size, cat, null, sort, sub, onSale]]);
          }
        }
        calls.push([k, [1, 24, null, "Məhsul 1", sort, true, onSale]]);
        calls.push([k, [1, 24, null, "s-1%", sort, true, onSale]]);
      }
    }
  }
  const sql = "select * from public.get_customer_catalog_page($1, $2, $3, $4, $5, $6, $7)";
  const beforeRows = [];
  for (const [k, args] of calls) beforeRows.push(await as(k, sql, args));

  await c.query("begin");
  await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), "utf8"));
  await c.query("commit");

  let same = 0;
  for (let i = 0; i < calls.length; i++) {
    const after = await as(calls[i][0], sql, calls[i][1]);
    if (after === beforeRows[i]) same++;
    else failures.push(`different result for ${calls[i][0]} ${JSON.stringify(calls[i][1])}`);
  }
  ok(`all ${calls.length} catalog calls identical before/after`, same === calls.length);
  const nonEmpty = beforeRows.filter((r) => r.startsWith("[{")).length;
  const errors = beforeRows.filter((r) => r.startsWith("ERROR"));
  ok("no errors", errors.length === 0, errors[0]);
  ok("results are not trivially empty", nonEmpty > calls.length / 3, `${nonEmpty}/${calls.length}`);
  ok("sale filter returns sale items", JSON.parse(await as("NORMAL", sql, [1, 100, null, null, "name", true, true])).every((r) => r.on_sale === true));

  await c.end();
} catch (error) {
  failures.push(`CRASH ${error.stack}`);
} finally {
  await server.stop();
}

console.log(`\nPASSED ${passed}, FAILED ${failures.length}`);
for (const f of failures.slice(0, 20)) console.log("  FAIL:", f);
process.exitCode = failures.length ? 1 : 0;
