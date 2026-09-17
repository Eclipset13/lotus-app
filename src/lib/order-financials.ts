import "server-only";
import type { PoolClient } from "pg";

type QueryClient = Pick<PoolClient, "query">;

export type OrderFinancials = {
  subtotal: string;
  deliveryCost: string;
  totalAmount: string;
};

/**
 * Rebuilds persisted order amounts exclusively from order-item price snapshots.
 * The caller owns the transaction and, for existing orders, must lock the order
 * before calling this function.
 */
export async function recalculateOrderFinancials(
  client: QueryClient,
  orderId: string,
  requestedDeliveryCost: string,
): Promise<OrderFinancials> {
  const result = await client.query<{
    subtotal: string;
    delivery_cost: string;
    total_amount: string;
  }>(
    `
      WITH calculated AS (
        SELECT round(
          COALESCE(sum(order_item.unit_price * order_item.quantity), 0::numeric),
          2
        )::numeric(12,2) AS subtotal
        FROM public.order_items AS order_item
        WHERE order_item.order_id = $1::uuid
      ), amounts AS (
        SELECT
          calculated.subtotal,
          CASE
            WHEN customer_order.fulfillment_type = 'pickup' THEN 0::numeric(12,2)
            ELSE $2::numeric(12,2)
          END AS delivery_cost
        FROM public.orders AS customer_order
        CROSS JOIN calculated
        WHERE customer_order.id = $1::uuid
      )
      UPDATE public.orders AS customer_order
      SET subtotal = amounts.subtotal,
          delivery_cost = amounts.delivery_cost,
          total_amount = (amounts.subtotal + amounts.delivery_cost)::numeric(12,2),
          updated_at = now()
      FROM amounts
      WHERE customer_order.id = $1::uuid
      RETURNING customer_order.subtotal::text,
                customer_order.delivery_cost::text,
                customer_order.total_amount::text
    `,
    [orderId, requestedDeliveryCost],
  );

  const amounts = result.rows[0];
  if (!amounts) throw new Error("Order financial recalculation target not found");

  return {
    subtotal: amounts.subtotal,
    deliveryCost: amounts.delivery_cost,
    totalAmount: amounts.total_amount,
  };
}
