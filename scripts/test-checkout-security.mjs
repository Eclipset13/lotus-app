// Run with: node --test scripts/test-checkout-security.mjs
// All data writes go to session-local temporary tables, never public tables.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import pg from "pg";
import nextEnv from "@next/env";

const require = createRequire(import.meta.url);
function loadTs(file, overrides = {}, cache = new Map()) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports, console, process, Error, Response,
    require: (name) => {
      if (name in overrides) return overrides[name];
      if (name === "server-only") return {};
      if (name === "./phone") name = "@/lib/phone";
      if (name.startsWith("@/")) return loadTs(`src/${name.slice(2)}.ts`, overrides, cache);
      return require(name);
    },
  });
  return exports;
}

function checkout(db) {
  return loadTs("src/app/api/orders/route.ts", { "@/lib/db": { db } }).POST;
}
const catalogItem = { id: "1", quantity: 1, displayedUnitPrice: 100 };
const customItem = {
  itemType: "custom-bouquet", quantity: 1, displayedUnitPrice: 43,
  configuration: {
    schemaVersion: 1, wrappingKind: "blush",
    flowers: [{ id: "rose-1", kind: "rose", position: [0, 0, 0], rotation: [0, 0, 0] }],
  },
};
function orderBody() {
  return {
    customer: { name: "Покупатель", phone: "992 (900) 123-456" },
    fulfillmentType: "delivery", paymentMethod: "cash",
    delivery: { streetAddress: "Рудаки, 1" }, items: [structuredClone(catalogItem)],
  };
}
const submit = (post, body = orderBody()) => post(new Request("http://localhost/api/orders", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const limitedFields = [
  ["customer", "name", 120], ["delivery", "recipientName", 120],
  ["delivery", "streetAddress", 300], ["delivery", "apartment", 50],
  ["delivery", "entrance", 50], ["delivery", "floor", 50],
  [null, "customerComment", 2000], ["delivery", "comment", 2000],
];

test("invalid phones, oversized text and out-of-range bigint IDs fail before connecting", async () => {
  let connections = 0;
  const post = checkout({ connect: () => { connections++; throw new Error("Unexpected database access"); } });
  for (const value of ["abc900123456xyz", "++992900123456", "900/123456", "+79990001122", 900123456, {}]) {
    const body = orderBody();
    body.delivery.recipientPhone = value;
    const response = await submit(post, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Проверьте телефон получателя");
  }
  for (const [parent, field, max] of limitedFields) {
    const body = orderBody();
    (parent ? body[parent] : body)[field] = "я".repeat(max + 1);
    const response = await submit(post, body);
    assert.equal(response.status, 400, field);
    assert.match((await response.json()).message, new RegExp(`максимум ${max} символов`));
  }
  for (const id of ["0", "-1", "01", "1.0", "1e2", "9223372036854775808", "9".repeat(10000), 1]) {
    const body = orderBody();
    body.items[0].id = id;
    assert.equal((await submit(post, body)).status, 400, String(id).slice(0, 30));
  }
  const body = orderBody();
  body.customer.phone = "abc900123456xyz";
  assert.equal((await submit(post, body)).status, 400);
  assert.equal(connections, 0);
  assert.equal(existsSync(resolve("src/app/api/admin/orders/route.ts")), false);
});

async function fixture() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(`
      CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL);
      CREATE TEMP TABLE roles (id int, code text);
      CREATE TEMP TABLE user_roles (user_id uuid, role_id int);
      CREATE TEMP TABLE bouquets (id bigint, name text, sale_price numeric, is_active boolean);
      CREATE TEMP TABLE flowers (id bigint, name text, stock_quantity int);
      CREATE TEMP TABLE bouquet_items (bouquet_id bigint, flower_id bigint, quantity int);
      CREATE TEMP TABLE orders (
        id uuid DEFAULT gen_random_uuid(), order_number text DEFAULT 'TEST-ORDER',
        customer_id uuid, fulfillment_type text, subtotal numeric, discount_amount numeric,
        delivery_cost numeric, total_amount numeric, customer_comment text,
        created_at timestamptz DEFAULT now(), status text DEFAULT 'new'
      );
      CREATE TEMP TABLE order_status_history (order_id uuid, old_status text, new_status text, changed_by uuid, comment text);
      CREATE TEMP TABLE order_items (
        order_id uuid, item_type text, bouquet_id bigint, flower_id bigint, product_name text,
        quantity int, unit_price numeric, unit_cost numeric, bouquet_composition_snapshot jsonb,
        custom_configuration jsonb, custom_summary jsonb
      );
      CREATE TEMP TABLE deliveries (
        order_id uuid, recipient_name text, recipient_phone text, city text, street_address text,
        apartment text, entrance text, floor text, delivery_comment text, requested_at timestamptz
      );
      CREATE TEMP TABLE payments (order_id uuid, method text, status text, amount numeric);
      INSERT INTO bouquets VALUES (1, 'Розы', 100, true), (9223372036854775807, 'Розы', 100, true);
      INSERT INTO flowers VALUES (1, 'Роза', 100);
      INSERT INTO bouquet_items VALUES (1, 1, 3), (9223372036854775807, 1, 3);
    `);
  } catch (error) {
    await client.end();
    throw error;
  }
  const queries = [];
  const query = (sql, values) => {
    queries.push(sql);
    // Reject any accidental stock/reservation operation and keep all SQL local.
    assert.doesNotMatch(sql, /reservation|UPDATE\s+(?:public\.)?flowers|stock_movement/i);
    return client.query(sql.replaceAll("public.", "pg_temp."), values);
  };
  const db = { connect: async () => ({ query, release() {} }) };
  const snapshot = async () => {
    const data = {};
    for (const table of ["users", "orders", "order_items", "payments", "deliveries", "order_status_history", "flowers"]) {
      data[table] = (await client.query(`SELECT * FROM pg_temp.${table}`)).rows;
    }
    return data;
  };
  return { client, query, db, queries, snapshot };
}

test("recipient normalization and fallback, all cart types, text boundaries and bigint maximum", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);
    const variants = ["+992901234567", "992901234567", "901234567", " +992 (901) 234-567 ", "", "   ", undefined, null];
    for (const [index, value] of variants.entries()) {
      const body = orderBody();
      body.customer.phone = `90012345${index}`;
      body.delivery.recipientPhone = value;
      if (index % 3 === 1) body.items = [customItem];
      if (index % 3 === 2) body.items = [catalogItem, customItem];
      if (index === 0) {
        body.items[0].id = "9223372036854775807";
        for (const [parent, field, max] of limitedFields) (parent ? body[parent] : body)[field] = "я".repeat(max);
      }
      const response = await submit(post, body);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result, {
        success: true, message: "Заказ успешно оформлен", orderNumber: "TEST-ORDER",
        totalAmount: [100, 43, 143][index % 3], priceAdjusted: false,
      });
      const saved = (await f.client.query(`
        SELECT d.recipient_phone FROM pg_temp.deliveries d
        JOIN pg_temp.orders o ON o.id=d.order_id JOIN pg_temp.users u ON u.id=o.customer_id
        WHERE u.phone=$1`, [`+992${body.customer.phone}`])).rows;
      assert.equal(saved[0].recipient_phone, index < 4 ? "+992901234567" : `+992${body.customer.phone}`);
    }
    const pickup = orderBody();
    pickup.customer.phone = "902345678";
    pickup.fulfillmentType = "pickup";
    delete pickup.delivery;
    assert.equal((await submit(post, pickup)).status, 200);
    const data = await f.snapshot();
    assert.equal(data.orders.length, 9);
    assert.equal(data.deliveries.length, 8);
    assert.equal(data.order_items.length, 11);
    assert.equal(data.payments.length, 9);
    assert.ok(data.orders.every((order) => order.status === "new"));
    assert.deepEqual(data.flowers, [{ id: "1", name: "Роза", stock_quantity: 100 }]);
    assert.ok(data.order_items.filter((item) => item.item_type === "bouquet").every((item) => item.bouquet_composition_snapshot.flowers[0].quantity === 3));
    assert.ok(data.order_items.filter((item) => item.item_type === "custom_bouquet").every((item) => item.custom_configuration.schemaVersion === 1));
  } finally { await f.client.end(); }
});

test("leading-zero phones are canonical for both customer and recipient, including fallback", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);
    for (const value of ["+992005042828", "992005042828", "005042828"]) {
      const body = orderBody();
      body.customer.phone = value;
      body.delivery.recipientPhone = value;
      assert.equal((await submit(post, body)).status, 200);
    }
    const saved = await f.snapshot();
    assert.equal(saved.users.length, 1);
    assert.equal(saved.users[0].phone, "+992005042828");
    assert.equal(saved.deliveries.length, 3);
    assert.ok(saved.deliveries.every((delivery) => delivery.recipient_phone === "+992005042828"));

    const fallback = orderBody();
    fallback.customer.phone = "005042829";
    assert.equal((await submit(post, fallback)).status, 200);
    const result = await f.client.query(`
      SELECT d.recipient_phone FROM pg_temp.deliveries d
      JOIN pg_temp.orders o ON o.id=d.order_id JOIN pg_temp.users u ON u.id=o.customer_id
      WHERE u.phone='+992005042829'
    `);
    assert.equal(result.rows[0].recipient_phone, "+992005042829");
  } finally { await f.client.end(); }
});

test("fourth order is 429 including cancelled orders; rollback preserves every table; window expires", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);
    for (const phone of ["900123456", "+992900123456", "992 (900) 123-456"]) {
      const body = orderBody();
      body.customer.phone = phone;
      assert.equal((await submit(post, body)).status, 200);
    }
    await f.client.query("UPDATE pg_temp.orders SET status='cancelled'");
    const before = await f.snapshot();
    const response = await submit(post);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "600");
    assert.deepEqual(await response.json(), { success: false, message: "Слишком много заказов. Попробуйте немного позже" });
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(f.queries.at(-1), "ROLLBACK");

    // Exercise rollback even if customer creation happened before the limiter.
    const forcedLimitPost = checkout({ connect: async () => ({
      query: (sql, values) => sql.includes("count(*)") ? { rows: [{ count: 3 }] } : f.query(sql, values),
      release() {},
    }) });
    const fresh = orderBody();
    fresh.customer.phone = "904567890";
    assert.equal((await submit(forcedLimitPost, fresh)).status, 429);
    assert.deepEqual(await f.snapshot(), before);

    const invalid = orderBody();
    invalid.customer.phone = "905678901";
    invalid.delivery.recipientPhone = "bad";
    assert.equal((await submit(post, invalid)).status, 400);
    assert.deepEqual(await f.snapshot(), before);

    await f.client.query("UPDATE pg_temp.orders SET created_at=now() - interval '10 minutes 1 second'");
    assert.equal((await submit(post)).status, 200);
    assert.equal((await f.snapshot()).orders.length, 4);
  } finally { await f.client.end(); }
});

test("overlapping requests for the last slot serialize on real PostgreSQL advisory locks", async () => {
  const f = await fixture();
  const lockClients = [];
  try {
    const seed = checkout(f.db);
    assert.equal((await submit(seed)).status, 200);
    assert.equal((await submit(seed)).status, 200);
    let arrivals = 0;
    let releaseArrivals;
    const bothArrived = new Promise((resolve) => { releaseArrivals = resolve; });
    const post = checkout({ connect: async () => {
      const lockClient = new pg.Client({ connectionTimeoutMillis: 5000, query_timeout: 5000 });
      lockClients.push(lockClient);
      await lockClient.connect();
      let dataTransaction = false;
      return {
        query: async (sql, values) => {
          if (sql.startsWith("BEGIN")) return lockClient.query(sql);
          if (sql.includes("pg_advisory_xact_lock")) {
            arrivals++;
            if (arrivals === 2) releaseArrivals();
            await bothArrived;
            const result = await lockClient.query(sql, values);
            // Temporary tables cannot be shared by PostgreSQL sessions. Execute
            // real data SQL on their owning connection while this caller holds
            // its real transaction lock, committing data before releasing it.
            await f.client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
            dataTransaction = true;
            return result;
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (dataTransaction) await f.client.query(sql);
            dataTransaction = false;
            return lockClient.query(sql);
          }
          if (/INSERT INTO|count\(\*\)/.test(sql)) assert.ok(dataTransaction, "Data writes and limit checks require the phone lock");
          return f.query(sql, values);
        },
        release() {},
      };
    } });
    const alias = orderBody();
    alias.customer.phone = "+992900123456";
    const responses = await Promise.all([submit(post), submit(post, alias)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 429]);
    assert.equal(responses.find((response) => response.status === 429).headers.get("Retry-After"), "600");
    const data = await f.snapshot();
    assert.equal(data.users.length, 1);
    for (const table of ["orders", "order_items", "payments", "deliveries", "order_status_history"]) assert.equal(data[table].length, 3, table);
    assert.equal(data.flowers[0].stock_quantity, 100);
  } finally {
    await Promise.all(lockClients.map((client) => client.end()));
    await f.client.end();
  }
});
