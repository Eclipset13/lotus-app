import { db } from "@/lib/db";
import { authorizeApi } from "@/lib/admin-auth";

export const runtime = "nodejs";

const allowedStatuses = ["pending", "paid"] as const;

type PaymentStatus = (typeof allowedStatuses)[number];

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const session = await authorizeApi("payments.manage", request);
  if (session instanceof Response) return session;

  const { id } = await context.params;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(id)) {
    return Response.json(
      {
        success: false,
        message: "Некорректный идентификатор заказа",
      },
      { status: 400 }
    );
  }

  let body: { status?: PaymentStatus };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        success: false,
        message: "Некорректный запрос",
      },
      { status: 400 }
    );
  }

  if (
    !body.status ||
    !allowedStatuses.includes(body.status)
  ) {
    return Response.json(
      {
        success: false,
        message: "Недопустимый статус оплаты",
      },
      { status: 400 }
    );
  }

  try {
    const result = await db.query<{
      id: string;
      order_id: string;
      status: PaymentStatus;
    }>(
      `
        UPDATE payments
        SET status = $1
        WHERE id = (
          SELECT id
          FROM payments
          WHERE order_id = $2
          ORDER BY created_at DESC
          LIMIT 1
        )
        RETURNING
          id::text,
          order_id::text,
          status
      `,
      [body.status, id]
    );

    const payment = result.rows[0];

    if (!payment) {
      return Response.json(
        {
          success: false,
          message: "Платёж для этого заказа не найден",
        },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      message: "Статус оплаты обновлён",
      payment,
    });
  } catch (error) {
    console.error("Ошибка изменения оплаты:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось изменить статус оплаты",
      },
      { status: 500 }
    );
  }
}