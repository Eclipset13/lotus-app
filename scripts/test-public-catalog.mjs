// Run with: node --test scripts/test-public-catalog.mjs
// Database writes use temporary tables only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import pg from "pg";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
function loadTs(file, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(resolve(file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports, console, Error,
    require: (name) => {
      if (name in overrides) return overrides[name];
      if (name === "server-only") return {};
      if (name.startsWith("@/")) return loadTs(`src/${name.slice(2)}.ts`, overrides);
      return require(name);
    },
  });
  return exports;
}

test("public assortment follows admin visibility and edits, and both pages are revalidated", async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(`
      CREATE TEMP TABLE bouquets (
        id bigint, name text, description text, image_url text, sale_price numeric,
        is_featured boolean, is_active boolean, updated_at timestamptz
      );
      CREATE TEMP TABLE bouquet_items (bouquet_id bigint, flower_id bigint, quantity int);
      CREATE TEMP TABLE flowers (id bigint);
      INSERT INTO bouquets VALUES
        (9223372036854775807, 'Visible', 'Description', '/bouquet.jpg', 125.50, true, true, now()),
        (2, 'Hidden', NULL, NULL, 90, false, false, now());
      INSERT INTO flowers VALUES (1);
      INSERT INTO bouquet_items VALUES (9223372036854775807, 1, 3), (2, 1, 2);
    `);
    const query = (sql, values) => client.query(sql.replaceAll("public.", "pg_temp."), values);
    const paths = [];
    const redirected = new Error("Redirect");
    const overrides = {
      "@/lib/db": { db: { query, connect: async () => ({ query, release() {} }) } },
      "@/lib/admin-auth": { isAdminAuthenticated: async () => true },
      "next/cache": { revalidatePath: (path) => paths.push(path) },
      "next/navigation": { redirect: () => { throw redirected; } },
    };
    const { loadPublicBouquets } = loadTs("src/lib/public-bouquets.ts", overrides);
    const actions = loadTs("src/app/admin/products/actions.ts", overrides);
    assert.deepEqual(await loadPublicBouquets(), [{
      id: "9223372036854775807", name: "Visible", description: "Description",
      image_url: "/bouquet.jpg", sale_price: "125.50", is_featured: true,
    }]);

    await actions.toggleProductVisibility("2");
    assert.equal((await loadPublicBouquets()).length, 2);
    assert.deepEqual(paths.splice(0), ["/admin/products", "/", "/catalog"]);
    await actions.toggleProductVisibility("9223372036854775807");
    assert.deepEqual((await loadPublicBouquets()).map((item) => item.id), ["2"]);
    assert.deepEqual(paths.splice(0), ["/admin/products", "/", "/catalog"]);

    const form = new FormData();
    for (const [key, value] of Object.entries({
      name: "Updated", description: "New description", image_url: "/new.jpg", price: "180.25",
      is_active: "on", composition: JSON.stringify([{ flowerId: "1", quantity: 4 }]),
    })) form.set(key, value);
    await assert.rejects(actions.updateProduct("2", { error: "" }, form), (error) => error === redirected);
    assert.deepEqual(await loadPublicBouquets(), [{
      id: "2", name: "Updated", description: "New description", image_url: "/new.jpg",
      sale_price: "180.25", is_featured: false,
    }]);
    assert.deepEqual(paths, ["/admin/products", "/", "/catalog"]);
  } finally { await client.end(); }
});

test("catalog additions use bouquet IDs, merge quantities and preserve custom bouquets", () => {
  const cart = loadTs("src/lib/cart.ts");
  const custom = cart.sanitizeCartItems([{
    id: "custom-1", itemType: "custom-bouquet", quantity: 1,
    configuration: {
      schemaVersion: 1, wrappingKind: "blush",
      flowers: [{ id: "rose-1", kind: "rose", position: [0, 0, 0], rotation: [0, 0, 0] }],
    },
  }])[0];
  const bouquet = { id: "9223372036854775807", name: "Розы", sale_price: "125.50" };
  const first = cart.addCatalogBouquetToCart([custom], bouquet);
  assert.equal(first[0], custom);
  assert.equal(first[1].itemType, "catalog-bouquet");
  assert.equal(first[1].productId, bouquet.id);
  assert.equal(first[1].unitPrice, 125.5);
  const second = cart.addCatalogBouquetToCart(first, { ...bouquet, sale_price: "130" });
  assert.equal(second.length, 2);
  assert.equal(second[1].quantity, 2);
  assert.equal(second[1].unitPrice, 130);
  assert.equal(first[1].quantity, 1);
  const maximum = cart.addCatalogBouquetToCart([{ ...second[1], quantity: 99 }], bouquet);
  assert.equal(maximum[0].quantity, 99);
  assert.equal(cart.sanitizeCartItems(JSON.parse(JSON.stringify(second))).length, 2);
});
