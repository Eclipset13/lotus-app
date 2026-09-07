import { db } from "@/lib/db";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const runtime = "nodejs";

const allowedStatuses = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "delivering",
  "completed",
  "cancelled",
] as const;

type OrderStatus = (typeof allowedStatuses)[number];

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  if (!(await isAdminAuthenticated())) {
    return Response.json(
      { success: false, message: "Требуется вход в админ-панель" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuidPattern.test(id)) {
  return Response.json(
    { success: false, message: "Некорректный идентификатор заказа" },
    { status: 400 }
  );
}

  let body: { status?: OrderStatus };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, message: "Некорректный запрос" },
      { status: 400 }
    );
  }

  if (
    !body.status ||
    !allowedStatuses.includes(body.status)
  ) {
    return Response.json(
      { success: false, message: "Недопустимый статус заказа" },
      { status: 400 }
    );
  }

  try {
    const result = await db.query<{
      id: string;
      order_number: string;
      status: OrderStatus;
    }>(
      `
        UPDATE orders
        SET
          status = $1,
          updated_at = now()
        WHERE id = $2
        RETURNING
          id::text,
          order_number,
          status
      `,
      [body.status, id]
    );

    const updatedOrder = result.rows[0];

    if (!updatedOrder) {
      return Response.json(
        { success: false, message: "Заказ не найден" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: "Статус заказа обновлён",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Ошибка изменения статуса заказа:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось изменить статус заказа",
      },
      { status: 500 }
    );
  }
}