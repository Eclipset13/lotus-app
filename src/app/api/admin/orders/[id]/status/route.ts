import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { audit } from "@/lib/admin-audit";
import { canWorkOrder } from "@/lib/permissions";
import { db } from "@/lib/db";
import { authorizeApi } from "@/lib/admin-auth";
import {
  getOrderFlowerRequirements,
  type OrderFlowerRequirement,
} from "@/lib/order-flower-requirements";
import {
  canTransitionOrderStatus,
  isOrderStatus,
  updateOrderStatusWithHistory,
  type OrderStatus,
} from "@/lib/order-status";

export const runtime = "nodejs";

type LockedOrder = {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfillment_type: "delivery" | "pickup";
};

type LockedPayment = {
  status: string;
};

type LockedDelivery = {
  id: string;
  status: string;
  courier_name: string | null;
  courier_user_id: string | null;
};

type LockedFlower = {
  id: string;
  name: string;
  stock_quantity: number;
};

type ActiveReservation = {
  id: string;
  flower_id: string;
  quantity: number;
};

type Shortage = {
  name: string;
  required: number;
  available: number;
  missing: number;
};

class StatusTransitionError extends Error {
  constructor(
    message: string,
    readonly shortages: Shortage[] = [],
  ) {
    super(message);
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sortIds(ids: string[]) {
  return [...ids].sort((first, second) => {
    const firstId = BigInt(first);
    const secondId = BigInt(second);
    return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
  });
}

async function readRequirements(client: PoolClient, orderId: string) {
  const result = (await getOrderFlowerRequirements([orderId], client)).get(
    orderId,
  );
  if (!result || !result.canCalculate || result.requirements.length === 0) {
    throw new StatusTransitionError(
      result?.errors[0] ?? "Нельзя рассчитать состав заказа",
    );
  }
  return result.requirements;
}

async function lockFlowersAndCheckAvailability(
  client: PoolClient,
  orderId: string,
  requirements: OrderFlowerRequirement[],
) {
  const flowerIds = sortIds(
    requirements.map((requirement) => requirement.flowerId),
  );
  const flowerResult = await client.query<LockedFlower>(
    `
      SELECT id::text, name, stock_quantity
      FROM public.flowers
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      FOR UPDATE
    `,
    [flowerIds],
  );
  if (flowerResult.rows.length !== flowerIds.length) {
    throw new StatusTransitionError(
      "Один из цветов заказа больше не существует",
    );
  }

  const reservedResult = await client.query<{
    flower_id: string;
    quantity: number;
  }>(
    `
      SELECT flower_id::text, COALESCE(sum(quantity), 0)::int AS quantity
      FROM public.order_stock_reservations
      WHERE status = 'active'
        AND order_id <> $1::uuid
        AND flower_id = ANY($2::bigint[])
      GROUP BY flower_id
    `,
    [orderId, flowerIds],
  );
  const reservedByFlower = new Map(
    reservedResult.rows.map((row) => [row.flower_id, Number(row.quantity)]),
  );
  const lockedById = new Map(
    flowerResult.rows.map((flower) => [flower.id, flower]),
  );
  const shortages = requirements.flatMap((requirement): Shortage[] => {
    const flower = lockedById.get(requirement.flowerId)!;
    const available = Math.max(
      0,
      Number(flower.stock_quantity) -
        (reservedByFlower.get(requirement.flowerId) ?? 0),
    );
    if (available >= requirement.requiredQuantity) return [];
    return [
      {
        name: flower.name,
        required: requirement.requiredQuantity,
        available,
        missing: requirement.requiredQuantity - available,
      },
    ];
  });
  if (shortages.length > 0) {
    throw new StatusTransitionError(
      "Нельзя подтвердить заказ: не хватает цветов",
      shortages,
    );
  }
}

async function createReservations(
  client: PoolClient,
  orderId: string,
  requirements: OrderFlowerRequirement[],
) {
  await lockFlowersAndCheckAvailability(client, orderId, requirements);
  await client.query(
    `
      INSERT INTO public.order_stock_reservations (
        order_id, flower_id, quantity, status
      )
      SELECT $1::uuid, item.flower_id, item.quantity, 'active'
      FROM unnest($2::bigint[], $3::integer[])
        AS item(flower_id, quantity)
    `,
    [
      orderId,
      requirements.map((item) => item.flowerId),
      requirements.map((item) => item.requiredQuantity),
    ],
  );
}

async function getActiveReservations(client: PoolClient, orderId: string) {
  const result = await client.query<ActiveReservation>(
    `
      SELECT id::text, flower_id::text, quantity
      FROM public.order_stock_reservations
      WHERE order_id = $1::uuid
        AND status = 'active'
      ORDER BY flower_id
      FOR UPDATE
    `,
    [orderId],
  );
  return result.rows;
}

function reservationsMatchRequirements(
  reservations: ActiveReservation[],
  requirements: OrderFlowerRequirement[],
) {
  if (reservations.length !== requirements.length) return false;
  const expected = new Map(
    requirements.map((item) => [item.flowerId, item.requiredQuantity]),
  );
  return reservations.every(
    (reservation) =>
      expected.get(reservation.flower_id) === Number(reservation.quantity),
  );
}

async function consumeReservations(
  client: PoolClient,
  order: LockedOrder,
) {
  const requirements = await readRequirements(client, order.id);
  let reservations = await getActiveReservations(client, order.id);

  if (reservations.length === 0) {
    await createReservations(client, order.id, requirements);
    reservations = await getActiveReservations(client, order.id);
  } else if (!reservationsMatchRequirements(reservations, requirements)) {
    throw new StatusTransitionError(
      "Резерв заказа не соответствует его текущему составу",
    );
  }

  const flowerIds = sortIds(
    reservations.map((reservation) => reservation.flower_id),
  );
  const flowerResult = await client.query<LockedFlower>(
    `
      SELECT id::text, name, stock_quantity
      FROM public.flowers
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      FOR UPDATE
    `,
    [flowerIds],
  );
  const stockByFlower = new Map(
    flowerResult.rows.map((flower) => [flower.id, Number(flower.stock_quantity)]),
  );
  const impossibleReservation = reservations.find(
    (reservation) =>
      (stockByFlower.get(reservation.flower_id) ?? -1) <
      Number(reservation.quantity),
  );
  if (impossibleReservation) {
    throw new StatusTransitionError(
      "Нельзя начать сборку: физического остатка недостаточно",
    );
  }

  const movementResult = await client.query(
    `
      INSERT INTO public.stock_movements (
        flower_id,
        order_id,
        reservation_id,
        movement_type,
        quantity_change,
        unit_cost,
        note
      )
      SELECT r.flower_id,
             r.order_id,
             r.id,
             'sale',
             -r.quantity,
             f.purchase_price,
             $2::text
      FROM public.order_stock_reservations r
      JOIN public.flowers f ON f.id = r.flower_id
      WHERE r.id = ANY($1::bigint[])
        AND r.status = 'active'
    `,
    [
      reservations.map((reservation) => reservation.id),
      `Списание цветов при начале сборки заказа ${order.order_number}`,
    ],
  );
  if (movementResult.rowCount !== reservations.length) {
    throw new Error(
      `Order ${order.id} movement count mismatch: expected ${reservations.length}, received ${movementResult.rowCount}`,
    );
  }

  const reservationResult = await client.query(
    `
      UPDATE public.order_stock_reservations
      SET status = 'consumed',
          consumed_at = NOW(),
          updated_at = NOW()
      WHERE id = ANY($1::bigint[])
        AND status = 'active'
    `,
    [reservations.map((reservation) => reservation.id)],
  );
  if (reservationResult.rowCount !== reservations.length) {
    throw new Error(
      `Order ${order.id} reservation count mismatch: expected ${reservations.length}, received ${reservationResult.rowCount}`,
    );
  }
}

async function syncDeliveryFromOrderStatus(
  client: PoolClient,
  order: LockedOrder,
  status: OrderStatus,
  lockedDelivery: LockedDelivery | null,
) {
  if (order.fulfillment_type === "pickup") return;

  if (status === "cancelled") {
    await client.query(
      `
        UPDATE public.deliveries
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE order_id = $1::uuid
          AND status IN ('planned', 'assigned', 'on_the_way')
      `,
      [order.id],
    );
    return;
  }

  if (status === "delivering") {
    const deliveryResult = await client.query(
      `
        UPDATE public.deliveries
        SET status = 'on_the_way',
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status = 'assigned'
      `,
      [lockedDelivery?.id ?? null],
    );
    if (deliveryResult.rowCount !== 1) {
      throw new Error(`Delivery for order ${order.id} changed concurrently`);
    }
    return;
  }

  if (status === "completed") {
    const deliveryResult = await client.query(
      `
        UPDATE public.deliveries
        SET status = 'delivered',
            delivered_at = COALESCE(delivered_at, NOW()),
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status = 'on_the_way'
      `,
      [lockedDelivery?.id ?? null],
    );
    if (deliveryResult.rowCount !== 1) {
      throw new Error(`Delivery for order ${order.id} changed concurrently`);
    }
  }
}

async function validateAndLockDeliveryTransition(
  client: PoolClient,
  order: LockedOrder,
  nextStatus: OrderStatus,
) {
  if (order.fulfillment_type === "pickup") return null;

  if (order.status === "ready" && nextStatus === "completed") {
    throw new StatusTransitionError(
      "Заказ с доставкой нельзя завершить до фактической доставки",
    );
  }

  const needsDelivery =
    (order.status === "ready" && nextStatus === "delivering") ||
    (order.status === "delivering" && nextStatus === "completed");
  if (!needsDelivery) return null;

  const deliveryResult = await client.query<LockedDelivery>(
    `
      SELECT id::text, status, courier_name, courier_user_id::text
      FROM public.deliveries
      WHERE order_id = $1::uuid
      FOR UPDATE
    `,
    [order.id],
  );
  const delivery = deliveryResult.rows[0];
  if (!delivery) {
    throw new StatusTransitionError("Для заказа не найдена доставка");
  }

  if (nextStatus === "delivering") {
    if (delivery.status !== "assigned" || !delivery.courier_user_id) {
      throw new StatusTransitionError(
        "Сначала назначьте курьера в разделе «Доставка»",
      );
    }
  } else if (delivery.status !== "on_the_way") {
    throw new StatusTransitionError(
      "Заказ можно завершить только после перевода доставки в статус «В пути»",
    );
  }

  return delivery;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await authorizeApi("orders.work", request);
  if (session instanceof Response) return session;

  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return Response.json(
      { success: false, message: "Некорректный идентификатор заказа" },
      { status: 400 },
    );
  }

  let body: { status?: unknown; comment?: unknown };
  try {
    const parsedBody: unknown = await request.json();
    if (
      !parsedBody ||
      typeof parsedBody !== "object" ||
      Array.isArray(parsedBody)
    ) {
      throw new Error("Invalid request body");
    }
    body = parsedBody as { status?: unknown; comment?: unknown };
  } catch {
    return Response.json(
      { success: false, message: "Некорректный запрос" },
      { status: 400 },
    );
  }
  if (!isOrderStatus(body.status)) {
    return Response.json(
      { success: false, message: "Недопустимый статус заказа" },
      { status: 400 },
    );
  }
  if (
    body.comment !== undefined &&
    body.comment !== null &&
    typeof body.comment !== "string"
  ) {
    return Response.json(
      { success: false, message: "Некорректное примечание" },
      { status: 400 },
    );
  }
  const requestedComment =
    typeof body.comment === "string" ? body.comment.trim() : "";
  if (requestedComment.length > 1_000) {
    return Response.json(
      { success: false, message: "Примечание слишком длинное" },
      { status: 400 },
    );
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const orderResult = await client.query<LockedOrder>(
      `
        SELECT id::text, order_number, status, fulfillment_type
        FROM public.orders
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [id],
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return Response.json(
        { success: false, message: "Заказ не найден" },
        { status: 404 },
      );
    }

    if (order.fulfillment_type === "pickup" && body.status === "delivering") {
      throw new StatusTransitionError("Для самовывоза статус «Доставляется» недопустим");
    }
    if (!canWorkOrder(session.roles, order.status, body.status)) {
      await client.query("ROLLBACK");
      return Response.json({ message: "Недостаточно прав для этого статуса" }, { status: 403 });
    }
    if (order.status === body.status) {
      await client.query("COMMIT");
      return Response.json({
        success: true,
        message: "Статус заказа уже установлен",
        order,
      });
    }
    if (!canTransitionOrderStatus(order.status, body.status, order.fulfillment_type)) {
      throw new StatusTransitionError(
        "Недопустимый переход статуса заказа",
      );
    }

    if (body.status === "cancelled") {
      const paymentResult = await client.query<LockedPayment>(
        `
          SELECT status
          FROM public.payments
          WHERE order_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [order.id],
      );
      if (paymentResult.rows[0]?.status === "paid") {
        await client.query("ROLLBACK");
        return Response.json(
          {
            success: false,
            message: "Сначала оформите возврат оплаты, затем отмените заказ",
          },
          { status: 409 },
        );
      }
    }
    const lockedDelivery = await validateAndLockDeliveryTransition(
      client,
      order,
      body.status,
    );

    let warning: string | undefined;
    let historyComment = requestedComment || null;
    if (order.status === "new" && body.status === "confirmed") {
      const requirements = await readRequirements(client, order.id);
      await createReservations(client, order.id, requirements);
      historyComment ??= "Цветы зарезервированы";
    } else if (order.status === "confirmed" && body.status === "preparing") {
      await consumeReservations(client, order);
      historyComment ??= "Цветы списаны со склада для сборки";
    } else if (order.status === "confirmed" && body.status === "cancelled") {
      await client.query(
        `
          UPDATE public.order_stock_reservations
          SET status = 'released',
              released_at = NOW(),
              updated_at = NOW()
          WHERE order_id = $1::uuid
            AND status = 'active'
        `,
        [order.id],
      );
      historyComment ??= "Резерв цветов освобождён";
    } else if (
      body.status === "cancelled" &&
      ["preparing", "ready", "delivering"].includes(order.status)
    ) {
      warning =
        "Цветы уже списаны. Для фактического возврата используйте ручную корректировку склада.";
      historyComment ??= warning;
    }

    await updateOrderStatusWithHistory(
      client,
      order.id,
      order.status,
      body.status,
      historyComment,
    );
    await syncDeliveryFromOrderStatus(
      client,
      order,
      body.status,
      lockedDelivery,
    );
    await audit(client, session.userId, "order.status", order.id, { before: order.status, after: body.status });
    await client.query("COMMIT");

    revalidatePath("/admin");
    revalidatePath("/admin/deliveries");
    revalidatePath("/admin/inventory");
    return Response.json({
      success: true,
      message: "Статус заказа обновлён",
      warning,
      order: { ...order, status: body.status },
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("Order status rollback failed:", rollbackError);
      });
    }
    if (!(error instanceof StatusTransitionError)) {
      const databaseError = error as {
        code?: unknown;
        detail?: unknown;
        constraint?: unknown;
      };
      console.error("PATCH /api/admin/orders/[id]/status failed:", {
        error,
        code: databaseError?.code,
        detail: databaseError?.detail,
        constraint: databaseError?.constraint,
      });
    }
    if (error instanceof StatusTransitionError) {
      return Response.json(
        {
          success: false,
          message: error.message,
          shortages: error.shortages,
        },
        { status: 409 },
      );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return Response.json(
        { success: false, message: "Заказ уже был обработан" },
        { status: 409 },
      );
    }
    return Response.json(
      { success: false, message: "Не удалось изменить статус заказа" },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
