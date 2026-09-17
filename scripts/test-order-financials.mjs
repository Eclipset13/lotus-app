// All test writes are limited to connection-local pg_temp tables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import nextEnv from "@next/env";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs } from "./helpers/load-ts.mjs";
import { checkOrderFinancialIntegrity } from "./check-order-financial-integrity.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actorId = id(999);

async function fixture() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query(`
    CREATE TEMP TABLE orders (
      id uuid PRIMARY KEY,
      status varchar NOT NULL,
      fulfillment_type varchar NOT NULL,
      subtotal numeric(12,2) NOT NULL DEFAULT 0,
      delivery_cost numeric(12,2) NOT NULL DEFAULT 0,
      total_amount numeric(12,2) NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TEMP TABLE order_items (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id uuid NOT NULL,
      item_type varchar NOT NULL,
      quantity integer NOT NULL CHECK (quantity > 0),
      unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0)
    );
    CREATE TEMP TABLE payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL,
      status varchar NOT NULL,
      amount numeric(12,2) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TEMP TABLE admin_audit_log (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      actor_user_id uuid,
      action text NOT NULL,
      entity_id text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const query = (sql, values) => client.query(sql.replaceAll("public.", "pg_temp."), values);
  const db = { connect: async () => ({ query, release() {} }) };

  async function seed({
    n,
    status = "new",
    fulfillment = "delivery",
    deliveryCost = "0.00",
    total = "0.00",
    paymentStatus = "pending",
    paymentAmount = "0.00",
    items = [{ itemType: "bouquet", quantity: 1, unitPrice: "100.00" }],
  }) {
    const orderId = id(n);
    await client.query(
      "INSERT INTO pg_temp.orders(id,status,fulfillment_type,delivery_cost,total_amount) VALUES($1,$2,$3,$4,$5)",
      [orderId, status, fulfillment, deliveryCost, total],
    );
    for (const item of items) {
      await client.query(
        "INSERT INTO pg_temp.order_items(order_id,item_type,quantity,unit_price) VALUES($1,$2,$3,$4)",
        [orderId, item.itemType, item.quantity, item.unitPrice],
      );
    }
    if (paymentStatus !== null) {
      await client.query(
        "INSERT INTO pg_temp.payments(order_id,status,amount) VALUES($1,$2,$3)",
        [orderId, paymentStatus, paymentAmount],
      );
    }
    return orderId;
  }

  return { client, db, query, seed, close: () => client.end() };
}

function deliveryRoute(db, allowed = true) {
  return loadTs("src/app/api/admin/orders/[id]/delivery-fee/route.ts", {
    "@/lib/db": { db },
    "@/lib/admin-auth": {
      authorizeApi: async () => allowed
        ? { userId: actorId, roles: ["super_admin"] }
        : Response.json({ success: false }, { status: 403 }),
    },
  }).PATCH;
}

function request(deliveryFee, extra = {}) {
  return new Request("http://localhost/api/admin/orders/test/delivery-fee", {
    method: "PATCH",
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryFee, ...extra }),
  });
}

const context = (orderId) => ({ params: Promise.resolve({ id: orderId }) });

test("delivery 0 -> 25 recalculates ordinary/custom snapshots, quantities and pending payment", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({
      n: 1,
      paymentAmount: "0.00",
      items: [
        { itemType: "bouquet", quantity: 2, unitPrice: "100.00" },
        { itemType: "custom_bouquet", quantity: 3, unitPrice: "25.50" },
      ],
    });
    const response = await deliveryRoute(f.db)(request("25"), context(orderId));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.financials, {
      subtotal: "276.50",
      deliveryCost: "25.00",
      totalAmount: "301.50",
      paymentAmount: "301.50",
    });
    const order = (await f.client.query("SELECT subtotal::text,delivery_cost::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0];
    assert.deepEqual(order, { subtotal: "276.50", delivery_cost: "25.00", total_amount: "301.50" });
    assert.equal((await f.client.query("SELECT amount::text FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows[0].amount, "301.50");
    const audit = (await f.client.query("SELECT actor_user_id::text,action,entity_id,details FROM pg_temp.admin_audit_log")).rows[0];
    assert.equal(audit.action, "order.delivery_fee");
    assert.equal(audit.actor_user_id, actorId);
    assert.equal(audit.entity_id, orderId);
    assert.deepEqual(audit.details, {
      order_id: orderId,
      old_delivery_fee: "0.00",
      new_delivery_fee: "25.00",
      subtotal: "276.50",
      old_total: "0.00",
      new_total: "301.50",
      old_payment_amount: "0.00",
      new_payment_amount: "301.50",
      staff_id: actorId,
    });
  } finally { await f.close(); }
});

test("comma input is accepted and an order without payment can be recalculated", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 2, paymentStatus: null });
    const response = await deliveryRoute(f.db)(request("25,50"), context(orderId));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).financials, {
      subtotal: "100.00", deliveryCost: "25.50", totalAmount: "125.50", paymentAmount: null,
    });
  } finally { await f.close(); }
});

test("pickup, paid, refunded, cancelled and completed orders reject changes with 409", async () => {
  const f = await fixture();
  try {
    const cases = [
      [3, { fulfillment: "pickup" }],
      [4, { paymentStatus: "paid" }],
      [5, { paymentStatus: "refunded" }],
      [6, { status: "cancelled" }],
      [7, { status: "completed" }],
    ];
    const patch = deliveryRoute(f.db);
    for (const [n, values] of cases) {
      const orderId = await f.seed({ n, ...values });
      const before = (await f.client.query("SELECT delivery_cost::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0];
      const response = await patch(request("25"), context(orderId));
      assert.equal(response.status, 409, JSON.stringify(values));
      const after = (await f.client.query("SELECT delivery_cost::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0];
      assert.deepEqual(after, before);
    }
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("invalid delivery fees, extra input and malformed UUID are rejected before mutation", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 8 });
    const patch = deliveryRoute(f.db);
    for (const value of ["-1", "1.001", "", " ", "NaN", "Infinity", "25 сом", null, {}, "10000000000.00"]) {
      assert.equal((await patch(request(value), context(orderId))).status, 400, JSON.stringify(value));
    }
    assert.equal((await patch(request("25", { subtotal: "1" }), context(orderId))).status, 400);
    assert.equal((await patch(request("25"), context("not-a-uuid"))).status, 400);
    assert.equal((await f.client.query("SELECT delivery_cost::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0].delivery_cost, "0.00");
  } finally { await f.close(); }
});

test("unknown order is 404 and insufficient permission is 403", async () => {
  const f = await fixture();
  try {
    assert.equal((await deliveryRoute(f.db)(request("25"), context(id(404)))).status, 404);
    const orderId = await f.seed({ n: 9 });
    assert.equal((await deliveryRoute(f.db, false)(request("25"), context(orderId))).status, 403);
    assert.equal((await f.client.query("SELECT delivery_cost::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0].delivery_cost, "0.00");
  } finally { await f.close(); }
});

test("saving the same value is idempotent and repairs totals without duplicate audit", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 10 });
    const patch = deliveryRoute(f.db);
    assert.equal((await patch(request("25"), context(orderId))).status, 200);
    await f.client.query("UPDATE pg_temp.orders SET subtotal=1,total_amount=2 WHERE id=$1", [orderId]);
    await f.client.query("UPDATE pg_temp.payments SET amount=3 WHERE order_id=$1", [orderId]);
    assert.equal((await patch(request("25.00"), context(orderId))).status, 200);
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log")).rows[0].n, 1);
    assert.deepEqual((await f.client.query("SELECT subtotal::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0], { subtotal: "100.00", total_amount: "125.00" });
    assert.equal((await f.client.query("SELECT amount::text FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows[0].amount, "125.00");
  } finally { await f.close(); }
});

test("SQL failure rolls back both order and payment", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 11, total: "100.00", paymentAmount: "100.00" });
    const failingDb = { connect: async () => ({
      query: (sql, values) => /UPDATE public\.payments/i.test(sql)
        ? Promise.reject(new Error("Artificial payment update failure"))
        : f.query(sql, values),
      release() {},
    }) };
    assert.equal((await deliveryRoute(failingDb)(request("25"), context(orderId))).status, 500);
    assert.deepEqual((await f.client.query("SELECT subtotal::text,delivery_cost::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0], {
      subtotal: "0.00", delivery_cost: "0.00", total_amount: "100.00",
    });
    assert.equal((await f.client.query("SELECT amount::text FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows[0].amount, "100.00");
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log")).rows[0].n, 0);
  } finally { await f.close(); }
});

test("two overlapping saves serialize and preserve the order/payment invariant", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 12, total: "100.00", paymentAmount: "100.00" });
    let held = false;
    const waiters = [];
    const acquire = () => held
      ? new Promise((resolve) => waiters.push(resolve))
      : (held = true, Promise.resolve());
    const release = () => {
      const next = waiters.shift();
      if (next) next(); else held = false;
    };
    const concurrentDb = { connect: async () => {
      let ownsTransaction = false;
      return {
        query: async (sql, values) => {
          if (sql === "BEGIN") return { rows: [] };
          if (/FROM public\.orders[\s\S]*FOR UPDATE/i.test(sql)) {
            await acquire();
            await f.client.query("BEGIN");
            ownsTransaction = true;
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (ownsTransaction) await f.client.query(sql);
            ownsTransaction = false;
            release();
            return { rows: [] };
          }
          return f.query(sql, values);
        },
        release() {},
      };
    } };
    const patch = deliveryRoute(concurrentDb);
    const responses = await Promise.all([
      patch(request("25"), context(orderId)),
      patch(request("40"), context(orderId)),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    const order = (await f.client.query("SELECT delivery_cost::text,total_amount::text FROM pg_temp.orders WHERE id=$1", [orderId])).rows[0];
    const payment = (await f.client.query("SELECT amount::text FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows[0];
    assert.equal(order.total_amount, payment.amount);
    assert.ok(["25.00", "40.00"].includes(order.delivery_cost));
    assert.equal((await f.client.query("SELECT count(*)::int AS n FROM pg_temp.admin_audit_log")).rows[0].n, 2);
  } finally { await f.close(); }
});

test("admin financial component renders editable and read-only states", () => {
  const { AdminDeliveryFeeEditor } = loadTs("src/components/admin-delivery-fee-editor.tsx", {
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
  });
  const render = (overrides = {}) => renderToStaticMarkup(React.createElement(AdminDeliveryFeeEditor, {
    orderId: id(20), orderStatus: "new", fulfillmentType: "delivery",
    paymentStatus: "pending", canManage: true, subtotal: "100.00",
    deliveryCost: "25.00", totalAmount: "125.00", paymentAmount: "125.00",
    ...overrides,
  }));
  const editable = render();
  assert.match(editable, /Товары:/);
  assert.match(editable, /Доставка:/);
  assert.match(editable, /Итого:/);
  assert.match(editable, /Сохранить стоимость доставки/);
  const pickup = render({ fulfillmentType: "pickup", deliveryCost: "0.00", totalAmount: "100.00" });
  assert.match(pickup, /Самовывоз, 0 сом/);
  assert.doesNotMatch(pickup, /Сохранить стоимость доставки/);
  for (const [values, reason] of [
    [{ paymentStatus: "paid" }, /уже оплачен/],
    [{ paymentStatus: "refunded" }, /Оплата возвращена/],
    [{ orderStatus: "cancelled" }, /отменённого заказа/],
    [{ orderStatus: "completed" }, /выполненного заказа/],
  ]) {
    const html = render(values);
    assert.match(html, reason);
    assert.doesNotMatch(html, /Сохранить стоимость доставки/);
  }
});

test("orders and deliveries use the same order delivery cost", async () => {
  const deliveryPageSource = readFileSync("src/app/admin/deliveries/page.tsx", "utf8");
  const deliveryEditorSource = readFileSync("src/components/admin-delivery-editor.tsx", "utf8");
  assert.match(deliveryPageSource, /o\.delivery_cost::text/);
  assert.doesNotMatch(deliveryPageSource, /d\.courier_cost/);
  assert.doesNotMatch(deliveryEditorSource, /courier_cost|courierCost/);

  const f = await fixture();
  try {
    const orderId = await f.seed({ n: 13, total: "100.00", paymentAmount: "100.00" });
    const response = await deliveryRoute(f.db)(request("25"), context(orderId));
    assert.equal(response.status, 200);
    const deliveryView = (await f.client.query(
      "SELECT o.delivery_cost::text FROM pg_temp.orders o WHERE o.id=$1",
      [orderId],
    )).rows[0];
    assert.equal(deliveryView.delivery_cost, "25.00");
  } finally { await f.close(); }
});

test("diagnostic check is read-only and reports all financial mismatch classes", async () => {
  const f = await fixture();
  try {
    const orderId = await f.seed({
      n: 30, fulfillment: "pickup", deliveryCost: "10.00", total: "1.00", paymentAmount: "2.00",
    });
    const before = {
      order: (await f.client.query("SELECT * FROM pg_temp.orders WHERE id=$1", [orderId])).rows,
      payment: (await f.client.query("SELECT * FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows,
      items: (await f.client.query("SELECT * FROM pg_temp.order_items WHERE order_id=$1", [orderId])).rows,
    };
    const result = await checkOrderFinancialIntegrity(f.client, "pg_temp");
    assert.equal(result.inconsistentOrders.length, 1);
    assert.equal(result.inconsistentPayments.length, 1);
    assert.equal(result.invalidPickups.length, 1);
    const after = {
      order: (await f.client.query("SELECT * FROM pg_temp.orders WHERE id=$1", [orderId])).rows,
      payment: (await f.client.query("SELECT * FROM pg_temp.payments WHERE order_id=$1", [orderId])).rows,
      items: (await f.client.query("SELECT * FROM pg_temp.order_items WHERE order_id=$1", [orderId])).rows,
    };
    assert.deepEqual(after, before);
  } finally { await f.close(); }
});
