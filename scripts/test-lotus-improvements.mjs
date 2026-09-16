// Every SQL write is restricted to this connection's pg_temp tables. No live migration.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "pg";
import nextEnv from "@next/env";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";
import {
  findActiveSuperAdmin,
  formatDatabaseError,
  setExistingSuperAdminPassword,
} from "./helpers/super-admin-password.mjs";

const permissions = loadTs("src/lib/permissions.ts");
const password = loadTs("src/lib/password.ts");
const phoneHelpers = loadTs("src/lib/phone.ts");
const transitions = loadTs("src/lib/order-transitions.ts");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = (body, method = "PATCH") => new Request("http://localhost/api/admin/test", { method, headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (n) => ({ params: Promise.resolve({ id: id(n) }) });
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, String(value)); return data; };

test("group ten stock instances, stable identities, decrement and disappear without changing geometry", () => {
  const { groupFlowerInstances } = loadTs("src/lib/flower-groups.ts");
  const flowers = Array.from({ length: 10 }, (_, n) => ({ id: `instance-${n}`, flowerId: "42", snapshot: { name: "Белая эустома" }, position: [n, 0, 0], rotation: [0, 0, 0] }));
  const before = structuredClone(flowers);
  let groups = groupFlowerInstances(flowers);
  assert.equal(groups.length, 1); assert.equal(groups[0].instances.length, 10);
  assert.equal(groups[0].instances[3], flowers[3]);
  assert.deepEqual(flowers, before);
  assert.equal(groupFlowerInstances(flowers.slice(1))[0].instances.length, 9);
  assert.equal(groupFlowerInstances([]).length, 0);
  groups = groupFlowerInstances([...flowers, { ...flowers[0], id: "other-stock", flowerId: "43" }]);
  assert.equal(groups.length, 2, "Same names must not merge different stock IDs");
  const { FlowerInstanceGroups } = loadTs("src/components/flower-instance-groups.tsx");
  const html = renderToStaticMarkup(React.createElement(FlowerInstanceGroups, { flowers, selectedId: flowers[3].id, onSelect() {} }));
  assert.match(html, /Белая эустома × 10/); assert.match(html, /aria-expanded="false"/);
});

test("navigation grants exactly the permitted sections and additive roles", () => {
  const expected = {
    super_admin: ["/admin", "/admin/products", "/admin/deliveries", "/admin/customers", "/admin/suppliers", "/admin/purchases", "/admin/inventory", "/admin/staff"],
    florist: ["/admin", "/admin/products", "/admin/customers", "/admin/inventory"],
    inventory_manager: ["/admin/suppliers", "/admin/purchases", "/admin/inventory"],
    courier: ["/admin/deliveries"],
  };
  for (const role of permissions.STAFF_ROLES) {
    assert.deepEqual(Array.from(permissions.allowedSections([role]), (s) => s.href), expected[role]);
  }
  assert.equal(permissions.staffHome(["courier"]), "/admin/deliveries");
  assert.equal(permissions.allowedSections(["admin"]).length, 0, "Legacy role is not a backdoor");
  assert.equal(permissions.hasPermission(["florist", "inventory_manager"], "prices.manage"), true);
  assert.equal(permissions.hasPermission(["inventory_manager"], "inventory.manage"), true);
  assert.equal(permissions.hasPermission(["florist"], "inventory.manage"), false);
  assert.equal(permissions.canWorkOrder(["florist"], "preparing", "ready"), true);
  assert.equal(permissions.canWorkOrder(["florist"], "ready", "completed"), false);
  assert.equal(permissions.canWorkOrder(["courier"], "ready", "delivering"), false);
});

test("pickup and delivery UI buttons share the server transition policy", () => {
  const { AdminOrderActions } = loadTs("src/components/admin-order-actions.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "next/link": (props) => React.createElement("a", props),
  });
  const render = (fulfillmentType, roles = ["super_admin"], status = "ready", deliveryStatus = "assigned") => renderToStaticMarkup(React.createElement(AdminOrderActions, {
    roles, canManageDelivery: permissions.hasPermission(roles, "deliveries.manage"), orderId: id(1), orderNumber: "TEST", currentStatus: status, fulfillmentType, deliveryStatus, courierUserId: id(2),
  }));
  assert.doesNotMatch(render("pickup"), /Доставляется|Управлять доставкой/);
  assert.match(render("pickup"), /Выполнен/);
  assert.match(render("delivery"), /Доставляется/);
  assert.doesNotMatch(render("delivery"), /Выполнен/);
  assert.match(render("delivery", ["super_admin"], "delivering", "on_the_way"), /Выполнен/);
  assert.doesNotMatch(render("delivery", ["florist"]), /Доставляется|Управлять доставкой|Выполнен/);
  assert.equal(transitions.canTransitionOrderStatus("ready", "delivering", "pickup"), false);
  assert.equal(transitions.canTransitionOrderStatus("ready", "completed", "pickup"), true);
  assert.equal(transitions.canTransitionOrderStatus("ready", "completed", "delivery"), false);
});

test("storefront links to constructor and renders the complete about section", () => {
  const source = readFileSync("src/components/storefront.tsx", "utf8");
  assert.ok((source.match(/href="\/constructor"/g) ?? []).length >= 3);
  assert.match(source, /id="about"/);
  assert.match(source, /Цветы, собранные с вниманием/);
  assert.match(source, /Lotus — цветочная студия в Душанбе/);
  for (const advantage of ["Свежие цветы", "Индивидуальный подход", "Собственный букет"]) {
    assert.match(source, new RegExp(advantage));
  }
});

async function fixture() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  // All base tables are TEMP; role sequences are also local, never public defaults.
  await client.query(`
    CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL);
    CREATE TEMP TABLE roles (id smallint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, code varchar UNIQUE, name varchar);
    CREATE TEMP TABLE user_roles (user_id uuid REFERENCES pg_temp.users(id), role_id smallint REFERENCES pg_temp.roles(id), granted_by uuid, granted_at timestamptz DEFAULT now(), PRIMARY KEY(user_id,role_id));
    CREATE TEMP TABLE orders (id uuid PRIMARY KEY, order_number text, status varchar, fulfillment_type text, updated_at timestamptz, confirmed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz);
    CREATE TEMP TABLE payments (id uuid PRIMARY KEY, order_id uuid, method varchar, status varchar, amount numeric, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TEMP TABLE deliveries (id uuid PRIMARY KEY, order_id uuid, status varchar, courier_name text, courier_phone text, scheduled_at timestamptz, requested_at timestamptz, courier_cost numeric(12,2), internal_note text, updated_at timestamptz, delivered_at timestamptz,
      recipient_name text,recipient_phone text,city text,street_address text,apartment text,entrance text,floor text,delivery_comment text);
    CREATE TEMP TABLE order_status_history (id bigint GENERATED ALWAYS AS IDENTITY, order_id uuid, old_status varchar, new_status varchar, comment text);
    CREATE FUNCTION pg_temp.test_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO pg_temp.order_status_history(order_id,old_status,new_status) VALUES (NEW.id,OLD.status,NEW.status); RETURN NEW; END $$;
    CREATE TRIGGER test_history AFTER UPDATE OF status ON pg_temp.orders FOR EACH ROW EXECUTE FUNCTION pg_temp.test_history();
    CREATE TEMP TABLE categories (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name varchar(100) UNIQUE NOT NULL,
      slug varchar(120) UNIQUE NOT NULL, sort_order int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true);
    CREATE TEMP TABLE flowers (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, category_id bigint REFERENCES pg_temp.categories(id) ON DELETE SET NULL,
      purchase_price numeric(12,2) NOT NULL, sale_price numeric(12,2) NOT NULL, stock_quantity int NOT NULL,
      min_stock_quantity int DEFAULT 0, updated_at timestamptz, name varchar(140) NOT NULL, slug varchar(160) UNIQUE NOT NULL,
      description text, color varchar(80), is_active boolean DEFAULT true, unit varchar(30) DEFAULT 'шт.', image_url text,
      constructor_kind varchar(20), model_3d jsonb,
      CONSTRAINT flowers_prices_check CHECK (purchase_price>=0 AND sale_price>=0));
    CREATE TEMP TABLE bouquet_items (bouquet_id bigint, flower_id bigint, quantity int);
    CREATE TEMP TABLE order_items (flower_id bigint, custom_configuration jsonb, custom_summary jsonb, bouquet_composition_snapshot jsonb);
    CREATE TEMP TABLE stock_movements (id bigint GENERATED ALWAYS AS IDENTITY, flower_id bigint, supplier_id bigint, purchase_id bigint, movement_type text, quantity_change int, unit_cost numeric, note text);
    CREATE FUNCTION pg_temp.test_stock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE pg_temp.flowers SET stock_quantity=stock_quantity+NEW.quantity_change WHERE id=NEW.flower_id; RETURN NEW; END $$;
    CREATE TRIGGER test_stock AFTER INSERT ON pg_temp.stock_movements FOR EACH ROW EXECUTE FUNCTION pg_temp.test_stock();
    CREATE TEMP TABLE order_stock_reservations (flower_id bigint, quantity int, status text);
    CREATE TEMP TABLE suppliers (id bigint PRIMARY KEY, is_active boolean);
    CREATE TEMP TABLE purchases (id bigint PRIMARY KEY, supplier_id bigint, document_number text, status text, confirmed_at timestamptz,received_at timestamptz,updated_at timestamptz);
    CREATE TEMP TABLE purchase_items (purchase_id bigint,flower_id bigint,quantity int,unit_cost numeric);
  `);
  const migration = readFileSync("src/db/migrations/20260916_staff_access.sql", "utf8").split("-- Use SET lotus.app_role")[0].replaceAll("public.", "pg_temp.") + "\nCOMMIT;";
  await client.query(migration); await client.query(migration);
  await client.query("INSERT INTO pg_temp.users(id,name,phone) VALUES ($1,'Owner','+992900123456'),($2,'Courier A','+992900123457'),($3,'Courier B','+992900123458')", [id(1),id(2),id(3)]);
  for (const [n,role] of [[1,"super_admin"],[2,"courier"],[3,"courier"]]) await client.query("INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE code=$2", [id(n),role]);
  const hash = await password.hashPassword("test-only-password-123");
  for (const n of [1,2,3]) await client.query("INSERT INTO pg_temp.staff_credentials(user_id,password_hash,must_change_password) VALUES ($1,$2,false)", [id(n),hash]);
  let session = { userId: id(1), roles: ["super_admin"], name: "Owner", mustChangePassword: false };
  let token;
  const paths = [];
  const query = (sql, values) => {
    assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|CREATE TABLE)\s+(?!public\.|pg_temp\.|SET\b|OF\b)[a-z]/i, "SQL writes must have an explicit schema");
    return client.query(sql.replaceAll("public.", "pg_temp."), values);
  };
  const db = { query, connect: async () => ({ query, release() {} }) };
  const navigation = { redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); }, notFound: () => { throw Object.assign(new Error("notFound"), { status: 404 }); } };
  const overrides = {
    "@/lib/db": { db }, "next/cache": { revalidatePath: (...args) => paths.push(args) }, "next/navigation": navigation,
    "next/headers": { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
  };
  const auth = loadTs("src/lib/admin-auth.ts", overrides);
  const actionsOverrides = { ...overrides, "@/lib/admin-auth": {
    requirePermission: async (permission) => { if (!session || !permissions.hasPermission(session.roles,permission)) navigation.notFound(); return session; },
    authorizeApi: async (permission) => !session ? Response.json({}, {status:401}) : permissions.hasPermission(session.roles,permission) ? session : Response.json({}, {status:403}),
  } };
  return { client, db, overrides, actionsOverrides, auth, paths,
    setSession: (s) => { session = s; }, setToken: (t) => { token = t; }, close: () => client.end() };
}

test("payment status protects cancelled orders, audits real changes, and respects permissions", async () => {
  const f = await fixture();
  try {
    const paymentRoute = loadTs("src/app/api/admin/orders/[id]/payment/route.ts", f.actionsOverrides);
    await f.client.query("INSERT INTO pg_temp.orders(id,status) VALUES ($1,'cancelled'),($2,'ready'),($3,'ready'),($4,'ready'),($5,'ready')", [id(10), id(11), id(12), id(13), id(14)]);
    await f.client.query("INSERT INTO pg_temp.payments(id,order_id,method,status,amount,created_at) VALUES ($1,$2,'cash','pending',100,'2026-01-01'),($3,$4,'transfer','pending',200,'2026-01-02'),($5,$6,'cash','paid',300,'2026-01-03'),($7,$8,'cash','pending',400,'2026-01-04'),($9,$10,'transfer','refunded',500,'2026-01-05')", [id(20), id(10), id(21), id(11), id(22), id(12), id(23), id(13), id(24), id(14)]);

    let response = await paymentRoute.PATCH(request({ status: "paid" }), ctx(10));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "Нельзя изменить оплату отменённого заказа");
    assert.equal((await f.client.query("SELECT status FROM pg_temp.payments WHERE id=$1", [id(20)])).rows[0].status, "pending");
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='payment.status'")).rows[0].n, 0);

    response = await paymentRoute.PATCH(request({ status: "paid" }), ctx(11));
    assert.equal(response.status, 200);
    assert.equal((await f.client.query("SELECT status FROM pg_temp.payments WHERE id=$1", [id(21)])).rows[0].status, "paid");
    let auditRows = (await f.client.query("SELECT entity_id,details FROM pg_temp.admin_audit_log WHERE action='payment.status'")).rows;
    assert.deepEqual(auditRows, [{ entity_id: id(11), details: { before: "pending", after: "paid", payment_id: id(21), order_id: id(11) } }]);

    response = await paymentRoute.PATCH(request({ status: "paid" }), ctx(12));
    assert.equal(response.status, 200);
    auditRows = (await f.client.query("SELECT entity_id,details FROM pg_temp.admin_audit_log WHERE action='payment.status' ORDER BY id")).rows;
    assert.equal(auditRows.length, 1);

    response = await paymentRoute.PATCH(request({ status: "refunded" }), ctx(13));
    assert.equal(response.status, 409);

    response = await paymentRoute.PATCH(request({ status: "paid" }), ctx(14));
    assert.equal(response.status, 409);
    response = await paymentRoute.PATCH(request({ status: "pending" }), ctx(14));
    assert.equal(response.status, 409);
    response = await paymentRoute.PATCH(request({ status: "refunded" }), ctx(14));
    assert.equal(response.status, 200);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='payment.status'")).rows[0].n, 1);

    response = await paymentRoute.PATCH(request({ status: "unknown" }), ctx(11));
    assert.equal(response.status, 400);

    f.setSession({ userId: id(2), roles: ["courier"] });
    response = await paymentRoute.PATCH(request({ status: "pending" }), ctx(11));
    assert.equal(response.status, 403);
    assert.equal((await f.client.query("SELECT status FROM pg_temp.payments WHERE id=$1", [id(21)])).rows[0].status, "paid");
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='payment.status'")).rows[0].n, 1);

    f.setSession({ userId: id(1), roles: ["super_admin"] });
    const failingRoute = loadTs("src/app/api/admin/orders/[id]/payment/route.ts", {
      ...f.actionsOverrides,
      "@/lib/db": { db: { connect: async () => ({
        query: (sql, values) => /UPDATE public\.payments/i.test(sql)
          ? Promise.reject(new Error("Artificial payment update failure"))
          : f.db.query(sql, values),
        release() {},
      }) } },
    });
    response = await failingRoute.PATCH(request({ status: "pending" }), ctx(11));
    assert.equal(response.status, 500);
    const unchanged = (await f.client.query("SELECT method,amount,status FROM pg_temp.payments WHERE id=$1", [id(21)])).rows[0];
    assert.deepEqual(unchanged, { method: "transfer", amount: "200", status: "paid" });
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='payment.status'")).rows[0].n, 1);
  } finally {
    await f.close();
  }
});

test("cancelled order payment controls are disabled and explain why", () => {
  const { AdminPaymentActions } = loadTs("src/components/admin-payment-actions.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  });
  const html = renderToStaticMarkup(React.createElement(AdminPaymentActions, {
    orderId: id(10), orderStatus: "cancelled", currentStatus: "pending",
  }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  assert.match(html, /Оплата отменённого заказа не изменяется/);
});

test("paid payment shows refund action and refunded payment has no mutation buttons", () => {
  const { AdminPaymentActions } = loadTs("src/components/admin-payment-actions.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  });
  const paid = renderToStaticMarkup(React.createElement(AdminPaymentActions, {
    orderId: id(11), orderStatus: "ready", currentStatus: "paid",
  }));
  assert.match(paid, /Отметить возврат/);
  assert.match(readFileSync("src/components/admin-payment-actions.tsx", "utf8"), /Подтвердить возврат оплаты\? Это действие нельзя отменить\./);
  const refunded = renderToStaticMarkup(React.createElement(AdminPaymentActions, {
    orderId: id(14), orderStatus: "ready", currentStatus: "refunded",
  }));
  assert.match(refunded, /Оплата возвращена/);
  assert.doesNotMatch(refunded, /Отметить возврат|Отметить оплаченным|Вернуть в ожидание/);
});

test("POST logout revokes only the current personal session and clears its cookie", async () => {
  const f = await fixture();
  try {
    const currentToken = password.newSessionToken();
    const otherToken = password.newSessionToken();
    const currentHash = password.hashSessionToken(currentToken);
    const otherHash = password.hashSessionToken(otherToken);
    await f.client.query(`
      INSERT INTO pg_temp.staff_sessions(token_hash,user_id,expires_at)
      VALUES ($1,$2,now()+interval '1 hour'),($3,$2,now()+interval '1 hour')`,
    [currentHash, id(2), otherHash]);
    f.setToken(currentToken);

    const logout = loadTs("src/app/api/admin/logout/route.ts", f.overrides);
    const response = await logout.POST(new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { origin: "http://localhost" },
    }));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "http://localhost/admin/login");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^lotus-admin-session=/);
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970/i);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const remaining = await f.client.query("SELECT token_hash FROM pg_temp.staff_sessions ORDER BY token_hash");
    assert.deepEqual(remaining.rows.map((row) => row.token_hash), [otherHash]);

    f.setToken(currentToken);
    assert.equal(await f.auth.getAdminSession(), null);
    assert.equal((await f.auth.authorizeApi("deliveries.read", request({}))).status, 401);

    f.setToken(otherToken);
    assert.equal((await f.auth.getAdminSession())?.userId, id(2));

    const getResponse = await logout.GET();
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get("allow"), "POST");
    assert.equal((await f.client.query("SELECT count(*)::int AS count FROM pg_temp.staff_sessions")).rows[0].count, 1);
  } finally {
    await f.close();
  }
});

test("logout button posts to the route and never uses a GET link or form action", () => {
  const buttonSource = readFileSync("src/components/admin-logout-button.tsx", "utf8");
  assert.match(buttonSource, /fetch\(["']\/api\/admin\/logout["']/);
  assert.match(buttonSource, /method:\s*["']POST["']/);
  assert.doesNotMatch(buttonSource, /action=["']\/api\/admin\/logout/);

  for (const file of [
    "src/components/admin-navigation-links.tsx",
    "src/app/admin/page.tsx",
    "src/app/admin/password/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(?:action|href)=["']\/api\/admin\/logout["']/, file);
  }

  const { AdminLogoutButton } = loadTs("src/components/admin-logout-button.tsx");
  const html = renderToStaticMarkup(React.createElement(AdminLogoutButton));
  assert.match(html, /<button[^>]*>Выйти<\/button>/);
  assert.doesNotMatch(html, /action=["']\/api\/admin\/logout/);
  assert.equal(readFileSync("src/app/api/admin/logout/route.ts", "utf8").includes("export async function POST"), true);
});

test("CLI helper installs and changes an existing active super_admin password without leaking diagnostics", async () => {
  const f = await fixture();
  try {
    const phone = phoneHelpers.normalizePhone("+992005042828");
    assert.equal(phone, "+992005042828");
    await f.client.query("UPDATE pg_temp.users SET phone=$1, status='active' WHERE id=$2", [phone, id(1)]);
    assert.deepEqual(await findActiveSuperAdmin(f.client, phone, "pg_temp"), { id: id(1) });
    await f.client.query("INSERT INTO pg_temp.staff_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", ["a".repeat(64), id(1)]);

    const firstHash = await password.hashPassword("cli-test-password-one");
    await setExistingSuperAdminPassword(f.client, {
      phone, passwordHash: firstHash, auditSource: "regression_test", schema: "pg_temp",
    });
    let credential = (await f.client.query("SELECT password_hash,must_change_password FROM pg_temp.staff_credentials WHERE user_id=$1", [id(1)])).rows[0];
    assert.equal(await password.verifyPassword("cli-test-password-one", credential.password_hash), true);
    assert.equal(credential.must_change_password, false);
    assert.equal((await f.client.query("SELECT count(*)::int AS count FROM pg_temp.staff_sessions WHERE user_id=$1", [id(1)])).rows[0].count, 0);

    const secondHash = await password.hashPassword("cli-test-password-two");
    await setExistingSuperAdminPassword(f.client, {
      phone, passwordHash: secondHash, auditSource: "regression_test", schema: "pg_temp",
    });
    credential = (await f.client.query("SELECT password_hash FROM pg_temp.staff_credentials WHERE user_id=$1", [id(1)])).rows[0];
    assert.equal(await password.verifyPassword("cli-test-password-one", credential.password_hash), false);
    assert.equal(await password.verifyPassword("cli-test-password-two", credential.password_hash), true);
    const audit = await f.client.query("SELECT actor_user_id::text,entity_id,details FROM pg_temp.admin_audit_log ORDER BY id");
    assert.equal(audit.rows.length, 2);
    assert.deepEqual(audit.rows[0], { actor_user_id: id(1), entity_id: id(1), details: { source: "regression_test" } });

    const diagnostic = formatDatabaseError({
      code: "42P08", table: "admin_audit_log", column: "actor_user_id", constraint: "audit_test",
      message: `failed for 'real-password-placeholder' and scrypt$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`,
    });
    assert.match(diagnostic, /code: 42P08/);
    assert.match(diagnostic, /table: admin_audit_log/);
    assert.doesNotMatch(diagnostic, /real-password-placeholder|scrypt\$|a{32}|b{64}/);
  } finally {
    await f.close();
  }
});

test("idempotent temporary migration, exact decimal price save, no movements or stock change, audited numeric receipt", async () => {
  const f = await fixture();
  try {
    await f.client.query("INSERT INTO pg_temp.flowers(id,name,slug,purchase_price,sale_price,stock_quantity,updated_at) VALUES (1,'Эустома','eustoma',0.10,0.20,3,'2020-01-01')");
    const actions = loadTs("src/app/admin/inventory/actions.ts",f.actionsOverrides);
    const result = await actions.updateFlowerPrices("1",{},form({purchase_price:"12,34",sale_price:"25.50"}));
    assert.equal(result.error, "");
    const flower = (await f.client.query("SELECT * FROM pg_temp.flowers WHERE id=1")).rows[0];
    assert.equal(flower.purchase_price,"12.34"); assert.equal(flower.sale_price,"25.50"); assert.equal(flower.stock_quantity,3);
    assert.ok(flower.updated_at.getFullYear()>=2026);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.stock_movements")).rows[0].n,0);
    assert.ok(f.paths.some(([path,type])=>path==="/" && type==="layout"));
    for (const price of ["-1","NaN","Infinity","1e3","1.234","10000000000","", "0x10"]) {
      assert.ok((await actions.updateFlowerPrices("1",{},form({purchase_price:price,sale_price:"20"}))).error, price);
    }
    await f.client.query("INSERT INTO pg_temp.suppliers VALUES(1,true); INSERT INTO pg_temp.purchases(id,supplier_id,status) VALUES(1,1,'draft'); INSERT INTO pg_temp.purchase_items VALUES(1,1,2,0.15)");
    const purchases = loadTs("src/app/admin/purchases/actions.ts",f.actionsOverrides);
    assert.equal((await purchases.postPurchase("1",{},new FormData())).error, "");
    const updated=(await f.client.query("SELECT purchase_price,stock_quantity FROM pg_temp.flowers WHERE id=1")).rows[0];
    assert.deepEqual(updated,{purchase_price:"7.46",stock_quantity:5});
    assert.ok((await purchases.postPurchase("1",{},new FormData())).error);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.stock_movements")).rows[0].n,1);
    const events=(await f.client.query("SELECT action FROM pg_temp.admin_audit_log ORDER BY id")).rows.map(r=>r.action);
    assert.deepEqual(events,["flower.prices","purchase.post"]);
    f.setSession({userId:id(2),roles:["florist"]});
    await assert.rejects(actions.updateFlowerPrices("1",{},form({purchase_price:"1",sale_price:"2"})),e=>e.status===404);
    await assert.rejects(actions.adjustInventory("1",{},new FormData()),e=>e.status===404);
  } finally { await f.close(); }
});

test("flower and category CRUD validates identity, preserves stock, powers constructor, and keeps legacy v1", async () => {
  const f = await fixture();
  try {
    const actions = loadTs("src/app/admin/inventory/actions.ts", f.actionsOverrides);
    assert.equal((await actions.createCategory({}, form({ name: "Срезанные цветы", slug: "Срезанные цветы", sort_order: "10", is_active: "true" }))).error, "");
    const category = (await f.client.query("SELECT id::text,name,slug FROM pg_temp.categories")).rows[0];
    assert.equal(category.slug, "srezannye-tsvety");

    const createData = form({
      name: "Белая эустома", slug: "Белая Эустома", category_id: category.id,
      description: "Свежий цветок", color: "Белый", unit: "шт.", image_url: "https://example.test/eustoma.jpg",
      min_stock_quantity: "4", is_active: "true", stock_quantity: "999", purchase_price: "100", sale_price: "200",
    });
    await assert.rejects(actions.createFlower({}, createData), (error) => /^\/admin\/inventory\/\d+\?message=created$/.test(error.url ?? ""));
    let flower = (await f.client.query("SELECT * FROM pg_temp.flowers WHERE slug='belaya-eustoma'")).rows[0];
    assert.equal(flower.stock_quantity, 0, "create form must not set physical stock");
    assert.equal(flower.purchase_price, "0.00");
    assert.equal(flower.sale_price, "0.00");
    assert.equal(flower.model_3d, null, "3D model is optional");
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.stock_movements")).rows[0].n, 0);

    const duplicate = await actions.createFlower({}, form({
      name: "Дубликат", slug: "belaya-eustoma", category_id: category.id, unit: "шт.", min_stock_quantity: "0", is_active: "true",
    }));
    assert.match(duplicate.error, /slug/);

    const updateData = form({
      name: "Эустома белая", slug: "eustoma-white", category_id: category.id,
      description: "Обновлено", color: "Молочный", unit: "стебель", image_url: "", min_stock_quantity: "7",
      stock_quantity: "321", constructor_kind: "tulip", purchase_price: "999", sale_price: "999",
    });
    await assert.rejects(actions.updateFlowerDetails(String(flower.id), {}, updateData), (error) => error.url === `/admin/inventory/${flower.id}?message=updated`);
    flower = (await f.client.query("SELECT * FROM pg_temp.flowers WHERE id=$1", [flower.id])).rows[0];
    assert.equal(flower.name, "Эустома белая");
    assert.equal(flower.stock_quantity, 0, "details form must ignore physical stock");
    assert.equal(flower.purchase_price, "0.00", "details form must ignore prices");
    assert.equal(flower.constructor_kind, null, "details form must not manage legacy constructor links");

    const constructor = loadTs("src/lib/constructor-stock.ts", f.overrides);
    let stock = await constructor.loadConstructorStock();
    assert.ok(stock.flowers.some((item) => item.id === String(flower.id)), "active stock flower must appear by flowerId");
    await f.client.query("UPDATE pg_temp.flowers SET constructor_kind='rose' WHERE id=$1", [flower.id]);
    stock = await constructor.loadConstructorStock();
    const legacy = constructor.verifyCustomBouquet({
      schemaVersion: 1, wrappingKind: "blush",
      flowers: [{ id: "legacy-1", kind: "rose", position: [1, 2, 3], rotation: [0, 0, 0] }],
    }, stock.flowers, stock.legacyLinks);
    assert.equal(legacy.schemaVersion, 2);
    assert.equal(legacy.flowers[0].flowerId, String(flower.id));
    assert.deepEqual(Array.from(legacy.flowers[0].position), [1, 2, 3]);

    assert.equal((await actions.setFlowerActivity(String(flower.id), {}, form({ is_active: "false" }))).error, "");
    assert.equal((await f.client.query("SELECT is_active FROM pg_temp.flowers WHERE id=$1", [flower.id])).rows[0].is_active, false);
    assert.ok(!(await constructor.loadConstructorStock()).flowers.some((item) => item.id === String(flower.id)));
    assert.match((await actions.deleteCategory(category.id, {}, new FormData())).error, /используется/);

    f.setSession({ userId: id(2), roles: ["florist"] });
    await assert.rejects(actions.createFlower({}, createData), (error) => error.status === 404);
    await assert.rejects(actions.createCategory({}, form({ name: "Нет", slug: "net", sort_order: "0" })), (error) => error.status === 404);

    const editUi = [
      readFileSync("src/components/admin-flower-details-form.tsx", "utf8"),
      readFileSync("src/app/admin/inventory/[flowerId]/page.tsx", "utf8"),
      readFileSync("src/components/admin-inventory-controls.tsx", "utf8"),
    ].join("\n");
    assert.doesNotMatch(editUi, /constructor_kind/);
    assert.doesNotMatch(readFileSync("src/app/admin/inventory/actions.ts", "utf8"), /updateConstructorKind/);
    const legacySource = readFileSync("src/lib/constructor-stock.ts", "utf8");
    assert.match(legacySource, /constructor_kind/);
    assert.match(legacySource, /upgradeLegacyConfiguration/);
  } finally {
    await f.close();
  }
});

test("flower deletion is confirmed, permission-checked, and refuses every historical dependency", async () => {
  const f = await fixture();
  try {
    const actions = loadTs("src/app/admin/inventory/actions.ts", f.actionsOverrides);
    const insertFlower = async (flowerId, stock = 0, constructorKind = null) => {
      await f.client.query(`INSERT INTO pg_temp.flowers
        (id,name,slug,purchase_price,sale_price,stock_quantity,constructor_kind,updated_at)
        VALUES($1,$2,$3,0,0,$4,$5,now())`, [flowerId, `Цветок ${flowerId}`, `flower-${flowerId}`, stock, constructorKind]);
    };

    await insertFlower(90);
    await assert.rejects(actions.deleteFlower("90", {}, new FormData()), (error) => error.url === "/admin/inventory?message=flower-deleted");
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.flowers WHERE id=90")).rows[0].n, 0);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log WHERE action='flower.delete' AND entity_id='90'")).rows[0].n, 1);
    assert.ok(f.paths.some(([path]) => path === "/admin/inventory"));
    assert.ok(f.paths.some(([path]) => path === "/bouquet-builder"));

    const dependencies = [
      [91, async () => {} , 1, null],
      [92, async () => f.client.query("INSERT INTO pg_temp.bouquet_items VALUES(1,92,1)"), 0, null],
      [93, async () => f.client.query("INSERT INTO pg_temp.purchase_items VALUES(1,93,1,10)"), 0, null],
      [94, async () => f.client.query("INSERT INTO pg_temp.stock_movements(flower_id,movement_type,quantity_change) VALUES(94,'correction',0)"), 0, null],
      [95, async () => f.client.query("INSERT INTO pg_temp.order_stock_reservations VALUES(95,1,'released')"), 0, null],
      [96, async () => f.client.query("INSERT INTO pg_temp.order_items(flower_id) VALUES(96)"), 0, null],
      [97, async () => f.client.query(`INSERT INTO pg_temp.order_items(custom_configuration) VALUES('{"schemaVersion":2,"flowers":[{"flowerId":"97"}]}'::jsonb)`), 0, null],
      [98, async () => f.client.query(`INSERT INTO pg_temp.order_items(custom_summary) VALUES('{"flowers":[{"flowerId":"98"}]}'::jsonb)`), 0, null],
      [99, async () => f.client.query(`INSERT INTO pg_temp.order_items(bouquet_composition_snapshot) VALUES('{"flowers":[{"flowerId":"99"}]}'::jsonb)`), 0, null],
      [100, async () => f.client.query(`INSERT INTO pg_temp.order_items(custom_configuration) VALUES('{"schemaVersion":1,"flowers":[{"kind":"rose"}]}'::jsonb)`), 0, "rose"],
    ];
    for (const [flowerId, addDependency, stock, constructorKind] of dependencies) {
      await insertFlower(flowerId, stock, constructorKind);
      await addDependency();
      const result = await actions.deleteFlower(String(flowerId), {}, new FormData());
      assert.match(result.error, /Отключите его/);
      assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.flowers WHERE id=$1", [flowerId])).rows[0].n, 1);
    }

    await insertFlower(101);
    f.setSession({ userId: id(2), roles: ["florist"] });
    await assert.rejects(actions.deleteFlower("101", {}, new FormData()), (error) => error.status === 404);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.flowers WHERE id=101")).rows[0].n, 1);

    const lifecycleSource = readFileSync("src/components/admin-flower-activity.tsx", "utf8");
    assert.match(lifecycleSource, /Удалить цветок/);
    assert.match(lifecycleSource, /window\.confirm/);
  } finally {
    await f.close();
  }
});

test("direct status API blocks pickup delivering, completes pickup, preserves address delivery chain and courier ownership", async () => {
  const f=await fixture();
  try {
    await f.client.query("INSERT INTO pg_temp.orders(id,order_number,status,fulfillment_type) VALUES ($1,'PICKUP','ready','pickup'),($2,'DELIVERY','ready','delivery'),($3,'LEGACY','ready','delivery')",[id(10),id(11),id(12)]);
    // Include an anomalous old pickup delivery to ensure it cannot bypass the order guard.
    await f.client.query("INSERT INTO pg_temp.deliveries(id,order_id,status,courier_user_id,courier_name) VALUES($1,$2,'assigned',$3,'Courier A'),($4,$5,'assigned',$3,'Courier A')",[id(20),id(10),id(2),id(21),id(11)]);
    await f.client.query("INSERT INTO pg_temp.deliveries(id,order_id,status,courier_name) VALUES($1,$2,'assigned','Legacy courier name')",[id(22),id(12)]);
    const status=loadTs("src/app/api/admin/orders/[id]/status/route.ts",f.actionsOverrides).PATCH;
    const delivery=loadTs("src/app/api/admin/deliveries/[id]/route.ts",f.actionsOverrides).PATCH;
    assert.equal((await status(request({status:"delivering"}),ctx(10))).status,409);
    assert.equal((await delivery(request({action:"status",status:"on_the_way"}),ctx(20))).status,409);
    assert.equal((await status(request({status:"completed"}),ctx(10))).status,200);
    assert.equal((await status(request({status:"completed"}),ctx(11))).status,409);
    assert.equal((await status(request({status:"delivering"}),ctx(12))).status,409, "A legacy text name is not a personal courier assignment");
    f.setSession({userId:id(3),roles:["courier"]});
    assert.equal((await delivery(request({action:"status",status:"on_the_way"}),ctx(21))).status,404);
    assert.equal((await status(request({status:"delivering"}),ctx(11))).status,403);
    f.setSession({userId:id(2),roles:["courier"]});
    assert.equal((await delivery(request({action:"details",courierUserId:id(3)}),ctx(21))).status,403);
    assert.equal((await delivery(request({action:"status",status:"cancelled"}),ctx(21))).status,403);
    assert.equal((await delivery(request({action:"status",status:"on_the_way"}),ctx(21))).status,200);
    assert.equal((await f.client.query("SELECT status FROM pg_temp.orders WHERE id=$1",[id(11)])).rows[0].status,"delivering");
    assert.equal((await delivery(request({action:"status",status:"delivered"}),ctx(21))).status,200);
    assert.equal((await f.client.query("SELECT status FROM pg_temp.orders WHERE id=$1",[id(11)])).rows[0].status,"completed");
    f.setSession({userId:id(1),roles:["super_admin"]});
    await f.client.query("UPDATE pg_temp.orders SET status='ready' WHERE id=$1;",[id(11)]);
    await f.client.query("UPDATE pg_temp.deliveries SET status='planned' WHERE id=$1;",[id(21)]);
    assert.equal((await delivery(request({action:"details",courierUserId:id(2),scheduledAt:"",courierCost:"10,50",internalNote:""}),ctx(21))).status,200);
    assert.equal((await status(request({status:"delivering"}),ctx(11))).status,200);
    assert.equal((await status(request({status:"completed"}),ctx(11))).status,200);
    f.setSession({userId:id(2),roles:["florist"]});
    assert.equal((await status(request({status:"cancelled"}),ctx(11))).status,403);
  } finally {await f.close();}
});

test("personal passwords and opaque hashed sessions, disabled access, resets, expiry, last super protection, rate limits", async () => {
  const f=await fixture();
  try {
    const login=loadTs("src/lib/staff-login.ts",f.overrides).loginStaff;
    const management=loadTs("src/lib/staff-management.ts",f.overrides);
    const logged=await login("900123457","test-only-password-123");
    assert.equal(logged.status,200); assert.equal(logged.redirectTo,"/admin/deliveries");
    assert.match(logged.token,/^[a-f0-9]{64}$/);
    const saved=(await f.client.query("SELECT token_hash FROM pg_temp.staff_sessions")).rows[0];
    assert.notEqual(saved.token_hash,logged.token); assert.equal(saved.token_hash,password.hashSessionToken(logged.token));
    f.setToken(logged.token); assert.equal((await f.auth.getAdminSession()).userId,id(2));
    assert.equal((await f.auth.authorizeApi("inventory.read",request({}))).status,403);
    await assert.rejects(f.auth.requirePermission("staff.manage"),e=>e.status===404);
    await management.manageStaff(id(1),{action:"disable",userId:id(2)});
    assert.equal(await f.auth.getAdminSession(),null);
    assert.equal((await login("900123457","test-only-password-123")).status,401);
    await assert.rejects(management.manageStaff(id(1),{action:"disable",userId:id(1)}),/последнего/);
    await assert.rejects(management.manageStaff(id(1),{action:"roles",userId:id(1),roles:["florist"]}),/последнего/);
    await management.manageStaff(id(1),{action:"enable",userId:id(2)});
    await management.manageStaff(id(1),{action:"password_reset",userId:id(2),password:"temporary-new-password"});
    assert.equal((await login("900123457","test-only-password-123")).status,401);
    const temporary=await login("900123457","temporary-new-password");
    assert.equal(temporary.status,200); assert.equal(temporary.redirectTo,"/admin/password");
    f.setToken(temporary.token);
    assert.equal((await f.auth.authorizeApi("deliveries.read",request({}))).status,403);
    await assert.rejects(f.auth.requireAdminSession(),e=>e.url==="/admin/password");
    let deletedCookie = "";
    const passwordAction = loadTs("src/app/admin/password/actions.ts", {
      ...f.overrides,
      "@/lib/admin-auth": { requireAdminSession: async () => ({ userId: id(2), roles: ["courier"], mustChangePassword: true }), ADMIN_COOKIE_NAME: "lotus-admin-session" },
      "next/headers": { cookies: async () => ({ delete: (name) => { deletedCookie = name; } }) },
    }).changeOwnPassword;
    await assert.rejects(passwordAction({error:""},form({currentPassword:"temporary-new-password",password:"personal-new-password",confirmation:"personal-new-password"})),e=>e.url==="/admin/login?passwordChanged=1");
    assert.equal(deletedCookie,"lotus-admin-session");
    assert.equal(await f.auth.getAdminSession(),null,"Changing a temporary password revokes the current session");
    assert.equal((await login("900123457","temporary-new-password")).status,401);
    const personal=await login("900123457","personal-new-password");
    assert.equal(personal.status,200);assert.equal(personal.redirectTo,"/admin/deliveries");
    await management.manageStaff(id(1),{action:"password_reset",userId:id(2),password:"temporary-again-password"});
    const temporaryAgain=await login("900123457","temporary-again-password");
    f.setToken(temporaryAgain.token);
    await management.manageStaff(id(1),{action:"sessions_revoke",userId:id(2)});
    assert.equal(await f.auth.getAdminSession(),null);
    const hash=(await f.client.query("SELECT password_hash FROM pg_temp.staff_credentials WHERE user_id=$1",[id(2)])).rows[0].password_hash;
    assert.match(hash,/^scrypt\$/); assert.doesNotMatch(hash,/temporary-new-password/);
    const another=await password.hashPassword("temporary-new-password"); assert.notEqual(hash,another);
    assert.equal(await password.verifyPassword("wrong-password",hash),false);
    f.setToken("old-static-session-token"); assert.equal(await f.auth.getAdminSession(),null);
    const owner=await login("900123456","test-only-password-123"); f.setToken(owner.token);
    await f.client.query("UPDATE pg_temp.staff_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day'");
    assert.equal(await f.auth.getAdminSession(),null);
    for(let n=0;n<5;n++)assert.equal((await login("900777888","wrong-password")).status,401);
    assert.equal((await login("900777888","wrong-password")).status,429);
    const audit=(await f.client.query("SELECT details::text FROM pg_temp.admin_audit_log")).rows;
    assert.doesNotMatch(JSON.stringify(audit),/password_hash|temporary-new-password|token_hash|cookie|scrypt/);
    await management.manageStaff(id(1),{action:"create",name:"Second owner",phone:"900123459",roles:["super_admin","inventory_manager"],password:"temporary-second-owner"});
    const second=(await f.client.query("SELECT id FROM pg_temp.users WHERE phone='+992900123459'")).rows[0].id;
    await management.manageStaff(id(1),{action:"disable",userId:id(1)});
    await assert.rejects(management.manageStaff(second,{action:"roles",userId:second,roles:["courier"]}),/последнего/);
  } finally {await f.close();}
});

test("every administrative entry point has a server guard; credential values never reach source logs", () => {
  function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]); }
  for(const file of walk(resolve("src/app/admin")).filter(p=>/page\.tsx$|actions\.ts$/.test(p))) {
    if(file.replaceAll("\\","/").endsWith("/login/page.tsx"))continue;
    assert.match(readFileSync(file,"utf8"),/requirePermission\(|requireAdminSession\(/,file);
  }
  for(const file of walk(resolve("src/app/api/admin")).filter(p=>p.endsWith("route.ts") && !/login|logout/.test(p))) {
    assert.match(readFileSync(file,"utf8"),/authorizeApi\(/,file);
  }
  const auth=readFileSync("src/lib/admin-auth.ts","utf8");
  assert.doesNotMatch(auth,/ADMIN_PASSWORD|ADMIN_SESSION_TOKEN/);
  assert.match(auth,/httpOnly: true/); assert.match(auth,/sameSite: "lax"/);
  assert.match(auth,/secure: process.env.NODE_ENV === "production"/);
});

test("direct forbidden pages, APIs and uploads refuse every role before touching protected business data", async () => {
  const f=await fixture();
  try {
    const token=password.newSessionToken(); f.setToken(token);
    await f.client.query("INSERT INTO pg_temp.staff_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[password.hashSessionToken(token),id(2)]);
    const routes=[
      ["src/app/api/admin/orders/[id]/status/route.ts","orders.work","PATCH"],
      ["src/app/api/admin/orders/[id]/payment/route.ts","payments.manage","PATCH"],
      ["src/app/api/admin/deliveries/[id]/route.ts","deliveries.read","PATCH"],
      ["src/app/api/admin/flowers/[flowerId]/model/route.ts","models.manage","POST"],
      ["src/app/api/admin/flowers/[flowerId]/model/route.ts","models.manage","PATCH"],
      ["src/app/api/admin/flowers/[flowerId]/model/route.ts","models.manage","DELETE"],
      ["src/app/api/db-check/route.ts","settings.manage","GET"],
    ];
    const pagePermissions={"":"orders.read",inventory:"inventory.read",products:"products.manage",customers:"customers.read",
      suppliers:"suppliers.manage",purchases:"purchases.manage",deliveries:"deliveries.read",staff:"staff.manage"};
    function pages(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?pages(join(dir,e.name)):e.name==="page.tsx"?[join(dir,e.name)]:[]);}
    for(const role of permissions.STAFF_ROLES){
      await f.client.query("DELETE FROM pg_temp.user_roles WHERE user_id=$1",[id(2)]);
      await f.client.query("INSERT INTO pg_temp.user_roles(user_id,role_id) SELECT $1,id FROM pg_temp.roles WHERE code=$2",[id(2),role]);
      for(const [file,permission,method] of routes){
        if(permissions.hasPermission([role],permission))continue;
        const route=loadTs(file,f.overrides);
        const req=method==="GET"?new Request("http://localhost/api/db-check"):request({},method);
        assert.equal((await route[method](req,{params:Promise.resolve({id:id(10),flowerId:"1"})})).status,403,`${role}: ${file} ${method}`);
      }
      for(const file of pages("src/app/admin")){
        const section=file.replaceAll("\\","/").split("/")[3];
        if(["login","password"].includes(section))continue;
        const permission=pagePermissions[section==="page.tsx"?"":section];
        if(permissions.hasPermission([role],permission))continue;
        const page=loadTs(file,{...f.overrides,__stubComponents:true}).default;
        await assert.rejects(page({params:Promise.resolve({id:"1",flowerId:"1"}),searchParams:Promise.resolve({})}),e=>e.status===404,`${role}: ${file}`);
      }
    }
    assert.equal((await f.auth.authorizeApi("deliveries.read",new Request("http://localhost/api/test",{method:"POST",headers:{origin:"https://attacker.invalid"}}))).status,403);
  } finally {await f.close();}
});

test("courier server page queries only assigned address deliveries and returns a minimal recipient view",async()=>{
  const f=await fixture();
  try{
    await f.client.query("INSERT INTO pg_temp.orders(id,order_number,status,fulfillment_type) VALUES($1,'MINE','ready','delivery'),($2,'OTHER','ready','delivery'),($3,'PICKUP','ready','pickup')",[id(10),id(11),id(12)]);
    for(const [n,order,courier] of [[20,10,2],[21,11,3],[22,12,2]])await f.client.query(`INSERT INTO pg_temp.deliveries(id,order_id,status,courier_user_id,recipient_name,recipient_phone,city,street_address,internal_note,courier_cost)
      VALUES($1,$2,'assigned',$3,'Recipient','+992900123450','City','Street','PRIVATE NOTE',999)`,[id(n),id(order),id(courier)]);
    f.setSession({userId:id(2),roles:["courier"]});
    const {CourierDeliveries}=loadTs("src/components/courier-deliveries.tsx",{...f.actionsOverrides,
      "@/components/admin-navigation":{AdminNavigation:()=>null},"@/components/brand-logo":{BrandLogo:()=>null},"@/components/courier-delivery-actions":{CourierDeliveryActions:()=>null}});
    const html=renderToStaticMarkup(await CourierDeliveries());
    assert.match(html,/MINE/);assert.match(html,/Recipient/);assert.match(html,/Street/);
    assert.doesNotMatch(html,/OTHER|PICKUP|PRIVATE NOTE|999|Закуп/);
  }finally{await f.close();}
});
