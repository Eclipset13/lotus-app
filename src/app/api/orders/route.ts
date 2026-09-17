import { normalizePhone } from "@/lib/phone";
import { findOrCreateCustomer, CustomerPhoneConflictError } from "@/lib/customers";
import { db } from "@/lib/db";
import type { PoolClient } from "pg";
import { loadConstructorStock, verifyCustomBouquet, checkCartFlowerAvailability, BouquetAvailabilityError } from "@/lib/constructor-stock";
import {
  calculateCustomBouquetPrice,
  createCustomBouquetSummary,
  sanitizeCustomBouquetConfig,
  type CustomBouquetConfig,
} from "@/lib/bouquet";
import {
  createBouquetCompositionSnapshot,
  type BouquetCompositionSnapshot,
} from "@/lib/order-flower-requirements";
import { recalculateOrderFinancials } from "@/lib/order-financials";

export const runtime = "nodejs";

class OrderRateLimitError extends Error {}

type CheckoutRequest = {
  customer: {
    name: string;
    phone: string;
  };
  fulfillmentType: "delivery" | "pickup";
  delivery?: {
    recipientName?: string;
    recipientPhone?: string;
    streetAddress?: string;
    apartment?: string;
    entrance?: string;
    floor?: string;
    comment?: string;
    requestedAt?: string | null;
  };
  paymentMethod: "cash" | "transfer";
  customerComment?: string;
  items: Array<{
    itemType?: "catalog-bouquet" | "custom-bouquet";
    id?: unknown;
    quantity?: unknown;
    configuration?: unknown;
    displayedUnitPrice?: unknown;
  }>;
};

type NormalizedCustomBouquet = {
  configuration: CustomBouquetConfig;
  quantity: number;
  displayedUnitPrice: number | null;
};

type BouquetCompositionRow = {
  bouquet_id: string;
  flower_id: string;
  flower_name: string;
  quantity: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  let body: CheckoutRequest;

  try {
    body = (await request.json()) as CheckoutRequest;
  } catch {
    return Response.json(
      { success: false, message: "Некорректные данные заказа" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return Response.json(
      { success: false, message: "Некорректные данные заказа" },
      { status: 400 }
    );
  }

  const customerName = trimString(body.customer?.name);
  const customerPhone = trimString(body.customer?.phone);
  const canonicalPhone = normalizePhone(customerPhone);
  const streetAddress = trimString(body.delivery?.streetAddress);

  const textFields: Array<[unknown, number, string]> = [
    [body.customer?.name, 120, "Имя покупателя"],
    [body.delivery?.recipientName, 120, "Имя получателя"],
    [body.delivery?.streetAddress, 300, "Улица"],
    [body.delivery?.apartment, 50, "Квартира"],
    [body.delivery?.entrance, 50, "Подъезд"],
    [body.delivery?.floor, 50, "Этаж"],
    [body.customerComment, 2000, "Комментарий покупателя"],
    [body.delivery?.comment, 2000, "Комментарий доставки"],
  ];
  for (const [value, maxLength, label] of textFields) {
    if (typeof value === "string" && value.length > maxLength) {
      return Response.json(
        { success: false, message: `${label}: максимум ${maxLength} символов` },
        { status: 400 }
      );
    }
  }

  if (!customerName || !canonicalPhone) {
    return Response.json(
      {
        success: false,
        message: "Проверьте имя и номер телефона",
      },
      { status: 400 }
    );
  }

  if (
    body.fulfillmentType !== "delivery" &&
    body.fulfillmentType !== "pickup"
  ) {
    return Response.json(
      { success: false, message: "Выберите способ получения заказа" },
      { status: 400 }
    );
  }

  const recipientPhoneInput = body.delivery?.recipientPhone;
  const recipientPhone =
    recipientPhoneInput == null ||
    (typeof recipientPhoneInput === "string" && !recipientPhoneInput.trim())
      ? canonicalPhone
      : normalizePhone(recipientPhoneInput);
  if (!recipientPhone) {
    return Response.json(
      { success: false, message: "Проверьте телефон получателя" },
      { status: 400 }
    );
  }

  if (
    body.paymentMethod !== "cash" &&
    body.paymentMethod !== "transfer"
  ) {
    return Response.json(
      { success: false, message: "Выберите способ оплаты" },
      { status: 400 }
    );
  }

  if (
    body.fulfillmentType === "delivery" &&
    !streetAddress
  ) {
    return Response.json(
      { success: false, message: "Укажите адрес доставки" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 100
  ) {
    return Response.json(
      { success: false, message: "Некорректный состав заказа" },
      { status: 400 }
    );
  }

  const catalogItems = new Map<
    string,
    { quantity: number; displayedUnitPrice: number | null }
  >();
  const customBouquets: NormalizedCustomBouquet[] = [];

  for (const item of body.items ?? []) {
    if (!isRecord(item)) {
      return Response.json(
        { success: false, message: "Некорректный товар в корзине" },
        { status: 400 }
      );
    }

    const quantity = Number(item.quantity);
    const displayedUnitPrice = Number(item.displayedUnitPrice);

    if (
      item.itemType !== undefined &&
      item.itemType !== "catalog-bouquet" &&
      item.itemType !== "custom-bouquet"
    ) {
      return Response.json(
        { success: false, message: "Неизвестный тип товара" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      return Response.json(
        { success: false, message: "Проверьте количество товаров" },
        { status: 400 }
      );
    }

    if (item.itemType === "custom-bouquet") {
      const configuration = sanitizeCustomBouquetConfig(
        item.configuration
      );

      if (!configuration) {
        return Response.json(
          {
            success: false,
            message: "Конфигурация авторского букета повреждена",
          },
          { status: 400 }
        );
      }

      customBouquets.push({
        configuration,
        quantity,
        displayedUnitPrice: Number.isFinite(displayedUnitPrice)
          ? displayedUnitPrice
          : null,
      });
      continue;
    }

    if (
      typeof item.id === "string" &&
      item.id.length <= 19 &&
      /^[1-9][0-9]*$/.test(item.id) &&
      (item.id.length < 19 || item.id <= "9223372036854775807")
    ) {
      const existing = catalogItems.get(item.id);
      const nextQuantity = (existing?.quantity ?? 0) + quantity;

      if (nextQuantity > 99) {
        return Response.json(
          { success: false, message: "Слишком большое количество товара" },
          { status: 400 }
        );
      }

      catalogItems.set(item.id, {
        quantity: nextQuantity,
        displayedUnitPrice: Number.isFinite(displayedUnitPrice)
          ? displayedUnitPrice
          : existing?.displayedUnitPrice ?? null,
      });
    } else {
      return Response.json(
        { success: false, message: "Некорректный товар в корзине" },
        { status: 400 }
      );
    }
  }

  if (catalogItems.size === 0 && customBouquets.length === 0) {
    return Response.json(
      { success: false, message: "Корзина пуста" },
      { status: 400 }
    );
  }

  let requestedAt: string | null = null;

  const requestedAtInput = trimString(body.delivery?.requestedAt);

  if (requestedAtInput) {
    const requestedDate = new Date(requestedAtInput);

    if (Number.isNaN(requestedDate.getTime())) {
      return Response.json(
        { success: false, message: "Проверьте дату доставки" },
        { status: 400 }
      );
    }

    requestedAt = requestedDate.toISOString();
  }

  let client: PoolClient | null = null;
  let transactionStarted = false;

  try {
    client = await db.connect();
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    transactionStarted = true;

    const bouquetIds = [...catalogItems.keys()];

    const bouquetResult = await client.query<{
      id: string;
      name: string;
      sale_price: string;
    }>(
      `
        SELECT
          id::text AS id,
          name,
          sale_price::text AS sale_price
        FROM bouquets
        WHERE id = ANY($1::bigint[])
          AND is_active = true
      `,
      [bouquetIds]
    );

    if (bouquetResult.rows.length !== bouquetIds.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return Response.json(
        {
          success: false,
          message: "Некоторые букеты больше недоступны",
        },
        { status: 400 }
      );
    }

    const bouquets = new Map(
      bouquetResult.rows.map((bouquet) => [bouquet.id, bouquet])
    );

    const compositionResult = await client.query<BouquetCompositionRow>(
      `
        SELECT bi.bouquet_id::text,
               bi.flower_id::text,
               f.name AS flower_name,
               bi.quantity
        FROM public.bouquet_items bi
        INNER JOIN public.flowers f ON f.id = bi.flower_id
        WHERE bi.bouquet_id = ANY($1::bigint[])
        ORDER BY bi.bouquet_id, bi.flower_id
      `,
      [bouquetIds]
    );
    const compositionByBouquet = new Map<string, BouquetCompositionRow[]>();
    for (const compositionItem of compositionResult.rows) {
      const composition =
        compositionByBouquet.get(compositionItem.bouquet_id) ?? [];
      composition.push(compositionItem);
      compositionByBouquet.set(compositionItem.bouquet_id, composition);
    }
    const snapshotsByBouquet = new Map<string, BouquetCompositionSnapshot>();

    for (const bouquet of bouquetResult.rows) {
      const snapshot = createBouquetCompositionSnapshot(
        (compositionByBouquet.get(bouquet.id) ?? []).map((item) => ({
          flowerId: item.flower_id,
          name: item.flower_name,
          quantity: Number(item.quantity),
        }))
      );

      if (!snapshot) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return Response.json(
          {
            success: false,
            message: `Для букета «${bouquet.name}» не настроен состав`,
          },
          { status: 400 }
        );
      }

      snapshotsByBouquet.set(bouquet.id, snapshot);
    }

    const stock = await loadConstructorStock(client);
    const requirements = new Map<string, number>();
    const addRequirement = (id: string, quantity: number) =>
      requirements.set(id, (requirements.get(id) ?? 0) + quantity);
    for (const [id, item] of catalogItems) {
      for (const flower of snapshotsByBouquet.get(id)!.flowers) {
        addRequirement(flower.flowerId, flower.quantity * item.quantity);
      }
    }
    for (const item of customBouquets) {
      item.configuration = verifyCustomBouquet(item.configuration, stock.flowers, stock.legacyLinks);
      for (const flower of item.configuration.flowers) addRequirement(flower.flowerId!, item.quantity);
    }
    // Checkout checks the whole cart but neither reserves nor changes stock.
    // Confirmation performs the existing locked check again.
    checkCartFlowerAvailability(requirements, stock.flowers);

    let priceAdjusted = false;

    for (const [id, item] of catalogItems) {
      const bouquet = bouquets.get(id);

      if (!bouquet) {
        throw new Error("Bouquet not found");
      }

      const unitPrice = Number(bouquet.sale_price);

      if (
        item.displayedUnitPrice !== null &&
        Math.abs(item.displayedUnitPrice - unitPrice) > 0.001
      ) {
        priceAdjusted = true;
      }
    }

    for (const item of customBouquets) {
      const unitPrice = calculateCustomBouquetPrice(item.configuration);

      if (
        item.displayedUnitPrice !== null &&
        Math.abs(item.displayedUnitPrice - unitPrice) > 0.001
      ) {
        priceAdjusted = true;
      }
    }

    const customerId = await findOrCreateCustomer(client, customerName, canonicalPhone);

    // The customer's transaction lock stays held through COMMIT/ROLLBACK.
    // READ COMMITTED sees orders committed by the previous lock holder.
    const recentOrders = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.orders
       WHERE customer_id = $1
         AND created_at >= statement_timestamp() - interval '10 minutes'`,
      [customerId]
    );
    if (recentOrders.rows[0].count >= 3) {
      throw new OrderRateLimitError();
    }

    const orderResult = await client.query<{
      id: string;
      order_number: string;
    }>(
      `
        INSERT INTO orders (
          customer_id,
          fulfillment_type,
          subtotal,
          discount_amount,
          delivery_cost,
          total_amount,
          customer_comment
        )
        VALUES ($1, $2, $3, 0, $4, $5, $6)
        RETURNING id, order_number
      `,
      [
        customerId,
        body.fulfillmentType,
        "0.00",
        "0.00",
        "0.00",
        trimString(body.customerComment) || null,
      ]
    );

    const order = orderResult.rows[0];

    await client.query(
      `
        INSERT INTO public.order_status_history (
          order_id,
          old_status,
          new_status,
          changed_by,
          comment
        )
        VALUES ($1::uuid, NULL, 'new'::varchar, NULL, NULL)
      `,
      [order.id]
    );

    for (const [id, item] of catalogItems) {
      const bouquet = bouquets.get(id);

      if (!bouquet) {
        throw new Error("Bouquet not found");
      }
      const compositionSnapshot = snapshotsByBouquet.get(id);
      if (!compositionSnapshot) {
        throw new Error("Bouquet composition snapshot not found");
      }

      await client.query(
        `
          INSERT INTO order_items (
            order_id,
            item_type,
            bouquet_id,
            product_name,
            quantity,
            unit_price,
            unit_cost,
            bouquet_composition_snapshot
          )
          VALUES ($1, 'bouquet', $2, $3, $4, $5, 0, $6::jsonb)
        `,
        [
          order.id,
          id,
          bouquet.name,
          item.quantity,
          bouquet.sale_price,
          JSON.stringify(compositionSnapshot),
        ]
      );
    }

    for (const item of customBouquets) {
      const unitPrice = calculateCustomBouquetPrice(item.configuration);
      const summary = createCustomBouquetSummary(item.configuration);

      await client.query(
        `
          INSERT INTO order_items (
            order_id,
            item_type,
            bouquet_id,
            flower_id,
            product_name,
            quantity,
            unit_price,
            unit_cost,
            custom_configuration,
            custom_summary
          )
          VALUES ($1, 'custom_bouquet', NULL, NULL, 'Авторский букет', $2, $3, 0, $4::jsonb, $5::jsonb)
        `,
        [
          order.id,
          item.quantity,
          unitPrice.toFixed(2),
          JSON.stringify(item.configuration),
          JSON.stringify(summary),
        ]
      );
    }

    if (body.fulfillmentType === "delivery") {
      await client.query(
        `
          INSERT INTO deliveries (
            order_id,
            recipient_name,
            recipient_phone,
            city,
            street_address,
            apartment,
            entrance,
            floor,
            delivery_comment,
            requested_at
          )
          VALUES ($1, $2, $3, 'Душанбе', $4, $5, $6, $7, $8, $9)
        `,
        [
          order.id,
          trimString(body.delivery?.recipientName) || customerName,
          recipientPhone,
          streetAddress,
          trimString(body.delivery?.apartment) || null,
          trimString(body.delivery?.entrance) || null,
          trimString(body.delivery?.floor) || null,
          trimString(body.delivery?.comment) || null,
          requestedAt,
        ]
      );
    }

    const financials = await recalculateOrderFinancials(client, order.id, "0.00");

    await client.query(
      `
        INSERT INTO payments (
          order_id,
          method,
          status,
          amount
        )
        VALUES ($1, $2, 'pending', $3)
      `,
      [
        order.id,
        body.paymentMethod,
        financials.totalAmount,
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return Response.json({
      success: true,
      message: "Заказ успешно оформлен",
      orderNumber: order.order_number,
      totalAmount: Number(financials.totalAmount),
      priceAdjusted,
    });
  } catch (error) {
    if (transactionStarted && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("POST /api/orders rollback failed:", rollbackError);
      }
    }
    if (error instanceof BouquetAvailabilityError) {
      return Response.json({ success: false, message: error.message }, { status: 400 });
    }
    if (error instanceof OrderRateLimitError) {
      return Response.json(
        { success: false, message: "Слишком много заказов. Попробуйте немного позже" },
        { status: 429, headers: { "Retry-After": "600" } }
      );
    }
    if (error instanceof CustomerPhoneConflictError) {
      return Response.json({ success: false, message: "Для этого номера оформление недоступно. Свяжитесь с магазином." }, { status: 409 });
    }
    console.error("POST /api/orders failed:", error);

    return Response.json(
      {
        success: false,
        message: "Не удалось оформить заказ. Попробуйте ещё раз.",
      },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
