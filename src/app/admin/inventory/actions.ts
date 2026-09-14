"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export type InventoryActionState = {
  error: string;
  message: string;
  currentStock?: number;
};

type LockedFlower = {
  id: string;
  stock_quantity: number;
};

type ActiveReservationTotal = {
  quantity: number;
};

class InventoryValidationError extends Error {}

const MAX_BIGINT = "9223372036854775807";
const MAX_QUANTITY = 2_147_483_647;
const MAX_MIN_STOCK = 1_000_000;
const MAX_REASON_LENGTH = 500;
const CONSTRUCTOR_KINDS = new Set(["rose", "peony", "tulip"]);

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

function parsePositiveInteger(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed <= MAX_QUANTITY ? parsed : null;
}

function safeAdjustmentError(error: unknown): InventoryActionState {
  if (error instanceof InventoryValidationError) {
    return { error: error.message, message: "" };
  }
  console.error("adjustInventory failed:", error);
  return { error: "Не удалось скорректировать остаток", message: "" };
}

function revalidateInventory(flowerId: string) {
  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${flowerId}`);
}

export async function adjustInventory(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Требуется вход администратора", message: "" };
  }
  if (!isDatabaseId(flowerId)) {
    return { error: "Цветок не найден", message: "" };
  }

  const operation = String(formData.get("operation") ?? "");
  const quantity = parsePositiveInteger(formData.get("quantity"));
  const reason = String(formData.get("reason") ?? "").trim();
  const expectedStockText = String(formData.get("expected_stock") ?? "").trim();
  const expectedStock = /^\d+$/.test(expectedStockText)
    ? Number(expectedStockText)
    : null;

  if (operation !== "increase" && operation !== "decrease") {
    return { error: "Выберите операцию", message: "" };
  }
  if (quantity === null) {
    return { error: "Введите целое положительное количество", message: "" };
  }
  if (!reason) {
    return { error: "Укажите причину корректировки", message: "" };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { error: "Сократите причину корректировки", message: "" };
  }
  if (expectedStock === null || !Number.isSafeInteger(expectedStock)) {
    return { error: "Обновите страницу и повторите корректировку", message: "" };
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const flowerResult = await client.query<LockedFlower>(
      `
        SELECT id::text, stock_quantity
        FROM public.flowers
        WHERE id = $1::bigint
        FOR UPDATE
      `,
      [flowerId],
    );
    const flower = flowerResult.rows[0];
    if (!flower) {
      throw new InventoryValidationError("Цветок не найден");
    }

    const currentStock = Number(flower.stock_quantity);
    if (!Number.isInteger(currentStock) || currentStock < 0) {
      throw new InventoryValidationError("Текущий остаток содержит ошибку");
    }
    if (currentStock !== expectedStock) {
      throw new InventoryValidationError(
        "Остаток уже изменился. Обновите страницу и повторите корректировку.",
      );
    }
    const reservationResult = await client.query<ActiveReservationTotal>(
      `
        SELECT COALESCE(sum(quantity), 0)::int AS quantity
        FROM public.order_stock_reservations
        WHERE flower_id = $1::bigint
          AND status = 'active'
      `,
      [flowerId],
    );
    const activeReservedQuantity = Number(
      reservationResult.rows[0]?.quantity ?? 0,
    );
    const availableQuantity = Math.max(
      0,
      currentStock - activeReservedQuantity,
    );
    if (operation === "decrease" && quantity > availableQuantity) {
      throw new InventoryValidationError(
        `Нельзя списать ${quantity} шт. Свободно только ${availableQuantity} шт., остальные зарезервированы заказами.`,
      );
    }
    if (operation === "increase" && currentStock + quantity > MAX_QUANTITY) {
      throw new InventoryValidationError("Остаток превышает допустимое значение");
    }

    const quantityChange = operation === "increase" ? quantity : -quantity;
    const movementType = operation === "increase" ? "correction" : "write_off";
    await client.query(
      `
        INSERT INTO public.stock_movements (
          flower_id,
          movement_type,
          quantity_change,
          note
        )
        VALUES ($1::bigint, $2::varchar, $3::integer, $4::text)
      `,
      [flowerId, movementType, quantityChange, reason],
    );

    const updatedResult = await client.query<{ stock_quantity: number }>(
      `SELECT stock_quantity FROM public.flowers WHERE id = $1::bigint`,
      [flowerId],
    );
    const expectedUpdatedStock = currentStock + quantityChange;
    const updatedStock = Number(updatedResult.rows[0]?.stock_quantity);
    if (updatedStock !== expectedUpdatedStock) {
      throw new Error(
        `Stock trigger result mismatch for flower ${flowerId}: expected ${expectedUpdatedStock}, received ${updatedStock}`,
      );
    }

    await client.query("COMMIT");
    revalidateInventory(flowerId);
    return {
      error: "",
      message: `Остаток изменён: ${currentStock} → ${updatedStock}`,
      currentStock: updatedStock,
    };
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("adjustInventory rollback failed:", rollbackError);
      });
    }
    return safeAdjustmentError(error);
  } finally {
    client?.release();
  }
}

export async function updateMinimumStock(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Требуется вход администратора", message: "" };
  }
  if (!isDatabaseId(flowerId)) {
    return { error: "Цветок не найден", message: "" };
  }

  const rawValue = String(formData.get("min_stock_quantity") ?? "").trim();
  if (!/^\d+$/.test(rawValue)) {
    return { error: "Минимальный остаток должен быть целым числом", message: "" };
  }
  const minimumStock = Number(rawValue);
  if (!Number.isSafeInteger(minimumStock) || minimumStock > MAX_MIN_STOCK) {
    return {
      error: `Минимальный остаток должен быть от 0 до ${MAX_MIN_STOCK}`,
      message: "",
    };
  }

  try {
    const result = await db.query(
      `
        UPDATE public.flowers
        SET min_stock_quantity = $1,
            updated_at = NOW()
        WHERE id = $2::bigint
        RETURNING id
      `,
      [minimumStock, flowerId],
    );
    if (result.rowCount !== 1) {
      return { error: "Цветок не найден", message: "" };
    }
  } catch (error) {
    console.error("updateMinimumStock failed:", error);
    return { error: "Не удалось сохранить минимальный остаток", message: "" };
  }

  revalidateInventory(flowerId);
  return { error: "", message: "Минимальный остаток сохранён" };
}

export async function updateConstructorKind(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!(await isAdminAuthenticated())) {
    return { error: "Требуется вход администратора", message: "" };
  }
  if (!isDatabaseId(flowerId)) {
    return { error: "Цветок не найден", message: "" };
  }

  const rawKind = String(formData.get("constructor_kind") ?? "").trim();
  if (rawKind && !CONSTRUCTOR_KINDS.has(rawKind)) {
    return { error: "Выберите допустимый тип цветка", message: "" };
  }

  try {
    const result = await db.query(
      `
        UPDATE public.flowers
        SET constructor_kind = $1,
            updated_at = NOW()
        WHERE id = $2::bigint
        RETURNING id
      `,
      [rawKind || null, flowerId],
    );
    if (result.rowCount !== 1) {
      return { error: "Цветок не найден", message: "" };
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return {
        error: "Этот тип уже связан с другим цветком",
        message: "",
      };
    }
    console.error("updateConstructorKind failed:", error);
    return {
      error: "Не удалось сохранить связь со старым конструктором",
      message: "",
    };
  }

  revalidateInventory(flowerId);
  return { error: "", message: "Связь со старым конструктором сохранена" };
}
