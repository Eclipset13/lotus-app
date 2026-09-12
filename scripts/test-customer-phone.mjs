// Run with: node --test scripts/test-customer-phone.mjs
// Database checks use session-local temporary tables only; public data is read-only.
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
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    exports, console, process, Error,
    require: (name) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith("@/components/") || name === "next/link") return {};
      if (name === "./phone" || name === "@/lib/phone") return phone;
      if (name === "@/lib/customers") return customers;
      if (name === "@/lib/customer-scope") return scope;
      return require(name);
    },
  });
  return exports;
}
const phone = loadTs(resolve("src/lib/phone.ts"));
const customers = loadTs(resolve("src/lib/customers.ts"));
const scope = loadTs(resolve("src/lib/customer-scope.ts"));

test("canonical variants and invalid values", () => {
  for (const value of ["+992900123456", "+992 900 123 456", "992900123456", "900123456", "+992 (900) 123-456", " (900) 123-456 "]) {
    assert.equal(phone.normalizePhone(value), "+992900123456");
    assert.equal(phone.normalizePhone(phone.normalizePhone(value)), "+992900123456");
  }
  for (const value of ["+992900111222", "992 900 111 222", "(900) 111-222", "+992 (900)-111-222", "900111222"]) {
    assert.equal(phone.normalizePhone(value), "+992900111222");
  }
  for (const value of ["+992005042828", "992005042828", "005042828", " +992 (005) 042-828 "]) {
    assert.equal(phone.normalizePhone(value), "+992005042828");
    assert.equal(phone.normalizePhone(phone.normalizePhone(value)), "+992005042828");
  }
  assert.equal(phone.normalizePhone("099111222"), "+992099111222");
  assert.equal(phone.normalizePhone("+992090123456"), "+992090123456");
  for (const value of [null, 992900111222, "", "123", "9929001112223", "000000000", "992111111111", "79990001122", "+99200504282", "+9920050428280"]) {
    assert.equal(phone.normalizePhone(value), null);
  }
  for (const value of [
    "abc900123456xyz", "++992900123456", "992+900123456", "900123456+",
    "(+992)900123456", "+900123456", "+79990001122",
    "abc005042828xyz", "++992005042828", "992+005042828", "005042828+",
    ...["/", "_", ".", "@", "#", "!", ":", "\\", "🌷"].map((symbol) => `900${symbol}123456`),
    ...Array.from({ length: 10 }, (_, digit) => String(digit).repeat(9))
      .flatMap((national) => [national, `992${national}`, `+992${national}`]),
  ]) {
    assert.equal(phone.normalizePhone(value), null, value);
  }
});

test("E.164 schema, real unique violation recovery and two orders sharing a user", async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    // Copy the actual users CHECK/UNIQUE constraints, including the E.164 check.
    await client.query(`
      CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL);
      CREATE TEMP TABLE roles (id int, code text);
      CREATE TEMP TABLE user_roles (user_id uuid, role_id int);
      CREATE TEMP TABLE orders (customer_id uuid);
    `);
    let staleRead = true;
    let conflict = null;
    let winner;
    const adapter = {
      query: async (sql, values) => {
        const localSql = sql.replaceAll("public.", "pg_temp.");
        const result = await client.query(localSql, values).catch((error) => {
          conflict = error;
          throw error;
        });
        if (staleRead && sql.includes("SELECT u.id")) {
          staleRead = false;
          // Model another writer appearing after our read, before the savepoint.
          winner = (await client.query("INSERT INTO pg_temp.users (name,phone) VALUES ('Original', '+992900123456') RETURNING id")).rows[0].id;
        }
        return result;
      },
    };
    const first = await customers.findOrCreateCustomer(adapter, "Do not overwrite", "992 900 123 456");
    assert.equal(conflict?.code, "23505");
    assert.equal(conflict?.constraint, "users_phone_key");
    assert.equal(first, winner);
    // These writes also prove the UNIQUE error did not abort the order transaction.
    await client.query("INSERT INTO pg_temp.orders VALUES ($1)", [first]);
    const second = await customers.findOrCreateCustomer(adapter, "Another name", "+992 (900) 123-456");
    await client.query("INSERT INTO pg_temp.orders VALUES ($1)", [second]);
    assert.equal(second, first);
    const saved = (await client.query("SELECT name,phone FROM pg_temp.users")).rows;
    assert.deepEqual(saved, [{ name: "Original", phone: "+992900123456" }]);
    assert.equal((await client.query("SELECT count(DISTINCT customer_id)::int AS n FROM pg_temp.orders")).rows[0].n, 1);
    const fresh = await customers.findOrCreateCustomer(adapter, "New", "901234567");
    assert.equal((await client.query("SELECT phone FROM pg_temp.users WHERE id=$1", [fresh])).rows[0].phone, "+992901234567");
    await client.query("SAVEPOINT invalid_phone");
    await assert.rejects(client.query("INSERT INTO pg_temp.users (name,phone) VALUES ('Invalid', '992902345678')"), (error) => error.code === "23514" && error.constraint === "users_phone_e164_check");
    await client.query("ROLLBACK TO SAVEPOINT invalid_phone");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("existing administrator password login and cookie authentication", async () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousToken = process.env.ADMIN_SESSION_TOKEN;
  process.env.ADMIN_PASSWORD = "test-only-password";
  process.env.ADMIN_SESSION_TOKEN = "test-only-session";
  try {
    const login = loadTs(resolve("src/app/api/admin/login/route.ts"), {
      "@/lib/admin-auth": { ADMIN_COOKIE_NAME: "lotus-admin-session" },
    });
    const rejected = await login.POST({ json: async () => ({ password: "wrong" }) });
    assert.equal(rejected.status, 401);
    const accepted = await login.POST({ json: async () => ({ password: "test-only-password" }) });
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get("set-cookie"), /lotus-admin-session=test-only-session/);
    assert.match(accepted.headers.get("set-cookie"), /HttpOnly/i);
    for (const token of [undefined, "wrong", "test-only-session"]) {
      const auth = loadTs(resolve("src/lib/admin-auth.ts"), {
        "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
      });
      assert.equal(await auth.isAdminAuthenticated(), token === "test-only-session");
    }
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousToken === undefined) delete process.env.ADMIN_SESSION_TOKEN;
    else process.env.ADMIN_SESSION_TOKEN = previousToken;
  }
});

test("legacy reuse, grouped page queries, search, payments and admin exclusion in PostgreSQL", async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  const adapter = { query: (sql, values) => client.query(sql.replaceAll("public.", "pg_temp."), values) };
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(`
      CREATE TEMP TABLE users (id uuid DEFAULT gen_random_uuid(), name text, phone text UNIQUE, created_at timestamptz DEFAULT now(), updated_at timestamptz);
      CREATE TEMP TABLE roles (id int, code text);
      CREATE TEMP TABLE user_roles (user_id uuid, role_id int);
      CREATE TEMP TABLE orders (id int, customer_id uuid, status text, created_at timestamptz, order_number text);
      CREATE TEMP TABLE payments (order_id int, amount numeric, status text);
      CREATE TEMP TABLE customer_addresses (id int, user_id uuid, city text, street_address text, apartment text, entrance text, floor text, is_default boolean, updated_at timestamptz);
      CREATE TEMP TABLE deliveries (order_id int, city text, street_address text, apartment text, entrance text, floor text, recipient_name text, recipient_phone text, created_at timestamptz);
      INSERT INTO roles VALUES (1, 'customer'), (2, 'admin'), (3, 'super_admin');
    `);
    for (const [n, name, value, role] of [[1, "First", "+992900111222", 1], [2, "Alias", "992 900 111 222", 1], [3, "Admin", "992900111222", 2], [4, "Super", "+992 (901) 222-333", 3], [5, "Invalid A", "bad", 1], [6, "Invalid B", "invalid", 1]]) {
      await client.query("INSERT INTO pg_temp.users (id,name,phone,created_at) VALUES ($1,$2,$3,'2026-01-01'::timestamptz + $4 * interval '1 day')", [id(n), name, value, n]);
      await client.query("INSERT INTO pg_temp.user_roles VALUES ($1,$2)", [id(n), role]);
    }
    await client.query(`INSERT INTO pg_temp.orders VALUES
      (1,$1,'completed','2026-02-01','OLD-1'), (2,$2,'new','2026-03-01','OLD-2'),
      (3,$2,'cancelled','2026-04-01','CANCELLED'), (4,$3,'completed','2026-05-01','ADMIN')`, [id(1), id(2), id(3)]);
    await client.query("INSERT INTO pg_temp.payments VALUES (1,10,'paid'),(1,20,'paid'),(2,40,'paid'),(2,90,'pending'),(3,1000,'paid'),(4,5000,'paid')");
    const first = await customers.findOrCreateCustomer(adapter, "First", "992 900 111 222");
    assert.equal(first, id(1));
    assert.equal(await customers.findOrCreateCustomer(adapter, "First", "+992900111222"), first);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_temp.users")).rows[0].n, 6);
    const fresh = await customers.findOrCreateCustomer(adapter, "New", "902333444");
    assert.equal(await customers.findOrCreateCustomer(adapter, "New", "+992 902 333 444"), fresh);
    assert.equal((await client.query("SELECT phone FROM pg_temp.users WHERE id=$1", [fresh])).rows[0].phone, "+992902333444");
    await assert.rejects(customers.findOrCreateCustomer(adapter, "Overwrite", "901222333"), customers.CustomerPhoneConflictError);
    assert.equal((await client.query("SELECT name FROM pg_temp.users WHERE id=$1", [id(4)])).rows[0].name, "Super");

    const map = JSON.stringify(await customers.loadCustomerPhoneMap(adapter));
    const grouped = await adapter.query(`WITH ${scope.customerScopeSql}
      SELECT c.*, oa.order_count, oa.completed_order_count, oa.last_order_at, pa.paid_total
      FROM customer_scope c LEFT JOIN order_aggregates oa ON oa.customer_id=c.id
      LEFT JOIN payment_aggregates pa ON pa.customer_id=c.id`, [map]);
    assert.equal(grouped.rows.length, 3); // One person and two separate invalid identities.
    const person = grouped.rows.find((row) => row.id === id(1));
    assert.equal(person.order_count, 2);
    assert.equal(person.completed_order_count, 1);
    assert.equal(person.paid_total, "70");
    assert.equal(person.last_order_at.toISOString(), "2026-03-01T00:00:00.000Z");
    assert.equal(person.member_ids.length, 2);

    // Execute all actual page SQL, including search, counts, pagination and addresses.
    const page = loadTs(resolve("src/app/admin/customers/page.tsx"), {
      "@/lib/db": { db: adapter },
      "@/lib/admin-auth": { isAdminAuthenticated: async () => true },
      "next/navigation": { redirect: () => { throw new Error("Unexpected redirect"); } },
    });
    for (const q of ["+992900111222", "992 900 111 222", "900111222", "Alias", "OLD-2"]) {
      const tree = await page.default({ searchParams: Promise.resolve({ q }) });
      const rendered = JSON.stringify(tree);
      assert.ok(rendered.includes('"children":"+992900111222"'), q);
      assert.ok(!rendered.includes('"children":"Admin"'), q);
      assert.ok(!rendered.includes('"children":"Email"'), q);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("overlapping checkout callers serialize on the actual PostgreSQL transaction lock", async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const clients = [new pg.Client(), new pg.Client()];
  const users = [];
  let inserts = 0;
  const checkout = async (client, value) => {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    try {
      const result = await customers.findOrCreateCustomer({
        query: async (sql, values) => {
          if (sql.includes("pg_advisory_xact_lock")) return client.query(sql, values);
          if (sql.includes("SELECT u.id")) return { rows: users.slice() };
          if (sql.includes("INSERT INTO")) {
            inserts++;
            const user = { id: "new-id", phone: values[1], is_customer: true };
            users.push(user);
            return { rows: [user] };
          }
          return { rows: [] };
        },
      }, "Concurrent", value);
      await client.query("COMMIT");
      return result;
    } finally {
      await client.end();
    }
  };
  const results = await Promise.all([checkout(clients[0], "+992903444555"), checkout(clients[1], "992 903 444 555")]);
  assert.equal(inserts, 1);
  assert.equal(results[0], results[1]);
});
