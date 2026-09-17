import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { authorizeApi } from "@/lib/admin-auth";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/admin-audit";
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
  courier_user_id: string | null;
  courier_phone: string | null;
  scheduled_at: Date | null;
  internal_note: string | null;
};

type LockedOrder = {
  id: string;
  status: string;
  fulfillment_type: string;
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

async function lockDeliveryAndOrder(client: PoolClient, deliveryId: string, courierId: string | null) {
  const identityResult = await client.query<{ order_id: string }>(
    `
      SELECT order_id::text
      FROM public.deliveries
      WHERE id = $1::uuid AND ($2::uuid IS NULL OR courier_user_id = $2::uuid)
    `,
    [deliveryId, courierId],
  );
  const orderId = identityResult.rows[0]?.order_id;
  if (!orderId) throw new DeliveryRequestError("Доставка не найдена", 404);

  const orderResult = await client.query<LockedOrder>(
    `
      SELECT id::text, status, fulfillment_type
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
      SELECT id::text, order_id::text, status, courier_name, courier_user_id::text,
             courier_phone, scheduled_at, internal_note
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

  if (order.fulfillment_type !== "delivery") throw new DeliveryRequestError("Самовывоз не требует доставки", 409);
  if (order.status === "cancelled") throw new DeliveryRequestError("Заказ отменён", 409);
  if (courierId && delivery.courier_user_id !== courierId) throw new DeliveryRequestError("Доставка не найдена", 404);
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
  const session = await authorizeApi("deliveries.read", request);
  if (session instanceof Response) return session;

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
    const { delivery, order } = await lockDeliveryAndOrder(client, id,
      hasPermission(session.roles, "deliveries.manage") ? null : session.userId);
    if (!hasPermission(session.roles, "deliveries.manage")) {
      if (body.action !== "status" || Object.keys(body).some((key) => !["action", "status"].includes(key)) ||
        !((delivery.status === "assigned" && body.status === "on_the_way") || (delivery.status === "on_the_way" && body.status === "delivered"))) {
        throw new DeliveryRequestError("Недостаточно прав для этого действия", 403);
      }
    }

    if (body.action === "details") {
      if ("courierCost" in body) {
        throw new DeliveryRequestError(
          "Стоимость доставки изменяется в карточке заказа",
          409,
        );
      }
      const courierUserId = trimText(body.courierUserId, 36, "Курьер");
      if (courierUserId && !uuidPattern.test(courierUserId)) throw new DeliveryRequestError("Выберите курьера", 400);
      if (["delivered", "cancelled", "failed", "on_the_way"].includes(delivery.status)) throw new DeliveryRequestError("Назначение этой доставки уже нельзя изменить", 409);
      const courier = courierUserId ? (await client.query<{ name: string; phone: string }>(`SELECT u.name,u.phone FROM public.users u
        JOIN public.staff_credentials c ON c.user_id=u.id WHERE u.id=$1 AND u.status='active'
        AND EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.code='courier')
        FOR SHARE OF u`, [courierUserId])).rows[0] : null;
      if (courierUserId && !courier) throw new DeliveryRequestError("Курьер не найден или отключён", 400);
      const courierName = courier?.name ?? "";
      const scheduledAt = parseScheduledAt(body.scheduledAt);
      const internalNote = trimText(body.internalNote, 4_000, "Примечание");

      const updated = await client.query(
        `
          UPDATE public.deliveries
          SET courier_name = NULLIF($2::text, ''),
              scheduled_at = CASE
                WHEN $3::text = '' THEN NULL
                ELSE $3::timestamp AT TIME ZONE 'Asia/Dushanbe'
              END,
              internal_note = NULLIF($4::text, ''),
              courier_user_id = NULLIF($5::text, '')::uuid,
              courier_phone = $6,
              status = CASE WHEN $5::text = '' THEN 'planned' ELSE 'assigned' END,
              updated_at = NOW()
          WHERE id = $1::uuid
            AND ROW(courier_name, scheduled_at, internal_note, courier_user_id, courier_phone, status)
              IS DISTINCT FROM ROW(
                NULLIF($2::text, ''),
                CASE WHEN $3::text = '' THEN NULL ELSE $3::timestamp AT TIME ZONE 'Asia/Dushanbe' END,
                NULLIF($4::text, ''),
                NULLIF($5::text, '')::uuid,
                $6::text,
                CASE WHEN $5::text = '' THEN 'planned'::varchar ELSE 'assigned'::varchar END
              )
        `,
        [id, courierName, scheduledAt, internalNote, courierUserId, courier?.phone ?? null],
      );
      if (updated.rowCount === 1) {
        await audit(client, session.userId, "delivery.assign", id, {
          before: { courier_user_id: delivery.courier_user_id, status: delivery.status },
          after: { courier_user_id: courierUserId || null, status: courierUserId ? "assigned" : "planned" },
          fields: ["courier_user_id", "scheduled_at", "internal_note"],
        });
      }
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
      !delivery.courier_user_id
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

    await audit(client, session.userId, "delivery.status", id, { before: delivery.status, after: body.status });
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
