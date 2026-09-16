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
  fulfillmentType?: string,
) {
  if (fulfillmentType === "pickup" && newStatus === "delivering") return false;
  if (fulfillmentType === "delivery" && oldStatus === "ready" && newStatus === "completed") return false;
  return ORDER_STATUS_TRANSITIONS[oldStatus].includes(newStatus);
}

