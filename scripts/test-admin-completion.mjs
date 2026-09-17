// Database writes are restricted to connection-local pg_temp tables.
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import nextEnv from "@next/env";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function pageFixture() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query(`
    CREATE TEMP TABLE users (id uuid PRIMARY KEY, name text, phone text, status text, last_login_at timestamptz);
    CREATE TEMP TABLE roles (id smallint PRIMARY KEY, code varchar);
    CREATE TEMP TABLE user_roles (user_id uuid, role_id smallint);
    CREATE TEMP TABLE staff_credentials (user_id uuid PRIMARY KEY, password_hash text);
    CREATE TEMP TABLE staff_sessions (token_hash text PRIMARY KEY, user_id uuid, expires_at timestamptz);
    CREATE TEMP TABLE admin_audit_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_user_id uuid,
      action text, entity_id text, details jsonb, created_at timestamptz
    );
    INSERT INTO users VALUES
      ('00000000-0000-4000-8000-000000000001','Owner','+992900000001','active','2026-09-17 08:00+00'),
      ('00000000-0000-4000-8000-000000000002','Alice Florist','+992900000002','active',NULL),
      ('00000000-0000-4000-8000-000000000003','Bob Courier','+992900000003','blocked',NULL);
    INSERT INTO roles VALUES (1,'super_admin'),(2,'florist'),(3,'inventory_manager'),(4,'courier');
    INSERT INTO user_roles VALUES
      ('00000000-0000-4000-8000-000000000001',1),
      ('00000000-0000-4000-8000-000000000002',2),
      ('00000000-0000-4000-8000-000000000003',4);
    INSERT INTO staff_credentials VALUES ('00000000-0000-4000-8000-000000000001','x'),('00000000-0000-4000-8000-000000000002','x');
    INSERT INTO staff_sessions VALUES
      ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','00000000-0000-4000-8000-000000000002',now()+interval '1 hour');
  `);
  for (let index = 0; index < 27; index++) {
    await client.query(`INSERT INTO pg_temp.admin_audit_log(actor_user_id,action,entity_id,details,created_at)
      VALUES($1,'staff.roles',$2,$3::jsonb,'2026-09-17 10:00+05'::timestamptz + $4::int * interval '1 minute')`,
    [id(1), id(100 + index), JSON.stringify({ before: ["courier"], after: ["florist"], password_hash: "must-not-render" }), index]);
  }
  await client.query(`INSERT INTO pg_temp.admin_audit_log(actor_user_id,action,entity_id,details,created_at)
    VALUES($1,'order.status',$2,'{"before":"new","after":"confirmed"}','2026-09-16 10:00+05')`, [id(2), id(500)]);
  const query = (sql, values) => client.query(sql.replaceAll("public.", "pg_temp."), values);
  return { client, db: { query }, close: () => client.end() };
}

test("audit page is super-admin only and queries one filtered page", async () => {
  const f = await pageFixture();
  try {
    let requiredPermission = "";
    const page = loadTs("src/app/admin/audit/page.tsx", {
      "@/lib/db": { db: f.db },
      "@/lib/admin-auth": { requirePermission: async (permission) => { requiredPermission = permission; return { userId: id(1), roles: ["super_admin"] }; } },
      __stubComponents: true,
    }, { URLSearchParams }).default;
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({
      q: "Owner", action: "staff.roles", entity: "staff", from: "2026-09-17", to: "2026-09-17",
    }) }));
    assert.equal(requiredPermission, "settings.manage");
    assert.equal((html.match(/Создание|Роли сотрудника/g) ?? []).length, 25);
    assert.match(html, /Далее/);
    assert.match(html, /q=Owner/);
    assert.match(html, /action=staff.roles/);
    assert.match(html, /entity=staff/);
    assert.match(html, /from=2026-09-17/);
    assert.match(html, /to=2026-09-17/);
    assert.match(html, /page=2/);

    for (const role of ["florist", "inventory_manager", "courier"]) {
      const forbidden = loadTs("src/app/admin/audit/page.tsx", {
        "@/lib/db": { db: { query: () => { throw new Error("DB must not be touched"); } } },
        "@/lib/admin-auth": { requirePermission: async () => { throw Object.assign(new Error("notFound"), { status: 404, role }); } },
        __stubComponents: true,
      }, { URLSearchParams }).default;
      await assert.rejects(forbidden({ searchParams: Promise.resolve({}) }), (error) => error.status === 404);
    }
  } finally { await f.close(); }
});

test("audit details render nested JSON and remove secret fields", () => {
  const { AuditDetails } = loadTs("src/components/audit-details.tsx");
  const html = renderToStaticMarkup(React.createElement(AuditDetails, { details: {
    before: { roles: ["courier"], nested: { value: 7 } },
    after: { roles: ["florist"] },
    password_hash: "scrypt-secret", session_token: "token-secret", cookie: "cookie-secret",
  } }));
  assert.match(html, /courier/);
  assert.match(html, /florist/);
  assert.match(html, /nested/);
  assert.match(html, />7</);
  assert.doesNotMatch(html, /password|scrypt|session_token|token-secret|cookie/i);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("staff page applies search, role and status filters and exposes session/password state", async () => {
  const f = await pageFixture();
  try {
    const page = loadTs("src/app/admin/staff/page.tsx", {
      "@/lib/db": { db: f.db },
      "@/lib/admin-auth": { requirePermission: async () => ({ userId: id(1), roles: ["super_admin"] }) },
      __stubComponents: true,
    }).default;
    const render = async (params) => renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));
    let html = await render({ q: "Alice" });
    assert.match(html, /Alice Florist/);
    assert.doesNotMatch(html, /Bob Courier/);
    assert.match(html, /Создан/);
    assert.match(html, /Активные сеансы/);
    html = await render({ role: "courier" });
    assert.match(html, /Bob Courier/);
    assert.doesNotMatch(html, /Alice Florist/);
    html = await render({ status: "blocked" });
    assert.match(html, /Bob Courier/);
    assert.match(html, /Доступ отключён/);
    assert.doesNotMatch(html, /Owner/);
  } finally { await f.close(); }
});

async function managementFixture() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query(`
    CREATE TEMP TABLE users (id uuid PRIMARY KEY, name text, phone text UNIQUE, status text, updated_at timestamptz, last_login_at timestamptz);
    CREATE TEMP TABLE roles (id smallint PRIMARY KEY, code varchar UNIQUE);
    CREATE TEMP TABLE user_roles (user_id uuid, role_id smallint, granted_by uuid, granted_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,role_id));
    CREATE TEMP TABLE staff_credentials (user_id uuid PRIMARY KEY, password_hash text, must_change_password boolean, updated_at timestamptz DEFAULT now());
    CREATE TEMP TABLE staff_sessions (token_hash text PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), expires_at timestamptz);
    CREATE TEMP TABLE admin_audit_log (id bigint GENERATED ALWAYS AS IDENTITY, actor_user_id uuid, action text, entity_id text, details jsonb, created_at timestamptz DEFAULT now());
    INSERT INTO users VALUES
      ('00000000-0000-4000-8000-000000000001','Owner','+992900000001','active',now(),NULL),
      ('00000000-0000-4000-8000-000000000002','Worker','+992900000002','active',now(),NULL),
      ('00000000-0000-4000-8000-000000000003','Other','+992900000003','active',now(),NULL);
    INSERT INTO roles VALUES (1,'super_admin'),(2,'florist'),(3,'inventory_manager'),(4,'courier');
    INSERT INTO user_roles(user_id,role_id) VALUES
      ('00000000-0000-4000-8000-000000000001',1),
      ('00000000-0000-4000-8000-000000000002',4),
      ('00000000-0000-4000-8000-000000000003',2);
    INSERT INTO staff_credentials(user_id,password_hash,must_change_password) VALUES
      ('00000000-0000-4000-8000-000000000001','x',false),
      ('00000000-0000-4000-8000-000000000002','x',false),
      ('00000000-0000-4000-8000-000000000003','x',false);
  `);
  const query = (sql, values) => client.query(sql.replaceAll("public.", "pg_temp."), values);
  const db = { query, connect: async () => ({ query, release() {} }) };
  const management = loadTs("src/lib/staff-management.ts", { "@/lib/db": { db } });
  return { client, query, db, management, close: () => client.end() };
}

async function addSession(client, userId, letter) {
  const token = letter.repeat(64);
  await client.query("INSERT INTO pg_temp.staff_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [token, userId]);
  return token;
}

test("session revocation is scoped, idempotent and preserves the actor current session", async () => {
  const f = await managementFixture();
  try {
    await addSession(f.client, id(2), "a");
    await addSession(f.client, id(2), "b");
    await addSession(f.client, id(3), "c");
    let result = await f.management.manageStaff(id(1), { action: "sessions_revoke", userId: id(2) });
    assert.equal(result.changed, true);
    assert.equal(result.revokedSessions, 2);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.staff_sessions WHERE user_id=$1", [id(2)])).rows[0].n, 0);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.staff_sessions WHERE user_id=$1", [id(3)])).rows[0].n, 1);
    result = await f.management.manageStaff(id(1), { action: "sessions_revoke", userId: id(2) });
    assert.equal(result.changed, false);
    assert.equal(result.revokedSessions, 0);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='staff.sessions_revoke'")).rows[0].n, 1);

    const current = await addSession(f.client, id(1), "d");
    await addSession(f.client, id(1), "e");
    result = await f.management.manageStaff(id(1), { action: "sessions_revoke", userId: id(1) }, { currentSessionTokenHash: current });
    assert.equal(result.changed, true);
    assert.equal(result.revokedSessions, 1);
    assert.deepEqual((await f.client.query("SELECT token_hash FROM pg_temp.staff_sessions WHERE user_id=$1", [id(1)])).rows, [{ token_hash: current }]);
  } finally { await f.close(); }
});

test("role/status safety revokes sessions, rejects forged roles and avoids duplicate audit", async () => {
  const f = await managementFixture();
  try {
    await addSession(f.client, id(2), "a");
    let result = await f.management.manageStaff(id(1), { action: "roles", userId: id(2), roles: ["florist"] });
    assert.equal(result.revokedSessions, 1);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.staff_sessions WHERE user_id=$1", [id(2)])).rows[0].n, 0);
    result = await f.management.manageStaff(id(1), { action: "roles", userId: id(2), roles: ["florist"] });
    assert.equal(result.changed, false);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='staff.roles'")).rows[0].n, 1);
    await assert.rejects(f.management.manageStaff(id(1), { action: "roles", userId: id(2), roles: ["unknown"] }), /роль|роли/i);
    await assert.rejects(f.management.manageStaff(id(2), { action: "disable", userId: id(3) }), /прав/i);
    await assert.rejects(f.management.manageStaff(id(1), { action: "disable", userId: id(1) }), /последнего/);
    await assert.rejects(f.management.manageStaff(id(1), { action: "roles", userId: id(1), roles: ["florist"] }), /последнего/);

    await addSession(f.client, id(2), "b");
    result = await f.management.manageStaff(id(1), { action: "disable", userId: id(2) });
    assert.equal(result.revokedSessions, 1);
    assert.equal((await f.client.query("SELECT status FROM pg_temp.users WHERE id=$1", [id(2)])).rows[0].status, "blocked");
  } finally { await f.close(); }
});

test("SQL error rolls back role, session and audit changes", async () => {
  const f = await managementFixture();
  try {
    await addSession(f.client, id(2), "a");
    const failingDb = { connect: async () => ({
      query: (sql, values) => /INSERT INTO public\.admin_audit_log/i.test(sql)
        ? Promise.reject(new Error("Artificial audit failure"))
        : f.query(sql, values),
      release() {},
    }) };
    const management = loadTs("src/lib/staff-management.ts", { "@/lib/db": { db: failingDb } });
    await assert.rejects(management.manageStaff(id(1), { action: "roles", userId: id(2), roles: ["florist"] }), /Artificial/);
    assert.deepEqual((await f.client.query(`SELECT role.code FROM pg_temp.user_roles user_role JOIN pg_temp.roles role ON role.id=user_role.role_id WHERE user_role.user_id=$1`, [id(2)])).rows, [{ code: "courier" }]);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.staff_sessions WHERE user_id=$1", [id(2)])).rows[0].n, 1);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("top actions and role navigation are clean and logout remains POST", async () => {
  const permissions = loadTs("src/lib/permissions.ts");
  const { AdminNavigationLinks } = loadTs("src/components/admin-navigation-links.tsx", {
    "next/navigation": { usePathname: () => "/admin" },
  });
  const tabs = renderToStaticMarkup(React.createElement(AdminNavigationLinks, { roles: ["super_admin"] }));
  assert.match(tabs, /Журнал/);
  assert.doesNotMatch(tabs, />Пароль</);
  assert.doesNotMatch(tabs, />Выйти</);
  assert.equal(permissions.allowedSections(["florist"]).some((item) => ["/admin/staff", "/admin/audit", "/admin/purchases"].includes(item.href)), false);
  assert.equal(permissions.allowedSections(["inventory_manager"]).some((item) => ["/admin/staff", "/admin/audit"].includes(item.href)), false);
  assert.deepEqual(Array.from(permissions.allowedSections(["courier"]), (item) => item.href), ["/admin/deliveries"]);

  const { AdminNavigation } = loadTs("src/components/admin-navigation.tsx", {
    "@/lib/admin-auth": { requireAdminSession: async () => ({ roles: ["super_admin"] }) },
    "next/navigation": { usePathname: () => "/admin" },
  });
  const header = renderToStaticMarkup(await AdminNavigation());
  const positions = ["Открыть магазин", "Пароль", "Выйти"].map((label) => header.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  const logout = readFileSync("src/components/admin-logout-button.tsx", "utf8");
  assert.match(logout, /method:\s*["']POST["']/);
  assert.match(logout, /window\.location\.replace\(["']\/admin\/login["']\)/);
});

test("required administrative mutations have explicit audit actions", () => {
  const sources = [
    "src/app/api/admin/orders/[id]/status/route.ts",
    "src/app/api/admin/orders/[id]/payment/route.ts",
    "src/app/api/admin/orders/[id]/delivery-fee/route.ts",
    "src/app/api/admin/deliveries/[id]/route.ts",
    "src/app/admin/inventory/actions.ts",
    "src/app/api/admin/flowers/[flowerId]/model/route.ts",
    "src/app/admin/products/actions.ts",
    "src/app/admin/purchases/actions.ts",
    "src/lib/staff-management.ts",
    "src/app/admin/password/actions.ts",
    "src/lib/admin-audit.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  for (const action of [
    "order.status", "payment.status", "order.delivery_fee", "delivery.assign", "delivery.status",
    "flower.create", "flower.update", "flower.prices", "flower.model_upload", "flower.model_delete",
    "category.create", "category.update", "bouquet.create", "bouquet.update", "purchase.post",
    "staff.roles", "staff.disable", "staff.enable", "staff.sessions_revoke", "staff.password_change",
  ]) assert.match(sources, new RegExp(action.replace(".", "\\.")), action);
});
