export const DELIVERY_STATUSES = [
  "planned",
  "assigned",
  "on_the_way",
  "delivered",
  "failed",
  "cancelled",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  planned: "Ожидает назначения",
  assigned: "Курьер назначен",
  on_the_way: "В пути",
  delivered: "Доставлен",
  failed: "Не доставлено",
  cancelled: "Отменён",
};

export const DELIVERY_STATUS_TRANSITIONS: Record<
  DeliveryStatus,
  readonly DeliveryStatus[]
> = {
  planned: ["assigned", "cancelled"],
  assigned: ["on_the_way", "cancelled"],
  on_the_way: ["delivered", "failed"],
  delivered: [],
  failed: [],
  cancelled: [],
};

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransitionDeliveryStatus(
  oldStatus: DeliveryStatus,
  newStatus: DeliveryStatus,
) {
  return DELIVERY_STATUS_TRANSITIONS[oldStatus].includes(newStatus);
}
