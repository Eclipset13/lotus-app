"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/admin-audit";
import { isDatabaseId, parseCategory, parseFlowerDetails } from "@/lib/flower-admin";
import { parsePrice } from "@/lib/money-input";

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

type DeletableFlower = {
  id: string;
  stock_quantity: number;
  constructor_kind: string | null;
};

type FlowerDependencies = {
  used: boolean;
};

class InventoryValidationError extends Error {}

const MAX_QUANTITY = 2_147_483_647;
const MAX_REASON_LENGTH = 500;

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
  revalidatePath("/bouquet-builder");
  revalidatePath("/", "layout");
}

function databaseCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
}

function logMutationFailure(operation: string, error: unknown) {
  const value = error as { code?: unknown; table?: unknown; column?: unknown; constraint?: unknown };
  console.error(`${operation} failed`, {
    code: typeof value?.code === "string" ? value.code : undefined,
    table: typeof value?.table === "string" ? value.table : undefined,
    column: typeof value?.column === "string" ? value.column : undefined,
    constraint: typeof value?.constraint === "string" ? value.constraint : undefined,
  });
}

function flowerMutationError(error: unknown): InventoryActionState {
  if (error instanceof InventoryValidationError) return { error: error.message, message: "" };
  if (databaseCode(error) === "23505") return { error: "Цветок с таким slug уже существует", message: "" };
  if (databaseCode(error) === "23503") return { error: "Выбранная категория больше не существует", message: "" };
  logMutationFailure("Flower mutation", error);
  return { error: "Не удалось сохранить цветок. Попробуйте ещё раз", message: "" };
}

function categoryMutationError(error: unknown): InventoryActionState {
  if (error instanceof InventoryValidationError) return { error: error.message, message: "" };
  if (databaseCode(error) === "23505") return { error: "Категория с таким названием или slug уже существует", message: "" };
  if (databaseCode(error) === "23503") return { error: "Категория используется и не может быть удалена", message: "" };
  logMutationFailure("Category mutation", error);
  return { error: "Не удалось сохранить категорию. Попробуйте ещё раз", message: "" };
}

function revalidateCategories() {
  revalidatePath("/admin/inventory/categories");
  revalidatePath("/admin/inventory");
  revalidatePath("/bouquet-builder");
  revalidatePath("/", "layout");
}

export async function adjustInventory(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
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

    await audit(client, session.userId, "inventory.adjust", flowerId, { before: currentStock, after: updatedStock, reason });
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

export async function createFlower(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  const parsed = parseFlowerDetails(formData);
  if (!parsed.value) return { error: parsed.error, message: "" };
  const input = parsed.value;
  const isActive = formData.get("is_active") === "true";
  const client = await db.connect();
  let flowerId = "";
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(`
      INSERT INTO public.flowers (
        category_id, name, slug, description, color, unit, purchase_price, sale_price,
        stock_quantity, min_stock_quantity, image_url, is_active
      ) VALUES ($1::bigint, $2, $3, $4, $5, $6, 0::numeric, 0::numeric, 0, $7, $8, $9)
      RETURNING id::text
    `, [input.categoryId, input.name, input.slug, input.description, input.color, input.unit,
      input.minimumStock, input.imageUrl, isActive]);
    flowerId = result.rows[0].id;
    await audit(client, session.userId, "flower.create", flowerId, { active: isActive });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return flowerMutationError(error);
  } finally { client.release(); }
  revalidateInventory(flowerId);
  redirect(`/admin/inventory/${flowerId}?message=created`);
}

export async function updateFlowerDetails(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(flowerId)) return { error: "Цветок не найден", message: "" };
  const parsed = parseFlowerDetails(formData);
  if (!parsed.value) return { error: parsed.error, message: "" };
  const input = parsed.value;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT id FROM public.flowers WHERE id=$1::bigint FOR UPDATE", [flowerId]);
    if (!locked.rows.length) throw new InventoryValidationError("Цветок не найден");
    await client.query(`UPDATE public.flowers SET category_id=$2::bigint, name=$3, slug=$4,
      description=$5, color=$6, unit=$7, min_stock_quantity=$8, image_url=$9, updated_at=NOW()
      WHERE id=$1::bigint`, [flowerId, input.categoryId, input.name, input.slug, input.description,
      input.color, input.unit, input.minimumStock, input.imageUrl]);
    await audit(client, session.userId, "flower.update", flowerId, {
      fields: ["category_id", "name", "slug", "description", "color", "unit", "min_stock_quantity", "image_url"],
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return flowerMutationError(error);
  } finally { client.release(); }
  revalidateInventory(flowerId);
  redirect(`/admin/inventory/${flowerId}?message=updated`);
}

export async function setFlowerActivity(
  flowerId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(flowerId)) return { error: "Цветок не найден", message: "" };
  const activeValue = String(formData.get("is_active") ?? "");
  if (activeValue !== "true" && activeValue !== "false") return { error: "Некорректный статус цветка", message: "" };
  const active = activeValue === "true";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("UPDATE public.flowers SET is_active=$2,updated_at=NOW() WHERE id=$1::bigint RETURNING id", [flowerId, active]);
    if (!result.rows.length) throw new InventoryValidationError("Цветок не найден");
    await audit(client, session.userId, "flower.activity", flowerId, { active });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return flowerMutationError(error);
  } finally { client.release(); }
  revalidateInventory(flowerId);
  return { error: "", message: active ? "Цветок включён" : "Цветок отключён" };
}

export async function deleteFlower(
  flowerId: string,
  previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  void previousState;
  void formData;
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(flowerId)) return { error: "Цветок не найден", message: "" };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const flowerResult = await client.query<DeletableFlower>(`
      SELECT id::text, stock_quantity, constructor_kind
      FROM public.flowers
      WHERE id = $1::bigint
      FOR UPDATE
    `, [flowerId]);
    const flower = flowerResult.rows[0];
    if (!flower) throw new InventoryValidationError("Цветок не найден");
    if (Number(flower.stock_quantity) !== 0) {
      throw new InventoryValidationError(
        "Цветок с ненулевым остатком нельзя удалить. Отключите его, чтобы сохранить историю.",
      );
    }

    // JSON order snapshots have no foreign key. Block their concurrent creation
    // while the dependency check and flower deletion run in one transaction.
    await client.query("LOCK TABLE public.order_items IN SHARE ROW EXCLUSIVE MODE");
    const dependencies = await client.query<FlowerDependencies>(`
      SELECT (
        EXISTS (SELECT 1 FROM public.bouquet_items WHERE flower_id = $1::bigint)
        OR EXISTS (SELECT 1 FROM public.order_items WHERE flower_id = $1::bigint)
        OR EXISTS (SELECT 1 FROM public.purchase_items WHERE flower_id = $1::bigint)
        OR EXISTS (SELECT 1 FROM public.stock_movements WHERE flower_id = $1::bigint)
        OR EXISTS (SELECT 1 FROM public.order_stock_reservations WHERE flower_id = $1::bigint)
        OR EXISTS (
          SELECT 1
          FROM public.order_items
          WHERE COALESCE(custom_configuration, '{}'::jsonb)
                  @> jsonb_build_object('flowers', jsonb_build_array(jsonb_build_object('flowerId', $1::text)))
             OR COALESCE(custom_summary, '{}'::jsonb)
                  @> jsonb_build_object('flowers', jsonb_build_array(jsonb_build_object('flowerId', $1::text)))
             OR COALESCE(bouquet_composition_snapshot, '{}'::jsonb)
                  @> jsonb_build_object('flowers', jsonb_build_array(jsonb_build_object('flowerId', $1::text)))
             OR (
               $2::text IS NOT NULL
               AND COALESCE(custom_configuration, '{}'::jsonb)
                    @> jsonb_build_object(
                      'schemaVersion', 1,
                      'flowers', jsonb_build_array(jsonb_build_object('kind', $2::text))
                    )
             )
        )
      ) AS used
    `, [flowerId, flower.constructor_kind]);
    if (dependencies.rows[0]?.used) {
      throw new InventoryValidationError(
        "Цветок уже использовался в букетах, заказах или складских операциях. Отключите его, чтобы сохранить историю.",
      );
    }

    await audit(client, session.userId, "flower.delete", flowerId);
    await client.query("DELETE FROM public.flowers WHERE id = $1::bigint", [flowerId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof InventoryValidationError) return { error: error.message, message: "" };
    if (databaseCode(error) === "23503" || databaseCode(error) === "40001" || databaseCode(error) === "40P01") {
      return {
        error: "Цветок получил новую связь и не может быть удалён. Отключите его, чтобы сохранить историю.",
        message: "",
      };
    }
    logMutationFailure("Flower deletion", error);
    return { error: "Не удалось удалить цветок. Попробуйте ещё раз", message: "" };
  } finally {
    client.release();
  }

  // Model assets are immutable and intentionally retained: an old order snapshot
  // or a customer's local cart may still reference the GLB by assetId.
  revalidatePath("/admin/inventory");
  revalidatePath("/bouquet-builder");
  revalidatePath("/", "layout");
  redirect("/admin/inventory?message=flower-deleted");
}

export async function createCategory(_previousState: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  const parsed = parseCategory(formData);
  if (!parsed.value) return { error: parsed.error, message: "" };
  const active = formData.get("is_active") === "true";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string }>(`INSERT INTO public.categories(name,slug,sort_order,is_active)
      VALUES($1,$2,$3,$4) RETURNING id::text`, [parsed.value.name, parsed.value.slug, parsed.value.sortOrder, active]);
    await audit(client, session.userId, "category.create", result.rows[0].id, { active });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return categoryMutationError(error);
  } finally { client.release(); }
  revalidateCategories();
  return { error: "", message: "Категория создана" };
}

export async function updateCategory(categoryId: string, _previousState: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(categoryId)) return { error: "Категория не найдена", message: "" };
  const parsed = parseCategory(formData);
  if (!parsed.value) return { error: parsed.error, message: "" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE public.categories SET name=$2,slug=$3,sort_order=$4
      WHERE id=$1::bigint RETURNING id`, [categoryId, parsed.value.name, parsed.value.slug, parsed.value.sortOrder]);
    if (!result.rows.length) throw new InventoryValidationError("Категория не найдена");
    await audit(client, session.userId, "category.update", categoryId, { fields: ["name", "slug", "sort_order"] });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return categoryMutationError(error);
  } finally { client.release(); }
  revalidateCategories();
  return { error: "", message: "Категория сохранена" };
}

export async function setCategoryActivity(categoryId: string, _previousState: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(categoryId)) return { error: "Категория не найдена", message: "" };
  const activeValue = String(formData.get("is_active") ?? "");
  if (activeValue !== "true" && activeValue !== "false") return { error: "Некорректный статус категории", message: "" };
  const active = activeValue === "true";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("UPDATE public.categories SET is_active=$2 WHERE id=$1::bigint RETURNING id", [categoryId, active]);
    if (!result.rows.length) throw new InventoryValidationError("Категория не найдена");
    await audit(client, session.userId, "category.activity", categoryId, { active });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return categoryMutationError(error);
  } finally { client.release(); }
  revalidateCategories();
  return { error: "", message: active ? "Категория включена" : "Категория отключена" };
}

export async function deleteCategory(
  categoryId: string,
  previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  void previousState;
  void formData;
  const session = await requirePermission("inventory.manage");
  if (!isDatabaseId(categoryId)) return { error: "Категория не найдена", message: "" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const category = await client.query("SELECT id FROM public.categories WHERE id=$1::bigint FOR UPDATE", [categoryId]);
    if (!category.rows.length) throw new InventoryValidationError("Категория не найдена");
    const used = await client.query<{ used: boolean }>("SELECT EXISTS(SELECT 1 FROM public.flowers WHERE category_id=$1::bigint) AS used", [categoryId]);
    if (used.rows[0].used) throw new InventoryValidationError("Категория используется цветами и не может быть удалена");
    await client.query("DELETE FROM public.categories WHERE id=$1::bigint", [categoryId]);
    await audit(client, session.userId, "category.delete", categoryId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return categoryMutationError(error);
  } finally { client.release(); }
  revalidateCategories();
  return { error: "", message: "Категория удалена" };
}

export async function updateFlowerPrices(flowerId: string, _previous: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const session = await requirePermission("prices.manage");
  if (!isDatabaseId(flowerId)) return { error: "Цветок не найден", message: "" };
  const purchase = parsePrice(formData.get("purchase_price"));
  const sale = parsePrice(formData.get("sale_price"));
  if (purchase === null || sale === null) return { error: "Введите неотрицательные цены: до 10 цифр и не более двух знаков после запятой", message: "" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ purchase_price: string; sale_price: string }>(
      "SELECT purchase_price::text, sale_price::text FROM public.flowers WHERE id=$1::bigint FOR UPDATE", [flowerId]);
    if (!before.rows.length) { await client.query("ROLLBACK"); return { error: "Цветок не найден", message: "" }; }
    await client.query("UPDATE public.flowers SET purchase_price=$2::numeric, sale_price=$3::numeric, updated_at=NOW() WHERE id=$1::bigint", [flowerId, purchase, sale]);
    await audit(client, session.userId, "flower.prices", flowerId, { before: before.rows[0], after: { purchase_price: purchase, sale_price: sale } });
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return { error: "Не удалось сохранить цены", message: "" };
  } finally { client.release(); }
  revalidateInventory(flowerId);
  return { error: "", message: "Цены сохранены" };
}
