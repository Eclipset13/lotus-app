import type { PoolClient } from "pg";
import { audit } from "@/lib/admin-audit";
import { authorizeApi } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { parsePrice } from "@/lib/money-input";
import { recalculateOrderFinancials } from "@/lib/order-financials";

export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LockedOrder = {
  id: string;
  status: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_cost: string;
  total_amount: string;
};

type LockedPayment = {
  id: string;
  status: string;
  amount: string;
};

function invalidRequest(message = "Укажите корректную стоимость доставки") {
  return Response.json({ success: false, message }, { status: 400 });
}

function conflict(message: string) {
  return Response.json({ success: false, message }, { status: 409 });
}

function normalizeDeliveryFee(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return parsePrice(String(value));
  }
  return parsePrice(value);
}

async function rollback(client: PoolClient | null) {
  if (!client) return;
  await client.query("ROLLBACK").catch((rollbackError) => {
    console.error("Не удалось откатить изменение стоимости доставки:", rollbackError);
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await authorizeApi("payments.manage", request);
  if (session instanceof Response) return session;

  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return invalidRequest("Некорректный идентификатор заказа");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("Некорректный запрос");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("deliveryFee" in body)
  ) {
    return invalidRequest("Запрос должен содержать только стоимость доставки");
  }

  const deliveryFee = normalizeDeliveryFee(
    (body as { deliveryFee?: unknown }).deliveryFee,
  );
  if (deliveryFee === null) {
    return invalidRequest(
      "Стоимость доставки должна быть неотрицательным числом с максимум двумя знаками после запятой",
    );
  }

  let client: PoolClient | null = null;
  let transactionStarted = false;

  try {
    client = await db.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const orderResult = await client.query<LockedOrder>(
      `
        SELECT id::text, status, fulfillment_type,
               delivery_cost::text, total_amount::text
        FROM public.orders
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [id],
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return Response.json(
        { success: false, message: "Заказ не найден" },
        { status: 404 },
      );
    }

    const paymentResult = await client.query<LockedPayment>(
      `
        SELECT id::text, status, amount::text
        FROM public.payments
        WHERE order_id = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [id],
    );
    const payment = paymentResult.rows[0] ?? null;

    if (order.fulfillment_type === "pickup") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return conflict("Для самовывоза стоимость доставки всегда равна нулю");
    }
    if (order.status === "cancelled") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return conflict("Стоимость доставки отменённого заказа изменить нельзя");
    }
    if (order.status === "completed") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return conflict("Стоимость доставки выполненного заказа изменить нельзя");
    }
    if (payment && payment.status !== "pending") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      const message = payment.status === "paid"
        ? "Стоимость доставки оплаченного заказа изменить нельзя"
        : payment.status === "refunded"
          ? "Стоимость доставки заказа с возвратом изменить нельзя"
          : "Стоимость доставки можно менять только при ожидающей оплате";
      return conflict(message);
    }

    const amounts = await recalculateOrderFinancials(client, id, deliveryFee);
    let newPaymentAmount: string | null = payment?.amount ?? null;

    if (payment) {
      const updatedPayment = await client.query<{ amount: string }>(
        `
          UPDATE public.payments
          SET amount = $1::numeric(12,2), updated_at = now()
          WHERE id = $2::uuid AND status = 'pending'
          RETURNING amount::text
        `,
        [amounts.totalAmount, payment.id],
      );
      if (!updatedPayment.rows[0]) {
        throw new Error("Pending payment changed while delivery fee was updated");
      }
      newPaymentAmount = updatedPayment.rows[0].amount;
    }

    const deliveryChanged = order.delivery_cost !== amounts.deliveryCost;
    if (deliveryChanged) {
      await audit(client, session.userId, "order.delivery_fee", id, {
        order_id: id,
        old_delivery_fee: order.delivery_cost,
        new_delivery_fee: amounts.deliveryCost,
        subtotal: amounts.subtotal,
        old_total: order.total_amount,
        new_total: amounts.totalAmount,
        old_payment_amount: payment?.amount ?? null,
        new_payment_amount: newPaymentAmount,
        staff_id: session.userId,
      });
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return Response.json({
      success: true,
      message: deliveryChanged
        ? "Стоимость доставки сохранена"
        : "Стоимость доставки уже была сохранена",
      financials: {
        ...amounts,
        paymentAmount: newPaymentAmount,
      },
    });
  } catch (error) {
    if (transactionStarted) await rollback(client);
    console.error("Не удалось изменить стоимость доставки:", error);
    return Response.json(
      { success: false, message: "Не удалось сохранить стоимость доставки" },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
