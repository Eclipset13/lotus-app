import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  canTransitionDeliveryStatus,
  isDeliveryStatus,
  type DeliveryStatus,
} from "@/lib/delivery";
import {
  canTransitionOrderStatus,
  isOrderStatus,
  updateOrderStatusWithHistory,
  type OrderStatus,
} from "@/lib/order-status";

export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

type LockedDelivery = {
  id: string;
  order_id: string;
  status: string;
  courier_name: string | null;
};

type LockedOrder = {
  id: string;
  status: string;
};

class DeliveryRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function trimText(value: unknown, maximumLength: number, label: string) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new DeliveryRequestError(`Некорректное поле «${label}»`, 400);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maximumLength) {
    throw new DeliveryRequestError(`Поле «${label}» слишком длинное`, 400);
  }
  return text;
}

function parseCourierCost(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new DeliveryRequestError("Укажите стоимость доставки", 400);
  }
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) {
    throw new DeliveryRequestError("Укажите стоимость доставки", 400);
  }
  const cost = Number(normalized);
  if (!Number.isFinite(cost) || cost < 0 || cost > 999_999_999) {
    throw new DeliveryRequestError("Проверьте стоимость доставки", 400);
  }
  return cost.toFixed(2);
}

function parseScheduledAt(value: unknown) {
  const scheduledAt = trimText(value, 19, "Дата и время");
  if (!scheduledAt) return "";
  if (
    !localDateTimePattern.test(scheduledAt) ||
    Number.isNaN(new Date(`${scheduledAt}+05:00`).getTime())
  ) {
    throw new DeliveryRequestError("Проверьте дату и время доставки", 400);
  }
  return scheduledAt;
}

async function lockDeliveryAndOrder(client: PoolClient, deliveryId: string) {
  const identityResult = await client.query<{ order_id: string }>(
    `
      SELECT order_id::text
      FROM public.deliveries
      WHERE id = $1::uuid
    `,
    [deliveryId],
  );
  const orderId = identityResult.rows[0]?.order_id;
  if (!orderId) throw new DeliveryRequestError("Доставка не найдена", 404);

  const orderResult = await client.query<LockedOrder>(
    `
      SELECT id::text, status
      FROM public.orders
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order || !isOrderStatus(order.status)) {
    throw new DeliveryRequestError("Заказ доставки не найден", 404);
  }

  const deliveryResult = await client.query<LockedDelivery>(
    `
      SELECT id::text, order_id::text, status, courier_name
      FROM public.deliveries
      WHERE id = $1::uuid
        AND order_id = $2::uuid
      FOR UPDATE
    `,
    [deliveryId, order.id],
  );
  const delivery = deliveryResult.rows[0];
  if (!delivery || !isDeliveryStatus(delivery.status)) {
    throw new DeliveryRequestError("Доставка не найдена", 404);
  }

  return {
    delivery: { ...delivery, status: delivery.status as DeliveryStatus },
    order: { ...order, status: order.status as OrderStatus },
  };
}

async function syncOrderFromDelivery(
  client: PoolClient,
  order: { id: string; status: OrderStatus },
  deliveryStatus: DeliveryStatus,
) {
  const targetOrderStatus =
    deliveryStatus === "on_the_way"
      ? "delivering"
      : deliveryStatus === "delivered"
        ? "completed"
        : null;
  if (!targetOrderStatus || order.status === targetOrderStatus) return;
  if (!canTransitionOrderStatus(order.status, targetOrderStatus)) {
    throw new DeliveryRequestError(
      deliveryStatus === "on_the_way"
        ? "Заказ ещё нельзя перевести в доставку"
        : "Заказ ещё нельзя завершить",
      409,
    );
  }

  await updateOrderStatusWithHistory(
    client,
    order.id,
    order.status,
    targetOrderStatus,
    "Статус изменён из раздела доставки",
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return Response.json(
      { success: false, message: "Требуется вход в админ-панель" },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json(
      { success: false, message: "Некорректный идентификатор доставки" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid body");
    }
    body = value as Record<string, unknown>;
  } catch {
    return Response.json(
      { success: false, message: "Некорректный запрос" },
      { status: 400 },
    );
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const { delivery, order } = await lockDeliveryAndOrder(client, id);

    if (body.action === "details") {
      const courierName = trimText(body.courierName, 120, "Имя курьера");
      const scheduledAt = parseScheduledAt(body.scheduledAt);
      const courierCost = parseCourierCost(body.courierCost);
      const internalNote = trimText(body.internalNote, 4_000, "Примечание");

      await client.query(
        `
          UPDATE public.deliveries
          SET courier_name = NULLIF($2::text, ''),
              scheduled_at = CASE
                WHEN $3::text = '' THEN NULL
                ELSE $3::timestamp AT TIME ZONE 'Asia/Dushanbe'
              END,
              courier_cost = $4::numeric(12, 2),
              internal_note = NULLIF($5::text, ''),
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        [id, courierName, scheduledAt, courierCost, internalNote],
      );
      await client.query("COMMIT");
      revalidatePath("/admin/deliveries");
      return Response.json({
        success: true,
        message: "Доставка сохранена",
      });
    }

    if (body.action !== "status" || !isDeliveryStatus(body.status)) {
      throw new DeliveryRequestError("Недопустимое действие", 400);
    }
    if (delivery.status === body.status) {
      await client.query("COMMIT");
      return Response.json({
        success: true,
        message: "Статус доставки уже установлен",
      });
    }
    if (!canTransitionDeliveryStatus(delivery.status, body.status)) {
      throw new DeliveryRequestError(
        "Недопустимый переход статуса доставки",
        409,
      );
    }
    if (
      ["assigned", "on_the_way"].includes(body.status) &&
      !delivery.courier_name?.trim()
    ) {
      throw new DeliveryRequestError("Сначала укажите курьера", 409);
    }

    await syncOrderFromDelivery(client, order, body.status);
    const deliveryResult = await client.query(
      `
        UPDATE public.deliveries
        SET status = $2::varchar,
            delivered_at = CASE
              WHEN $2::varchar = 'delivered' THEN COALESCE(delivered_at, NOW())
              ELSE delivered_at
            END,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status = $3::varchar
      `,
      [id, body.status, delivery.status],
    );
    if (deliveryResult.rowCount !== 1) {
      throw new Error(`Delivery ${id} status changed concurrently`);
    }

    await client.query("COMMIT");
    revalidatePath("/admin/deliveries");
    revalidatePath("/admin");
    return Response.json({
      success: true,
      message: "Статус доставки обновлён",
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("Delivery rollback failed:", rollbackError);
      });
    }
    if (error instanceof DeliveryRequestError) {
      return Response.json(
        { success: false, message: error.message },
        { status: error.statusCode },
      );
    }
    const databaseError = error as {
      code?: unknown;
      detail?: unknown;
      constraint?: unknown;
    };
    console.error("PATCH /api/admin/deliveries/[id] failed:", {
      error,
      code: databaseError?.code,
      detail: databaseError?.detail,
      constraint: databaseError?.constraint,
    });
    return Response.json(
      { success: false, message: "Не удалось сохранить доставку" },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
