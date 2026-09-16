import { db } from "@/lib/db";
import { authorizeApi } from "@/lib/admin-auth";
import { audit } from "@/lib/admin-audit";
import type { PoolClient } from "pg";

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

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");

    const orderResult = await client.query<{
      id: string;
      status: string;
    }>(
      `
        SELECT id::text, status
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

    const result = await client.query<{
      id: string;
      order_id: string;
      status: PaymentStatus;
    }>(
      `
        SELECT id::text, order_id::text, status
        FROM public.payments
        WHERE order_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [id],
    );

    const payment = result.rows[0];

    if (!payment) {
      await client.query("ROLLBACK");
      return Response.json(
        {
          success: false,
          message: "Платёж для этого заказа не найден",
        },
        { status: 404 }
      );
    }

    if (order.status === "cancelled") {
      await client.query("ROLLBACK");
      return Response.json(
        {
          success: false,
          message: "Нельзя изменить оплату отменённого заказа",
        },
        { status: 409 },
      );
    }

    if (payment.status === body.status) {
      await client.query("COMMIT");
      return Response.json({
        success: true,
        message: "Статус оплаты уже установлен",
        payment,
      });
    }

    const updated = await client.query<{
      id: string;
      order_id: string;
      status: PaymentStatus;
    }>(
      `
        UPDATE public.payments
        SET status = $1
        WHERE id = $2::uuid
        RETURNING id::text, order_id::text, status
      `,
      [body.status, payment.id],
    );
    await audit(client, session.userId, "payment.status", id, {
      before: payment.status,
      after: body.status,
    });
    await client.query("COMMIT");

    return Response.json({
      success: true,
      message: "Статус оплаты обновлён",
      payment: updated.rows[0],
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("Откат изменения оплаты не выполнен:", rollbackError);
      });
    }
    console.error("Ошибка изменения оплаты:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось изменить статус оплаты",
      },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}