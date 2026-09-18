"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { audit } from "@/lib/admin-audit";
import { db } from "@/lib/db";
import { isDatabaseId, normalizeSlug } from "@/lib/flower-admin";
import { parsePrice } from "@/lib/money-input";

export type WrappingActionState = { error: string; message: string };
type WrappingValues = {
  slug: string;
  name: string;
  subtitle: string;
  color: string;
  ribbonColor: string;
  salePrice: string;
  opacity: string;
  sortOrder: number;
  isActive: boolean;
};

class WrappingValidationError extends Error {}
const controls = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function text(formData: FormData, key: string, maximum: number, required = true) {
  const value = String(formData.get(key) ?? "").trim().replace(/[ \t]+/g, " ");
  if ((required && !value) || value.length > maximum || controls.test(value)) {
    throw new WrappingValidationError("Проверьте название и текст упаковки");
  }
  return value;
}

function parseWrappingForm(formData: FormData): WrappingValues {
  const rawSlug = text(formData, "slug", 64);
  const slug = normalizeSlug(rawSlug, 64);
  if (!slug || slug !== rawSlug.toLowerCase() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new WrappingValidationError("Slug должен содержать латинские буквы, цифры и одиночные дефисы");
  }
  const name = text(formData, "name", 120);
  const subtitle = text(formData, "subtitle", 180, false);
  const color = String(formData.get("color") ?? "").trim().toLowerCase();
  const ribbonColor = String(formData.get("ribbon_color") ?? "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color) || !/^#[0-9a-f]{6}$/.test(ribbonColor)) {
    throw new WrappingValidationError("Цвета должны быть указаны в формате #RRGGBB");
  }
  const salePrice = parsePrice(formData.get("sale_price"));
  if (salePrice === null) throw new WrappingValidationError("Цена должна быть неотрицательной и содержать не более двух знаков после запятой");
  const opacityInput = String(formData.get("opacity") ?? "").trim().replace(",", ".");
  if (!/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(opacityInput)) {
    throw new WrappingValidationError("Прозрачность должна быть от 0 до 1 и содержать не более трёх знаков после запятой");
  }
  const opacity = Number(opacityInput).toFixed(3);
  const sortInput = String(formData.get("sort_order") ?? "").trim();
  if (!/^\d{1,7}$/.test(sortInput) || Number(sortInput) > 1_000_000) {
    throw new WrappingValidationError("Порядок должен быть целым числом от 0 до 1000000");
  }
  return { slug, name, subtitle, color, ribbonColor, salePrice, opacity,
    sortOrder: Number(sortInput), isActive: formData.get("is_active") === "true" };
}

function resultError(operation: string, error: unknown): WrappingActionState {
  if (error instanceof WrappingValidationError) return { error: error.message, message: "" };
  if ((error as { code?: string })?.code === "23505") return { error: "Упаковка с таким slug уже существует", message: "" };
  console.error(`${operation} failed`, error);
  return { error: "Не удалось сохранить упаковку", message: "" };
}

function refreshWrappings() {
  revalidatePath("/admin/wrappings");
  revalidatePath("/bouquet-builder");
}

export async function createWrapping(_state: WrappingActionState, formData: FormData): Promise<WrappingActionState> {
  const session = await requirePermission("products.manage");
  let values: WrappingValues;
  try { values = parseWrappingForm(formData); } catch (error) { return resultError("createWrapping", error); }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(`
      INSERT INTO public.constructor_wrappings
        (slug,name,subtitle,color,ribbon_color,sale_price,opacity,sort_order,is_active,has_been_active)
      VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$9)
      RETURNING id::text`, [values.slug, values.name, values.subtitle, values.color,
      values.ribbonColor, values.salePrice, values.opacity, values.sortOrder, values.isActive]);
    await audit(client, session.userId, "wrapping.create", created.rows[0].id, { after: values });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return resultError("createWrapping", error); }
  finally { client.release(); }
  refreshWrappings();
  return { error: "", message: "Упаковка создана" };
}

export async function updateWrapping(id: string, _state: WrappingActionState, formData: FormData): Promise<WrappingActionState> {
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(id)) return { error: "Упаковка не найдена", message: "" };
  let values: WrappingValues;
  try { values = parseWrappingForm(formData); } catch (error) { return resultError("updateWrapping", error); }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      slug: string; name: string; subtitle: string; color: string; ribbon_color: string;
      sale_price: string; opacity: string; sort_order: number; is_active: boolean;
    }>(`SELECT slug,name,subtitle,color,ribbon_color,sale_price::text,opacity::text,sort_order,is_active
        FROM public.constructor_wrappings WHERE id=$1::bigint FOR UPDATE`, [id]);
    if (!current.rows.length) throw new WrappingValidationError("Упаковка не найдена");
    if (current.rows[0].slug !== values.slug) throw new WrappingValidationError("Slug упаковки нельзя изменять");
    const before = current.rows[0];
    const after = { slug: values.slug, name: values.name, subtitle: values.subtitle, color: values.color,
      ribbon_color: values.ribbonColor, sale_price: values.salePrice, opacity: values.opacity,
      sort_order: values.sortOrder, is_active: values.isActive };
    const changed = before.slug !== after.slug || before.name !== after.name || before.subtitle !== after.subtitle ||
      before.color.toLowerCase() !== after.color || before.ribbon_color.toLowerCase() !== after.ribbon_color ||
      Number(before.sale_price) !== Number(after.sale_price) || Number(before.opacity) !== Number(after.opacity) ||
      Number(before.sort_order) !== after.sort_order || before.is_active !== after.is_active;
    if (changed) {
      await client.query(`UPDATE public.constructor_wrappings SET name=$2,subtitle=$3,color=$4,ribbon_color=$5,
        sale_price=$6::numeric,opacity=$7::numeric,sort_order=$8,is_active=$9,
        has_been_active=has_been_active OR $9,updated_at=NOW() WHERE id=$1::bigint`,
      [id, values.name, values.subtitle, values.color, values.ribbonColor, values.salePrice,
        values.opacity, values.sortOrder, values.isActive]);
      await audit(client, session.userId, "wrapping.update", id, { before, after });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return resultError("updateWrapping", error); }
  finally { client.release(); }
  refreshWrappings();
  return { error: "", message: "Упаковка сохранена" };
}

export async function setWrappingActivity(id: string, _state: WrappingActionState, formData: FormData): Promise<WrappingActionState> {
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(id)) return { error: "Упаковка не найдена", message: "" };
  const raw = String(formData.get("is_active") ?? "");
  if (raw !== "true" && raw !== "false") return { error: "Некорректный статус упаковки", message: "" };
  const active = raw === "true";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ is_active: boolean }>(
      "SELECT is_active FROM public.constructor_wrappings WHERE id=$1::bigint FOR UPDATE", [id]);
    if (!current.rows.length) throw new WrappingValidationError("Упаковка не найдена");
    if (current.rows[0].is_active !== active) {
      await client.query(`UPDATE public.constructor_wrappings SET is_active=$2,
        has_been_active=has_been_active OR $2,updated_at=NOW() WHERE id=$1::bigint`, [id, active]);
      await audit(client, session.userId, "wrapping.activity", id, { before: current.rows[0].is_active, after: active });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return resultError("setWrappingActivity", error); }
  finally { client.release(); }
  refreshWrappings();
  return { error: "", message: active ? "Упаковка включена" : "Упаковка отключена" };
}

export async function deleteWrapping(id: string, _state: WrappingActionState, _formData: FormData): Promise<WrappingActionState> {
  void _state;
  void _formData;
  const session = await requirePermission("products.manage");
  if (!isDatabaseId(id)) return { error: "Упаковка не найдена", message: "" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ slug: string; name: string; is_active: boolean; has_been_active: boolean }>(
      "SELECT slug,name,is_active,has_been_active FROM public.constructor_wrappings WHERE id=$1::bigint FOR UPDATE", [id]);
    if (!current.rows.length) { await client.query("COMMIT"); return { error: "Упаковка уже удалена", message: "" }; }
    const wrapping = current.rows[0];
    if (wrapping.is_active) throw new WrappingValidationError("Сначала отключите упаковку");
    await client.query("LOCK TABLE public.order_items IN SHARE ROW EXCLUSIVE MODE");
    const used = await client.query<{ used: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM public.order_items
      WHERE COALESCE(custom_configuration,'{}'::jsonb) @> jsonb_build_object('wrappingKind',$1::text)
    ) AS used`, [wrapping.slug]);
    if (wrapping.has_been_active || used.rows[0]?.used) {
      throw new WrappingValidationError("Эта упаковка могла сохраниться в корзинах или заказах. Оставьте её отключённой для сохранения истории.");
    }
    await client.query("DELETE FROM public.constructor_wrappings WHERE id=$1::bigint", [id]);
    await audit(client, session.userId, "wrapping.delete", id, { slug: wrapping.slug, name: wrapping.name });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); return resultError("deleteWrapping", error); }
  finally { client.release(); }
  refreshWrappings();
  return { error: "", message: "Упаковка удалена" };
}
