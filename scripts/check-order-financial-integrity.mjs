import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";

function qualified(schema, table) {
  if (schema !== "public" && schema !== "pg_temp") {
    throw new Error("Unsupported diagnostic schema");
  }
  return `${schema}.${table}`;
}

export async function checkOrderFinancialIntegrity(client, schema = "public") {
  const orders = qualified(schema, "orders");
  const items = qualified(schema, "order_items");
  const payments = qualified(schema, "payments");

  await client.query("BEGIN READ ONLY");
  try {
    const inconsistentOrders = await client.query(`
      WITH item_totals AS (
        SELECT order_id,
               round(COALESCE(sum(unit_price * quantity), 0::numeric), 2) AS calculated_subtotal
        FROM ${items}
        GROUP BY order_id
      )
      SELECT customer_order.id::text AS order_id,
             customer_order.status,
             customer_order.fulfillment_type,
             customer_order.subtotal::text AS saved_subtotal,
             COALESCE(item_totals.calculated_subtotal, 0)::text AS calculated_subtotal,
             customer_order.delivery_cost::text AS delivery_cost,
             customer_order.total_amount::text AS saved_total,
             (COALESCE(item_totals.calculated_subtotal, 0) + customer_order.delivery_cost)::text AS calculated_total
      FROM ${orders} AS customer_order
      LEFT JOIN item_totals ON item_totals.order_id = customer_order.id
      WHERE customer_order.subtotal IS DISTINCT FROM COALESCE(item_totals.calculated_subtotal, 0)
         OR customer_order.total_amount IS DISTINCT FROM
            (COALESCE(item_totals.calculated_subtotal, 0) + customer_order.delivery_cost)
      ORDER BY customer_order.id
    `);

    const inconsistentPayments = await client.query(`
      SELECT payment.id::text AS payment_id,
             payment.order_id::text AS order_id,
             customer_order.status AS order_status,
             payment.status AS payment_status,
             payment.amount::text AS payment_amount,
             customer_order.total_amount::text AS order_total
      FROM ${payments} AS payment
      JOIN ${orders} AS customer_order ON customer_order.id = payment.order_id
      WHERE payment.status = 'pending'
        AND payment.amount IS DISTINCT FROM customer_order.total_amount
      ORDER BY payment.order_id, payment.id
    `);

    const invalidPickups = await client.query(`
      SELECT id::text AS order_id,
             status,
             fulfillment_type,
             delivery_cost::text AS delivery_cost,
             subtotal::text AS subtotal,
             total_amount::text AS total_amount
      FROM ${orders}
      WHERE fulfillment_type = 'pickup'
        AND delivery_cost <> 0
      ORDER BY id
    `);

    await client.query("ROLLBACK");
    return {
      inconsistentOrders: inconsistentOrders.rows,
      inconsistentPayments: inconsistentPayments.rows,
      invalidPickups: invalidPickups.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function printSection(title, rows) {
  console.log(`\n${title}: ${rows.length}`);
  if (rows.length > 0) console.table(rows);
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const result = await checkOrderFinancialIntegrity(client);
    printSection("Заказы с несовпадающими суммами", result.inconsistentOrders);
    printSection("Ожидающие платежи с несовпадающей суммой", result.inconsistentPayments);
    printSection("Самовывоз с ненулевой доставкой", result.invalidPickups);
    const mismatchCount = Object.values(result).reduce(
      (total, rows) => total + rows.length,
      0,
    );
    if (mismatchCount > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error("Не удалось проверить финансовую целостность:", error.message);
    process.exitCode = 1;
  });
}
