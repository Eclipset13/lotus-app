import "server-only";

import type { PoolClient } from "pg";

export const ORDER_STATUSES = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "delivering",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  readonly OrderStatus[]
> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivering", "completed", "cancelled"],
  delivering: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransitionOrderStatus(
  oldStatus: OrderStatus,
  newStatus: OrderStatus,
) {
  return ORDER_STATUS_TRANSITIONS[oldStatus].includes(newStatus);
}

export async function updateOrderStatusWithHistory(
  client: PoolClient,
  orderId: string,
  oldStatus: OrderStatus,
  newStatus: OrderStatus,
  comment: string | null,
) {
  const historyBoundaryResult = await client.query<{ max_id: string }>(
    `
      SELECT COALESCE(max(id), 0)::text AS max_id
      FROM public.order_status_history
      WHERE order_id = $1::uuid
    `,
    [orderId],
  );
  const historyBoundary = historyBoundaryResult.rows[0]?.max_id ?? "0";

  const orderResult = await client.query(
    `
      UPDATE public.orders
      SET status = $1::varchar,
          updated_at = NOW(),
          confirmed_at = CASE WHEN $1::varchar = 'confirmed'::varchar THEN COALESCE(confirmed_at, NOW()) ELSE confirmed_at END,
          completed_at = CASE WHEN $1::varchar = 'completed'::varchar THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
          cancelled_at = CASE WHEN $1::varchar = 'cancelled'::varchar THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END
      WHERE id = $2::uuid
        AND status = $3::varchar
    `,
    [newStatus, orderId, oldStatus],
  );
  if (orderResult.rowCount !== 1) {
    throw new Error(`Order ${orderId} status changed concurrently`);
  }

  const historyResult = await client.query(
    `
      UPDATE public.order_status_history
      SET comment = $5::text
      WHERE id = (
        SELECT id
        FROM public.order_status_history
        WHERE order_id = $1::uuid
          AND old_status = $2::varchar
          AND new_status = $3::varchar
          AND id > $4::bigint
        ORDER BY id DESC
        LIMIT 1
      )
      RETURNING id
    `,
    [orderId, oldStatus, newStatus, historyBoundary, comment],
  );
  if (historyResult.rowCount !== 1) {
    throw new Error(
      `Order ${orderId} status history trigger did not create exactly one row`,
    );
  }
}
