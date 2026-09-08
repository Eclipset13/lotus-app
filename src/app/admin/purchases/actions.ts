"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export type PurchaseActionState = {
  error: string;
  message: string;
};

type PurchaseItemInput = {
  flowerId: string;
  quantity: number;
  unitCost: number;
};

type PurchaseInput = {
  supplierId: string;
  documentNumber: string;
  receivedAt: string;
  note: string;
  items: PurchaseItemInput[];
};

type PurchaseRow = {
  id: string;
  supplier_id: string;
  document_number: string | null;
  status: "draft" | "posted" | "cancelled";
};

type StoredPurchaseItem = {
  flower_id: string;
  quantity: number;
  unit_cost: string;
};

type LockedFlower = {
  id: string;
  name: string;
  stock_quantity: number;
  purchase_price: string;
  is_active: boolean;
};

class PurchaseValidationError extends Error {}

const MAX_BIGINT = "9223372036854775807";
const MAX_NOTE_LENGTH = 4_000;
const MAX_ITEMS = 500;

function isDatabaseId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value)) {
    return false;
  }

  return value.length < MAX_BIGINT.length || value <= MAX_BIGINT;
}

function readText(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parsePurchaseInput(formData: FormData): PurchaseInput {
  const supplierId = readText(formData, "supplier_id");
  const documentNumber = readText(formData, "document_number");
  const receivedAt = readText(formData, "received_at");
  const note = readText(formData, "note");
  const rawItems = readText(formData, "items");

  if (!isDatabaseId(supplierId)) {
    throw new PurchaseValidationError("Выберите активного поставщика");
  }
  if (documentNumber.length > 64) {
    throw new PurchaseValidationError("Номер документа не должен превышать 64 символа");
  }
  if (receivedAt && !isValidDate(receivedAt)) {
    throw new PurchaseValidationError("Проверьте дату поступления");
  }
  if (note.length > MAX_NOTE_LENGTH) {
    throw new PurchaseValidationError("Сократите примечание");
  }
  if (!rawItems || rawItems.length > 100_000) {
    throw new PurchaseValidationError("Добавьте хотя бы один цветок");
  }

  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(rawItems);
  } catch {
    throw new PurchaseValidationError("Проверьте позиции поступления");
  }

  if (!Array.isArray(parsedItems) || parsedItems.length < 1) {
    throw new PurchaseValidationError("Добавьте хотя бы один цветок");
  }
  if (parsedItems.length > MAX_ITEMS) {
    throw new PurchaseValidationError("Слишком много позиций в одном документе");
  }

  const seenFlowerIds = new Set<string>();
  const items = parsedItems.map((item): PurchaseItemInput => {
    if (!item || typeof item !== "object") {
      throw new PurchaseValidationError("Проверьте позиции поступления");
    }

    const source = item as Record<string, unknown>;
    const flowerId = String(source.flowerId ?? "").trim();
    const quantity = Number(source.quantity);
    const unitCost = Number(source.unitCost);

    if (!isDatabaseId(flowerId)) {
      throw new PurchaseValidationError("Выберите цветок для каждой позиции");
    }
    if (seenFlowerIds.has(flowerId)) {
      throw new PurchaseValidationError("Один цветок нельзя добавить дважды");
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 2_147_483_647) {
      throw new PurchaseValidationError("Количество должно быть целым положительным числом");
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0 || unitCost > 9_999_999_999.99) {
      throw new PurchaseValidationError("Закупочная цена должна быть положительной");
    }

    seenFlowerIds.add(flowerId);
    return {
      flowerId,
      quantity,
      unitCost: Math.round(unitCost * 100) / 100,
    };
  });

  return { supplierId, documentNumber, receivedAt, note, items };
}

async function validateActiveReferences(client: PoolClient, input: PurchaseInput) {
  const supplier = await client.query(
    `SELECT id FROM public.suppliers WHERE id = $1::bigint AND is_active = TRUE`,
    [input.supplierId],
  );
  if (supplier.rowCount !== 1) {
    throw new PurchaseValidationError("Поставщик не найден или отключён");
  }

  const flowerIds = input.items.map((item) => item.flowerId);
  const flowers = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM public.flowers
      WHERE id = ANY($1::bigint[])
        AND is_active = TRUE
    `,
    [flowerIds],
  );
  if (flowers.rowCount !== flowerIds.length) {
    throw new PurchaseValidationError("Один из цветов не найден или отключён");
  }
}

async function insertItems(
  client: PoolClient,
  purchaseId: string,
  items: PurchaseItemInput[],
) {
  for (const item of items) {
    await client.query(
      `
        INSERT INTO public.purchase_items (purchase_id, flower_id, quantity, unit_cost)
        VALUES ($1::bigint, $2::bigint, $3, $4)
      `,
      [purchaseId, item.flowerId, item.quantity, item.unitCost],
    );
  }
}

function safeActionError(prefix: string, error: unknown): PurchaseActionState {
  if (error instanceof PurchaseValidationError) {
    return { error: error.message, message: "" };
  }

  console.error(`${prefix}:`, error);
  return { error: "Не удалось сохранить поступление", message: "" };
}

function revalidatePurchases(purchaseId?: string) {
  revalidatePath("/admin/purchases");
  if (purchaseId) {
    revalidatePath(`/admin/purchases/${purchaseId}`);
  }
}

export async function createPurchase(
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  let input: PurchaseInput;
  try {
    input = parsePurchaseInput(formData);
  } catch (error) {
    return safeActionError("createPurchase validation failed", error);
  }

  let client: PoolClient | null = null;
  let purchaseId = "";
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await validateActiveReferences(client, input);
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO public.purchases (
          supplier_id, document_number, received_at, note, status, updated_at
        )
        VALUES ($1::bigint, $2, $3::date, $4, 'draft', NOW())
        RETURNING id::text
      `,
      [
        input.supplierId,
        input.documentNumber || null,
        input.receivedAt || null,
        input.note || null,
      ],
    );
    purchaseId = result.rows[0].id;
    await insertItems(client, purchaseId, input.items);
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("createPurchase rollback failed:", rollbackError);
      });
    }
    return safeActionError("createPurchase failed", error);
  } finally {
    client?.release();
  }

  revalidatePurchases(purchaseId);
  redirect(`/admin/purchases/${purchaseId}`);
}

export async function updatePurchase(
  purchaseId: string,
  _previousState: PurchaseActionState,
  formData: FormData,
): Promise<PurchaseActionState> {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
  if (!isDatabaseId(purchaseId)) {
    return { error: "Поступление не найдено", message: "" };
  }

  let input: PurchaseInput;
  try {
    input = parsePurchaseInput(formData);
  } catch (error) {
    return safeActionError("updatePurchase validation failed", error);
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const locked = await client.query<PurchaseRow>(
      `SELECT id::text, supplier_id::text, document_number, status
       FROM public.purchases
       WHERE id = $1::bigint
       FOR UPDATE`,
      [purchaseId],
    );
    const purchase = locked.rows[0];
    if (!purchase) {
      throw new PurchaseValidationError("Поступление не найдено");
    }
    if (purchase.status !== "draft") {
      throw new PurchaseValidationError("Можно редактировать только черновик");
    }

    await validateActiveReferences(client, input);
    await client.query(
      `
        UPDATE public.purchases
        SET supplier_id = $1::bigint,
            document_number = $2,
            received_at = $3::date,
            note = $4,
            updated_at = NOW()
        WHERE id = $5::bigint
      `,
      [
        input.supplierId,
        input.documentNumber || null,
        input.receivedAt || null,
        input.note || null,
        purchaseId,
      ],
    );
    await client.query(
      `DELETE FROM public.purchase_items WHERE purchase_id = $1::bigint`,
      [purchaseId],
    );
    await insertItems(client, purchaseId, input.items);
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("updatePurchase rollback failed:", rollbackError);
      });
    }
    return safeActionError("updatePurchase failed", error);
  } finally {
    client?.release();
  }

  revalidatePurchases(purchaseId);
  return { error: "", message: "Черновик сохранён" };
}

export async function postPurchase(
  purchaseId: string,
  _previousState: PurchaseActionState,
  _formData: FormData,
): Promise<PurchaseActionState> {
  void _previousState;
  void _formData;

  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
  if (!isDatabaseId(purchaseId)) {
    return { error: "Поступление не найдено", message: "" };
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const purchaseResult = await client.query<PurchaseRow>(
      `
        SELECT id::text, supplier_id::text, document_number, status
        FROM public.purchases
        WHERE id = $1::bigint
        FOR UPDATE
      `,
      [purchaseId],
    );
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      throw new PurchaseValidationError("Поступление не найдено");
    }
    if (purchase.status !== "draft") {
      throw new PurchaseValidationError("Поступление уже проведено или отменено");
    }

    const supplierResult = await client.query(
      `SELECT id FROM public.suppliers WHERE id = $1::bigint AND is_active = TRUE`,
      [purchase.supplier_id],
    );
    if (supplierResult.rowCount !== 1) {
      throw new PurchaseValidationError("Поставщик не найден или отключён");
    }

    const itemsResult = await client.query<StoredPurchaseItem>(
      `
        SELECT flower_id::text, quantity, unit_cost::text
        FROM public.purchase_items
        WHERE purchase_id = $1::bigint
        ORDER BY flower_id
      `,
      [purchaseId],
    );
    if (itemsResult.rowCount === 0) {
      throw new PurchaseValidationError("Добавьте хотя бы один цветок");
    }

    const flowerIds = itemsResult.rows.map((item) => item.flower_id);
    if (new Set(flowerIds).size !== flowerIds.length) {
      throw new PurchaseValidationError("Один цветок нельзя добавить дважды");
    }

    const flowersResult = await client.query<LockedFlower>(
      `
        SELECT id::text,
               name,
               stock_quantity,
               purchase_price::text,
               is_active
        FROM public.flowers
        WHERE id = ANY($1::bigint[])
        ORDER BY id
        FOR UPDATE
      `,
      [flowerIds],
    );
    if (flowersResult.rowCount !== flowerIds.length) {
      throw new PurchaseValidationError("Один из цветов не найден");
    }

    const flowersById = new Map(
      flowersResult.rows.map((flower) => [flower.id, flower]),
    );

    for (const item of itemsResult.rows) {
      const flower = flowersById.get(item.flower_id);
      if (!flower || !flower.is_active) {
        throw new PurchaseValidationError("Один из цветов отключён");
      }

      const oldStock = Number(flower.stock_quantity);
      const oldCost = Number(flower.purchase_price);
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unit_cost);
      if (
        !Number.isInteger(oldStock) ||
        oldStock < 0 ||
        !Number.isFinite(oldCost) ||
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitCost) ||
        unitCost <= 0
      ) {
        throw new PurchaseValidationError("Проверьте складские данные цветов");
      }

      const newStock = oldStock + quantity;
      if (newStock > 2_147_483_647) {
        throw new PurchaseValidationError("Остаток цветка превышает допустимое значение");
      }
      const weightedCost =
        oldStock === 0
          ? unitCost
          : (oldStock * oldCost + quantity * unitCost) / newStock;
      const newPurchasePrice = Math.round(weightedCost * 100) / 100;

      await client.query(
        `
          UPDATE public.flowers
          SET purchase_price = $1,
              updated_at = NOW()
          WHERE id = $2::bigint
        `,
        [newPurchasePrice, item.flower_id],
      );
      await client.query(
        `
          INSERT INTO public.stock_movements (
            flower_id,
            supplier_id,
            purchase_id,
            movement_type,
            quantity_change,
            unit_cost,
            note
          )
          VALUES ($1::bigint, $2::bigint, $3::bigint, 'purchase', $4, $5, $6)
        `,
        [
          item.flower_id,
          purchase.supplier_id,
          purchaseId,
          quantity,
          unitCost,
          `Поступление ${purchase.document_number || `№${purchaseId}`}`,
        ],
      );
    }

    await client.query(
      `
        UPDATE public.purchases
        SET status = 'posted',
            confirmed_at = NOW(),
            received_at = COALESCE(received_at, NOW()),
            updated_at = NOW()
        WHERE id = $1::bigint
      `,
      [purchaseId],
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("postPurchase rollback failed:", rollbackError);
      });
    }
    const state = safeActionError("postPurchase failed", error);
    return state.error === "Не удалось сохранить поступление"
      ? { error: "Не удалось провести поступление", message: "" }
      : state;
  } finally {
    client?.release();
  }

  revalidatePurchases(purchaseId);
  return { error: "", message: "Поступление проведено" };
}

export async function cancelPurchase(
  purchaseId: string,
  _previousState: PurchaseActionState,
  _formData: FormData,
): Promise<PurchaseActionState> {
  void _previousState;
  void _formData;

  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
  if (!isDatabaseId(purchaseId)) {
    return { error: "Поступление не найдено", message: "" };
  }

  try {
    const result = await db.query(
      `
        UPDATE public.purchases
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE id = $1::bigint
          AND status = 'draft'
        RETURNING id
      `,
      [purchaseId],
    );
    if (result.rowCount !== 1) {
      return {
        error: "Можно отменить только существующий черновик",
        message: "",
      };
    }
  } catch (error) {
    console.error("cancelPurchase failed:", error);
    return { error: "Не удалось отменить поступление", message: "" };
  }

  revalidatePurchases(purchaseId);
  redirect("/admin/purchases");
}
