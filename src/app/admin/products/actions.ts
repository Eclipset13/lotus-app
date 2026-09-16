"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export type ProductActionState = { error: string };

type BouquetCompositionItem = { flowerId: string; quantity: number };

class ProductValidationError extends Error {}

const MAX_BIGINT = "9223372036854775807";
const MAX_COMPOSITION_ITEMS = 100;

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

function readText(formData: FormData, key: string, maxLength: number) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) {
    throw new ProductValidationError("Сократите слишком длинные значения");
  }
  return value;
}

function parseComposition(formData: FormData): BouquetCompositionItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("composition") ?? "[]"));
  } catch {
    throw new ProductValidationError("Проверьте состав букета");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_COMPOSITION_ITEMS) {
    throw new ProductValidationError("Проверьте состав букета");
  }

  const result: BouquetCompositionItem[] = [];
  const flowerIds = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      throw new ProductValidationError("Проверьте состав букета");
    }
    const flowerId = String((item as { flowerId?: unknown }).flowerId ?? "");
    const quantity = Number((item as { quantity?: unknown }).quantity);
    if (
      !isDatabaseId(flowerId) ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > 10_000
    ) {
      throw new ProductValidationError(
        "Для каждого цветка укажите целое положительное количество",
      );
    }
    if (flowerIds.has(flowerId)) {
      throw new ProductValidationError(
        "Один цветок нельзя добавлять в состав дважды",
      );
    }
    flowerIds.add(flowerId);
    result.push({ flowerId, quantity });
  }
  return result;
}

function parseBouquetForm(formData: FormData) {
  const name = readText(formData, "name", 255);
  const description = readText(formData, "description", 5_000);
  const imageUrl = readText(formData, "image_url", 2_000);
  const price = Number(
    String(formData.get("price") ?? "").trim().replace(",", "."),
  );
  const isActive = formData.get("is_active") === "on";
  const composition = parseComposition(formData);

  if (!name) throw new ProductValidationError("Введите название букета");
  if (!Number.isFinite(price) || price < 0 || price > 999_999_999) {
    throw new ProductValidationError("Укажите правильную цену");
  }
  if (isActive && composition.length === 0) {
    throw new ProductValidationError(
      "Для активного букета добавьте хотя бы один цветок",
    );
  }

  return {
    name,
    description: description || null,
    imageUrl: imageUrl || null,
    price,
    isActive,
    composition,
  };
}

async function verifyFlowers(
  client: PoolClient,
  composition: BouquetCompositionItem[],
) {
  if (composition.length === 0) return;
  const flowerIds = composition.map((item) => item.flowerId);
  const result = await client.query<{ id: string }>(
    `SELECT id::text FROM public.flowers WHERE id = ANY($1::bigint[])`,
    [flowerIds],
  );
  if (result.rows.length !== flowerIds.length) {
    throw new ProductValidationError(
      "Один из выбранных цветов больше не существует",
    );
  }
}

async function replaceComposition(
  client: PoolClient,
  bouquetId: string,
  composition: BouquetCompositionItem[],
) {
  await client.query(
    "DELETE FROM public.bouquet_items WHERE bouquet_id = $1::bigint",
    [bouquetId],
  );
  if (composition.length === 0) return;
  await client.query(
    `
      INSERT INTO public.bouquet_items (bouquet_id, flower_id, quantity)
      SELECT $1::bigint, item.flower_id, item.quantity
      FROM unnest($2::bigint[], $3::integer[]) AS item(flower_id, quantity)
    `,
    [
      bouquetId,
      composition.map((item) => item.flowerId),
      composition.map((item) => item.quantity),
    ],
  );
}

function safeProductError(prefix: string, error: unknown): ProductActionState {
  if (error instanceof ProductValidationError) return { error: error.message };
  console.error(`${prefix}:`, error);
  return { error: "Не удалось сохранить букет" };
}

export async function createProduct(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requirePermission("products.manage");

  let values: ReturnType<typeof parseBouquetForm>;
  try {
    values = parseBouquetForm(formData);
  } catch (error) {
    return safeProductError("createProduct failed", error);
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await verifyFlowers(client, values.composition);
    const slug = `lotus-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const bouquetResult = await client.query<{ id: string }>(
      `
        INSERT INTO public.bouquets (
          name, slug, description, sale_price, image_url, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id::text
      `,
      [
        values.name,
        slug,
        values.description,
        values.price,
        values.imageUrl,
        values.isActive,
      ],
    );
    await replaceComposition(
      client,
      bouquetResult.rows[0].id,
      values.composition,
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("createProduct rollback failed:", rollbackError);
      });
    }
    return safeProductError("createProduct failed", error);
  } finally {
    client?.release();
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/catalog");
  redirect("/admin/products");
}

export async function updateProduct(
  productId: string,
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requirePermission("products.manage");
  if (!isDatabaseId(productId)) return { error: "Букет не найден" };

  let values: ReturnType<typeof parseBouquetForm>;
  try {
    values = parseBouquetForm(formData);
  } catch (error) {
    return safeProductError("updateProduct failed", error);
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const bouquetResult = await client.query(
      "SELECT id FROM public.bouquets WHERE id = $1::bigint FOR UPDATE",
      [productId],
    );
    if (bouquetResult.rowCount !== 1) {
      throw new ProductValidationError("Букет не найден");
    }
    await verifyFlowers(client, values.composition);
    await client.query(
      `
        UPDATE public.bouquets
        SET name = $1, description = $2, sale_price = $3,
            image_url = $4, is_active = $5, updated_at = NOW()
        WHERE id = $6::bigint
      `,
      [
        values.name,
        values.description,
        values.price,
        values.imageUrl,
        values.isActive,
        productId,
      ],
    );
    await replaceComposition(client, productId, values.composition);
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("updateProduct rollback failed:", rollbackError);
      });
    }
    return safeProductError("updateProduct failed", error);
  } finally {
    client?.release();
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/catalog");
  redirect("/admin/products");
}

export async function toggleProductVisibility(productId: string) {
  await requirePermission("products.manage");
  if (!isDatabaseId(productId)) return;

  try {
    await db.query(
      `
        UPDATE public.bouquets AS b
        SET is_active = CASE
              WHEN b.is_active THEN FALSE
              ELSE EXISTS (
                SELECT 1 FROM public.bouquet_items bi
                WHERE bi.bouquet_id = b.id
              )
            END,
            updated_at = NOW()
        WHERE b.id = $1::bigint
      `,
      [productId],
    );
  } catch (error) {
    console.error("toggleProductVisibility failed:", error);
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/catalog");
}
