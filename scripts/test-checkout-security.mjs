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
      CREATE TEMP TABLE constructor_wrappings (id bigint, slug text, name text, subtitle text, color text,
        ribbon_color text, sale_price numeric, opacity numeric, sort_order int, is_active boolean);
      CREATE TEMP TABLE flowers (id bigint, name text, stock_quantity int,
        color text, image_url text, sale_price numeric DEFAULT 18, purchase_price numeric DEFAULT 5,
        constructor_kind text, is_active boolean DEFAULT true);
      CREATE TEMP TABLE order_stock_reservations (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid, flower_id bigint,
        quantity int, status text, consumed_at timestamptz, released_at timestamptz, updated_at timestamptz,
        UNIQUE(order_id, flower_id)
      );
      CREATE TEMP TABLE bouquet_items (bouquet_id bigint, flower_id bigint, quantity int);
      CREATE TEMP TABLE orders (
        id uuid DEFAULT gen_random_uuid(), order_number text DEFAULT 'TEST-ORDER',
        customer_id uuid, fulfillment_type text, subtotal numeric, discount_amount numeric,
        delivery_cost numeric, total_amount numeric, customer_comment text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz, status text DEFAULT 'new',
        confirmed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz
      );
      CREATE TEMP TABLE order_status_history (id bigint GENERATED ALWAYS AS IDENTITY,
        order_id uuid, old_status text, new_status text, changed_by uuid, comment text);
      CREATE TEMP TABLE order_items (
        id uuid DEFAULT gen_random_uuid(), order_id uuid, item_type text, bouquet_id bigint, flower_id bigint, product_name text,
        quantity int, unit_price numeric, unit_cost numeric, bouquet_composition_snapshot jsonb,
        custom_configuration jsonb, custom_summary jsonb
      );
      CREATE TEMP TABLE deliveries (
        order_id uuid, recipient_name text, recipient_phone text, city text, street_address text,
        apartment text, entrance text, floor text, delivery_comment text, requested_at timestamptz
      );
      CREATE TEMP TABLE payments (order_id uuid, method text CHECK (method IN ('cash', 'card', 'bank_transfer', 'wallet', 'transfer')), status text, amount numeric);
      INSERT INTO bouquets VALUES (1, 'Розы', 100, true), (9223372036854775807, 'Розы', 100, true);
      INSERT INTO flowers (id, name, stock_quantity, constructor_kind) VALUES (1, 'Роза', 100, 'rose');
      INSERT INTO bouquet_items VALUES (1, 1, 3), (9223372036854775807, 1, 3);
      INSERT INTO constructor_wrappings VALUES (1,'blush','Пудровая','Нежно-розовая','#f4cfc8','#b85d70',25,0.5,10,true);
    `);
  } catch (error) {
    await client.end();
    throw error;
  }
  const queries = [];
  const query = (sql, values) => {
    queries.push(sql);
    // Reject any accidental stock/reservation operation and keep all SQL local.
    assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public\.)?(?:order_stock_reservations|flowers|stock_movements)\b/i);
    return client.query(sql.replaceAll("public.", "pg_temp."), values);
  };
  const db = { connect: async () => ({ query, release() {} }) };
  const snapshot = async () => {
    const data = {};
    for (const table of ["users", "orders", "order_items", "payments", "deliveries", "order_status_history", "flowers", "order_stock_reservations"]) {
      data[table] = (await client.query(`SELECT * FROM pg_temp.${table}`)).rows;
    }
    return data;
  };
  return { client, query, db, queries, snapshot };
}

test("cash and transfer payments are saved, unknown methods are rejected, and payment failures roll back", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);

    const cash = orderBody();
    cash.customer.phone = "906123456";
    cash.deliveryFee = "999.99";
    cash.delivery.deliveryFee = "888.88";
    assert.equal((await submit(post, cash)).status, 200);

    const transfer = orderBody();
    transfer.customer.phone = "907123456";
    transfer.paymentMethod = "transfer";
    assert.equal((await submit(post, transfer)).status, 200);

    const methods = (await f.client.query("SELECT method FROM pg_temp.payments")).rows.map((row) => row.method).sort();
    assert.deepEqual(methods, ["cash", "transfer"]);
    const amounts = await f.client.query(`
      SELECT o.subtotal::text, o.delivery_cost::text, o.total_amount::text,
             p.amount::text AS payment_amount
      FROM pg_temp.orders o JOIN pg_temp.payments p ON p.order_id=o.id
      ORDER BY o.created_at
    `);
    assert.ok(amounts.rows.every((row) =>
      Number(row.subtotal) === 100 &&
      Number(row.delivery_cost) === 0 &&
      Number(row.total_amount) === 100 &&
      Number(row.payment_amount) === 100
    ));

    const unknown = orderBody();
    unknown.customer.phone = "908123456";
    unknown.paymentMethod = "bitcoin";
    assert.equal((await submit(post, unknown)).status, 400);

    const before = await f.snapshot();
    const failingPost = checkout({
      connect: async () => ({
        query: (sql, values) => {
          if (/INSERT INTO\s+(?:public\.)?payments/i.test(sql)) {
            throw new Error("Artificial payment insert failure");
          }
          return f.query(sql, values);
        },
        release() {},
      }),
    });
    const failed = orderBody();
    failed.customer.phone = "909123456";
    failed.paymentMethod = "transfer";
    assert.equal((await submit(failingPost, failed)).status, 500);
    assert.deepEqual(await f.snapshot(), before);
  } finally {
    await f.client.end();
  }
});

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
    assert.equal(data.flowers[0].stock_quantity, 100);
    assert.equal(data.order_stock_reservations.length, 0);
    assert.ok(data.order_items.filter((item) => item.item_type === "bouquet").every((item) => item.bouquet_composition_snapshot.flowers[0].quantity === 3));
    assert.ok(data.order_items.filter((item) => item.item_type === "custom_bouquet").every((item) => item.custom_configuration.schemaVersion === 2));
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

function stockConfig(ids) {
  return { schemaVersion: 2, wrappingKind: "blush", flowers: ids.map((flowerId, index) => ({
    id: `instance-${index}`, flowerId, position: [index * 0.1, 0, -index * 0.1], rotation: [0, index * 0.2, 0],
    // Deliberately forged: checkout must replace every public field from PostgreSQL.
    kind: "rose", snapshot: { name: "Forged", salePrice: 0.01, color: "fake", imageUrl: "/fake.jpg" },
  })) };
}

test("v2 identity, geometry and cart round-trip preserve every variety; legacy conversion is explicit", () => {
  const bouquet = loadTs("src/lib/bouquet.ts");
  const cart = loadTs("src/lib/cart.ts");
  const layout = loadTs("src/lib/bouquet-layout.ts");
  const config = bouquet.sanitizeCustomBouquetConfig(stockConfig(["2", "2", "3"]));
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.flowers.length, 3);
  assert.ok(config.flowers.every((flower) => !flower.kind));
  const moved = layout.resolveFlowerCollisions(config.flowers, "instance-0", layout.getBouquetRadius(config.flowers));
  const distributed = layout.generateEvenBouquetLayout(moved, layout.getBouquetRadius(moved));
  const gathered = layout.alignStemsToAnchor(distributed, layout.getBouquetRadius(distributed));
  assert.deepEqual(gathered.map((flower) => flower.flowerId), config.flowers.map((flower) => flower.flowerId));
  assert.ok(gathered.some((flower, index) => JSON.stringify(flower.position) !== JSON.stringify(config.flowers[index].position)));
  const item = { id: "new", itemType: "custom-bouquet", quantity: 2, unitPrice: 200, configuration: { ...config, flowers: gathered } };
  const legacy = { id: "old", itemType: "custom-bouquet", quantity: 1, unitPrice: 777, configuration: customItem.configuration };
  const roundTrip = cart.sanitizeCartItems(JSON.parse(JSON.stringify(cart.sanitizeCartItems([item, legacy]))));
  assert.equal(roundTrip.length, 2);
  assert.equal(roundTrip[0].unitPrice, 200);
  assert.equal(roundTrip[1].unitPrice, 777);
  assert.equal(roundTrip[1].configuration.schemaVersion, 1);
  assert.equal(JSON.stringify(roundTrip[0].configuration.flowers), JSON.stringify(gathered));
  assert.equal(roundTrip[0].summary.flowers.length, 2);
  assert.equal(bouquet.upgradeLegacyConfiguration(legacy.configuration, {}), null);
  assert.equal(bouquet.upgradeLegacyConfiguration(legacy.configuration, { rose: "2" }).flowers[0].flowerId, "2");
  assert.equal(legacy.configuration.schemaVersion, 1);
  for (const ids of [["0"], ["9223372036854775808"], ["9".repeat(1000)], Array(22).fill("2")]) {
    assert.equal(bouquet.sanitizeCustomBouquetConfig(stockConfig(ids)), null);
  }
  const duplicated = stockConfig(["2", "3"]);
  duplicated.flowers[1].id = duplicated.flowers[0].id;
  assert.equal(bouquet.sanitizeCustomBouquetConfig(duplicated), null);
});

test("constructor wrapping price, activity and immutable order snapshot come from PostgreSQL", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);
    const body = orderBody();
    body.fulfillmentType = "pickup";
    body.customer.phone = "+992900555111";
    body.items = [structuredClone(customItem)];
    body.items[0].displayedUnitPrice = 43;
    await f.client.query("UPDATE pg_temp.constructor_wrappings SET name='Пудровая новая',sale_price=30 WHERE slug='blush'");
    const response = await submit(post, body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalAmount, 48); assert.equal(result.priceAdjusted, true);
    const saved = (await f.client.query("SELECT custom_configuration,custom_summary,unit_price::text FROM pg_temp.order_items")).rows[0];
    assert.equal(saved.unit_price, "48.00");
    assert.equal(saved.custom_configuration.wrappingSnapshot.name, "Пудровая новая");
    assert.equal(saved.custom_configuration.wrappingSnapshot.salePrice, 30);
    assert.equal(saved.custom_summary.wrappingName, "Пудровая новая");
    await f.client.query("UPDATE pg_temp.constructor_wrappings SET name='После заказа',sale_price=99 WHERE slug='blush'");
    const historical = (await f.client.query("SELECT custom_configuration,custom_summary FROM pg_temp.order_items")).rows[0];
    assert.equal(historical.custom_configuration.wrappingSnapshot.name, "Пудровая новая");
    assert.equal(historical.custom_summary.wrappingName, "Пудровая новая");

    const before = await f.snapshot();
    for (const [slug, disable] of [["unknown", false], ["blush", true]]) {
      if (disable) await f.client.query("UPDATE pg_temp.constructor_wrappings SET is_active=false WHERE slug='blush'");
      const invalid = orderBody(); invalid.customer.phone = "+992900555222";
      invalid.items = [structuredClone(customItem)]; invalid.items[0].configuration.wrappingKind = slug;
      assert.equal((await submit(post, invalid)).status, 400);
      if (disable) await f.client.query("UPDATE pg_temp.constructor_wrappings SET is_active=true WHERE slug='blush'");
    }
    const after = await f.snapshot();
    assert.equal(after.orders.length, before.orders.length, "invalid wrapping rolls the whole order back");
  } finally { await f.client.end(); }
});

async function installTemporaryLifecycleTriggers(client) {
  await client.query(`CREATE TEMP TABLE stock_movements (
    id bigint GENERATED ALWAYS AS IDENTITY, flower_id bigint, order_id uuid,
    reservation_id bigint UNIQUE, movement_type text, quantity_change int, unit_cost numeric, note text
  )`);
  // Copy the real trigger implementations into the temporary schema. Public
  // functions and tables remain untouched; all referenced writes are qualified.
  for (const name of ["stock_movements_apply_to_flower", "save_order_status_history"]) {
    const result = await client.query("SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1 AND pronargs=0", [name]);
    assert.equal(result.rows.length, 1);
    const definition = result.rows[0].definition.replaceAll("public.", "pg_temp.")
      .replace(/UPDATE flowers/g, "UPDATE pg_temp.flowers")
      .replace(/INSERT INTO order_status_history/g, "INSERT INTO pg_temp.order_status_history");
    await client.query(definition);
  }
  await client.query(`
    CREATE TRIGGER test_stock AFTER INSERT OR UPDATE OR DELETE ON pg_temp.stock_movements
      FOR EACH ROW EXECUTE FUNCTION pg_temp.stock_movements_apply_to_flower();
    CREATE TRIGGER test_history AFTER UPDATE OF status ON pg_temp.orders
      FOR EACH ROW EXECUTE FUNCTION pg_temp.save_order_status_history();
  `);
}

function statusHandler(f) {
  return loadTs("src/app/api/admin/orders/[id]/status/route.ts", {
    "@/lib/db": { db: { connect: async () => ({
      query: (sql, values) => {
        assert.doesNotMatch(sql, /UPDATE\s+(?:public\.)?flowers\b/i, "Only the stock movement trigger may change physical stock");
        return f.client.query(sql.replaceAll("public.", "pg_temp."), values);
      }, release() {},
    }) } },
    "@/lib/admin-auth": { requirePermission: async () => ({ userId: "00000000-0000-0000-0000-000000000001", roles: ["super_admin"] }), authorizeApi: async () => ({ userId: "00000000-0000-0000-0000-000000000001", roles: ["super_admin"] }) },
    "@/lib/admin-audit": { audit: async () => {} },
    "next/cache": { revalidatePath() {} },
  }).PATCH;
}
const changeStatus = (patch, id, status) => patch(
  new Request("http://localhost/api/admin/orders/test/status", { method: "PATCH", body: JSON.stringify({ status }) }),
  { params: Promise.resolve({ id }) },
);

test("stock assortment, aggregate cart availability, trusted snapshots and exactly-once stock lifecycle", async () => {
  const f = await fixture();
  try {
    await f.client.query("ALTER TABLE pg_temp.flowers ADD COLUMN model_3d jsonb");
    const assignedModel = { assetId: "11111111-1111-4111-8111-111111111111", settings: { scale: 0.7, rotation: [0, 1, 0], offset: [0, 0.2, 0] } };
    await f.client.query("UPDATE pg_temp.flowers SET model_3d=$1::jsonb WHERE id=1", [JSON.stringify(assignedModel)]);
    await f.client.query(`
      INSERT INTO pg_temp.flowers (id, name, stock_quantity, sale_price, color, is_active) VALUES
        (2, 'Хризантема Бакарди', 10, 30, 'Белый', true),
        (3, 'Хризантема Сантини', 9, 40, 'Жёлтый', true),
        (4, 'Эустома', 0, 50, 'Белый', true),
        (5, 'Скрытый сорт', 10, 20, NULL, false),
        (6, 'Гвоздика', 10, 15, NULL, true);
      INSERT INTO pg_temp.order_stock_reservations (order_id,flower_id,quantity,status) VALUES
        ('00000000-0000-0000-0000-000000000001',2,4,'active'),
        ('00000000-0000-0000-0000-000000000002',2,100,'consumed');
    `);
    const stockModule = loadTs("src/lib/constructor-stock.ts", { "@/lib/db": { db: { query: f.query } } });
    const stock = await stockModule.loadConstructorStock();
    assert.equal(stock.flowers.length, 5);
    assert.deepEqual(stock.wrappings.map((item) => item.slug), ["blush"]);
    assert.equal(stock.flowers.find((flower) => flower.id === "2").availableQuantity, 6);
    assert.equal(stock.flowers.find((flower) => flower.id === "4").availableQuantity, 0);
    assert.ok(stock.flowers.every((flower) => !Object.keys(flower).some((key) => /purchase|cost|constructor/i.test(key))));
    const post = checkout(f.db);
    const body = orderBody();
    body.fulfillmentType = "pickup";
    body.items = [{ ...catalogItem, quantity: 2 }, {
      itemType: "custom-bouquet", quantity: 3, displayedUnitPrice: 0.01,
      configuration: stockConfig(["1", "1", "2", "3"]),
    }];
    body.items[1].configuration.flowers[0].snapshot.model = { ...assignedModel, assetId: "22222222-2222-4222-8222-222222222222" };
    await f.client.query("UPDATE pg_temp.flowers SET stock_quantity=11 WHERE id=1");
    const before = await f.snapshot();
    assert.equal((await submit(post, body)).status, 400, "6 catalog roses + 6 custom roses exceed 11");
    assert.deepEqual(await f.snapshot(), before);
    for (const unavailable of ["4", "5", "99999"]) {
      const invalid = orderBody();
      invalid.items = [{ itemType: "custom-bouquet", quantity: 1, configuration: stockConfig([unavailable]) }];
      assert.equal((await submit(post, invalid)).status, 400);
      assert.deepEqual(await f.snapshot(), before);
    }
    await f.client.query("UPDATE pg_temp.bouquets SET is_active=false WHERE id=1");
    assert.equal((await submit(post)).status, 400, "Disabled bouquet in an old cart");
    assert.deepEqual(await f.snapshot(), before);
    await f.client.query("UPDATE pg_temp.bouquets SET is_active=true WHERE id=1");
    await f.client.query("UPDATE pg_temp.flowers SET stock_quantity=12 WHERE id=1");
    const response = await submit(post, body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalAmount, 593);
    assert.equal(result.priceAdjusted, true);
    const data = await f.snapshot();
    const saved = data.order_items.find((item) => item.item_type === "custom_bouquet");
    assert.equal(saved.custom_configuration.schemaVersion, 2);
    assert.deepEqual(saved.custom_configuration.flowers[0].snapshot.model, assignedModel);
    await f.client.query("UPDATE pg_temp.flowers SET model_3d=NULL WHERE id=1");
    const preserved = (await f.snapshot()).order_items.find((item) => item.item_type === "custom_bouquet");
    assert.deepEqual(preserved.custom_configuration.flowers[0].snapshot.model, assignedModel, "Unlink must not change an order's visual snapshot");
    assert.equal(saved.custom_configuration.flowers[2].snapshot.name, "Хризантема Бакарди");
    assert.equal(saved.custom_configuration.flowers[2].snapshot.salePrice, 30);
    assert.deepEqual(saved.custom_configuration.flowers[2].position, body.items[1].configuration.flowers[2].position);
    assert.ok(saved.custom_configuration.flowers.every((flower) => flower.kind === undefined));
    assert.equal(saved.custom_summary.flowers.length, 3);
    assert.equal(data.order_stock_reservations.length, 2, "Checkout creates no reservation");
    assert.equal(data.flowers.find((flower) => flower.id === "1").stock_quantity, 12);
    const orderId = data.orders[0].id;
    await f.client.query("UPDATE pg_temp.flowers SET constructor_kind=NULL WHERE id=1");
    await f.client.query("UPDATE pg_temp.flowers SET constructor_kind='rose' WHERE id=6");
    const { getOrderFlowerRequirements } = loadTs("src/lib/order-flower-requirements.ts", { "@/lib/db": { db: { query: f.query } } });
    const requirements = (await getOrderFlowerRequirements([orderId])).get(orderId);
    assert.deepEqual(Object.fromEntries(requirements.requirements.map((item) => [item.flowerId, item.requiredQuantity])), { "1": 12, "2": 3, "3": 3 });

    await installTemporaryLifecycleTriggers(f.client);
    const patch = statusHandler(f);
    await f.client.query("UPDATE pg_temp.flowers SET stock_quantity=11 WHERE id=1");
    assert.equal((await changeStatus(patch, orderId, "confirmed")).status, 409, "Confirmation rechecks current availability");
    assert.equal((await f.snapshot()).order_stock_reservations.length, 2);
    await f.client.query("UPDATE pg_temp.flowers SET stock_quantity=12 WHERE id=1");
    assert.equal((await changeStatus(patch, orderId, "confirmed")).status, 200);
    assert.equal((await f.snapshot()).flowers.find((flower) => flower.id === "1").stock_quantity, 12);
    assert.equal((await f.snapshot()).order_stock_reservations.filter((row) => row.order_id === orderId).length, 3);
    assert.equal((await changeStatus(patch, orderId, "preparing")).status, 200);
    const prepared = await f.snapshot();
    assert.equal(prepared.flowers.find((flower) => flower.id === "1").stock_quantity, 0);
    assert.equal(prepared.flowers.find((flower) => flower.id === "2").stock_quantity, 7);
    assert.equal(prepared.flowers.find((flower) => flower.id === "3").stock_quantity, 6);
    assert.ok(prepared.order_stock_reservations.filter((row) => row.order_id === orderId).every((row) => row.status === "consumed"));
    assert.equal((await changeStatus(patch, orderId, "preparing")).status, 200);
    assert.deepEqual(await f.snapshot(), prepared);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.stock_movements")).rows[0].n, 3);
  } finally { await f.client.end(); }
});

test("unlinked legacy carts fail explicitly; saved v1 orders and their active allocations stay intact", async () => {
  const f = await fixture();
  try {
    const post = checkout(f.db);
    const body = orderBody();
    body.items = [customItem];
    await f.client.query("UPDATE pg_temp.flowers SET constructor_kind=NULL");
    const before = await f.snapshot();
    const missing = await submit(post, body);
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).message, /выбрать складскую позицию/);
    assert.deepEqual(await f.snapshot(), before);

    const order = (await f.client.query("INSERT INTO pg_temp.orders (fulfillment_type,total_amount,status) VALUES ('pickup',777,'confirmed') RETURNING id")).rows[0];
    await f.client.query("INSERT INTO pg_temp.order_items (order_id,item_type,product_name,quantity,unit_price,custom_configuration,custom_summary) VALUES ($1,'custom_bouquet','Old',1,777,$2,$3)", [order.id, JSON.stringify(customItem.configuration), JSON.stringify({ totalFlowers: 1, roseCount: 1, peonyCount: 0, tulipCount: 0, wrappingName: "Пудровая" })]);
    await f.client.query("INSERT INTO pg_temp.order_stock_reservations (order_id,flower_id,quantity,status) VALUES ($1,1,1,'active')", [order.id]);
    const savedBefore = await f.snapshot();
    const { getOrderFlowerRequirements } = loadTs("src/lib/order-flower-requirements.ts", { "@/lib/db": { db: { query: f.query } } });
    const requirements = (await getOrderFlowerRequirements([order.id])).get(order.id);
    assert.equal(requirements.canCalculate, true);
    assert.equal(requirements.requirements[0].flowerId, "1");
    assert.deepEqual(await f.snapshot(), savedBefore);
    await installTemporaryLifecycleTriggers(f.client);
    assert.equal((await changeStatus(statusHandler(f), order.id, "preparing")).status, 200);
    const data = await f.snapshot();
    assert.equal(data.flowers[0].stock_quantity, 99);
    assert.equal(data.order_items[0].custom_configuration.schemaVersion, 1);
    assert.equal(data.order_items[0].unit_price, "777");
    assert.equal(data.orders[0].total_amount, "777");
  } finally { await f.client.end(); }
});
