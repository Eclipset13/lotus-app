"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { requirePermission } from "@/lib/admin-auth";
import { audit } from "@/lib/admin-audit";
import { db } from "@/lib/db";
import { ProductImageInputError } from "@/lib/product-image";
import { prepareProductImage, stageProductImage } from "@/lib/product-image-form";
import { discardProductImageFile } from "@/lib/product-image-storage";

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

function parseBouquetForm(formData: FormData, imageUrl: string | null = null) {
  const name = readText(formData, "name", 255);
  const description = readText(formData, "description", 5_000);
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
    imageUrl,
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
  if (error instanceof ProductValidationError || error instanceof ProductImageInputError) return { error: error.message };
  if ((error as { code?: string })?.code === "23503") return { error: "Букет используется в заказе и должен остаться скрытым для сохранения истории" };
  console.error(`${prefix}:`, error);
  return { error: "Не удалось сохранить букет" };
}

export async function createProduct(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const session = await requirePermission("products.manage");

  let values: ReturnType<typeof parseBouquetForm>;
  let stagedAsset: string | null = null;
  let imageSource: "upload" | "external" | "removed" | "unchanged" = "unchanged";
  let commitStarted = false;
  try {
    const prepared = await prepareProductImage(formData, null);
    values = parseBouquetForm(formData, prepared.imageUrl);
    const staged = await stageProductImage(prepared);
    stagedAsset = staged.assetId;
    imageSource = staged.source;
    values.imageUrl = staged.imageUrl;
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
    await audit(client, session.userId, "bouquet.create", bouquetResult.rows[0].id, {
      after: {
        name: values.name,
        sale_price: values.price,
        is_active: values.isActive,
        composition: values.composition.map((item) => ({ flower_id: item.flowerId, quantity: item.quantity })),
      },
      image_source: imageSource,
    });
    commitStarted = true;
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("createProduct rollback failed:", rollbackError);
      });
    }
    if (stagedAsset && !commitStarted) await discardProductImageFile(stagedAsset).catch((cleanupError) => console.error("Product image cleanup failed", cleanupError));
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
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(productId)) return { error: "Букет не найден" };

  let values: ReturnType<typeof parseBouquetForm>;
  let stagedAsset: string | null = null;
  let commitStarted = false;
  try {
    values = parseBouquetForm(formData);
  } catch (error) {
    return safeProductError("updateProduct failed", error);
  }

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const bouquetResult = await client.query<{
      name: string;
      description: string | null;
      sale_price: string;
      image_url: string | null;
      is_active: boolean;
      composition: Array<{ flower_id: string; quantity: number }>;
    }>(
      `SELECT bouquet.name, bouquet.description, bouquet.sale_price::text,
              bouquet.image_url, bouquet.is_active,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'flower_id', item.flower_id::text, 'quantity', item.quantity
              ) ORDER BY item.flower_id) FROM public.bouquet_items AS item
                WHERE item.bouquet_id=bouquet.id), '[]'::jsonb) AS composition
       FROM public.bouquets AS bouquet WHERE bouquet.id = $1::bigint FOR UPDATE`,
      [productId],
    );
    if (bouquetResult.rowCount !== 1) {
      throw new ProductValidationError("Букет не найден");
    }
    const before = bouquetResult.rows[0];
    const preparedImage = await prepareProductImage(formData, before.image_url);
    const stagedImage = await stageProductImage(preparedImage);
    stagedAsset = stagedImage.assetId;
    values.imageUrl = stagedImage.imageUrl;
    const nextComposition = values.composition
      .map((item) => ({ flower_id: item.flowerId, quantity: item.quantity }))
      .sort((first, second) => BigInt(first.flower_id) < BigInt(second.flower_id) ? -1 : 1);
    const beforeComposition = [...before.composition]
      .sort((first, second) => BigInt(first.flower_id) < BigInt(second.flower_id) ? -1 : 1);
    const compositionChanged = beforeComposition.length !== nextComposition.length ||
      beforeComposition.some((item, index) => item.flower_id !== nextComposition[index].flower_id ||
        Number(item.quantity) !== nextComposition[index].quantity);
    const changed = before.name !== values.name || before.description !== values.description ||
      before.image_url !== values.imageUrl || before.is_active !== values.isActive ||
      Number(before.sale_price) !== values.price ||
      compositionChanged;
    if (changed) await verifyFlowers(client, values.composition);
    if (changed) await client.query(
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
    if (changed) await replaceComposition(client, productId, values.composition);
    if (changed) await audit(client, session.userId, "bouquet.update", productId, {
      before: {
        name: before.name,
        sale_price: before.sale_price,
        is_active: before.is_active,
        composition: before.composition,
      },
      after: {
        name: values.name,
        sale_price: values.price,
        is_active: values.isActive,
        composition: nextComposition,
      },
      image_changed: before.image_url !== values.imageUrl,
      image_source: before.image_url !== values.imageUrl ? preparedImage.source : "unchanged",
    });
    commitStarted = true;
    await client.query("COMMIT");
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("updateProduct rollback failed:", rollbackError);
      });
    }
    if (stagedAsset && !commitStarted) await discardProductImageFile(stagedAsset).catch((cleanupError) => console.error("Product image cleanup failed", cleanupError));
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
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(productId)) return;

  let client: PoolClient | null = null;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    const current = await client.query<{ is_active: boolean; next_active: boolean }>(`
      SELECT bouquet.is_active,
             CASE WHEN bouquet.is_active THEN FALSE ELSE EXISTS (
               SELECT 1 FROM public.bouquet_items AS item WHERE item.bouquet_id=bouquet.id
             ) END AS next_active
      FROM public.bouquets AS bouquet
      WHERE bouquet.id=$1::bigint
      FOR UPDATE`, [productId]);
    const state = current.rows[0];
    if (state && state.is_active !== state.next_active) {
      await client.query("UPDATE public.bouquets SET is_active=$2,updated_at=NOW() WHERE id=$1::bigint", [productId, state.next_active]);
      await audit(client, session.userId, "bouquet.activity", productId, { before: state.is_active, after: state.next_active });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    console.error("toggleProductVisibility failed:", error);
  } finally {
    client?.release();
  }

  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/catalog");
}

export async function deleteProduct(
  productId: string,
  _previousState: ProductActionState,
  _formData: FormData,
): Promise<ProductActionState> {
  void _previousState;
  void _formData;
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(productId)) return { error: "Букет не найден" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ name: string; is_active: boolean }>(
      "SELECT name,is_active FROM public.bouquets WHERE id=$1::bigint FOR UPDATE", [productId]);
    if (!locked.rows.length) {
      await client.query("COMMIT");
      return { error: "Букет уже удалён" };
    }
    if (locked.rows[0].is_active) throw new ProductValidationError("Сначала скройте букет из каталога");
    // Prevent an order item from being inserted between the dependency check and delete.
    await client.query("LOCK TABLE public.order_items IN SHARE ROW EXCLUSIVE MODE");
    const used = await client.query<{ used: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM public.order_items WHERE bouquet_id=$1::bigint) AS used", [productId]);
    if (used.rows[0]?.used) {
      throw new ProductValidationError("Букет уже использован в заказе. Оставьте его скрытым для сохранения истории.");
    }
    await client.query("DELETE FROM public.bouquet_items WHERE bouquet_id=$1::bigint", [productId]);
    const removed = await client.query("DELETE FROM public.bouquets WHERE id=$1::bigint", [productId]);
    if (removed.rowCount !== 1) throw new Error("Concurrent bouquet deletion");
    await audit(client, session.userId, "bouquet.delete", productId, { name: locked.rows[0].name });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if ((error as { code?: string })?.code === "23503" || (error as { code?: string })?.code === "40001") {
      return { error: "Букет получил связь с заказом. Оставьте его скрытым для сохранения истории." };
    }
    return safeProductError("deleteProduct failed", error);
  } finally { client.release(); }
  revalidatePath("/admin/products");
  revalidatePath("/");
  revalidatePath("/catalog");
  redirect("/admin/products");
}
