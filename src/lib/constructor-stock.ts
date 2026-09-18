import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { sanitizeFlowerModel } from "@/lib/flower-model";
import {
  flowerSnapshot, upgradeLegacyConfiguration, wrappingSnapshot,
  type CustomBouquetConfig, type FlowerKind, type LegacyFlowerLinks, type PublicFlower, type PublicWrapping,
} from "@/lib/bouquet";

export class BouquetAvailabilityError extends Error {}

/** Same active-reservation rule used by inventory and order confirmation. */
export async function loadConstructorStock(client?: PoolClient) {
  const queryable = client ?? db;
  const result = await queryable.query<{
    id: string; name: string; color: string | null; image_url: string | null;
    sale_price: string; available_quantity: number; constructor_kind: FlowerKind | null;
    model_3d: unknown;
  }>(`
    SELECT f.id::text, f.name, f.color, f.image_url, f.sale_price::text,
           GREATEST(f.stock_quantity - COALESCE(r.quantity, 0), 0)::int AS available_quantity,
           f.constructor_kind, to_jsonb(f)->'model_3d' AS model_3d
    FROM public.flowers f
    LEFT JOIN (
      SELECT flower_id, sum(quantity) AS quantity FROM public.order_stock_reservations
      WHERE status = 'active' GROUP BY flower_id
    ) r ON r.flower_id = f.id
    WHERE f.is_active = true
    ORDER BY f.name, f.id
  `);
  const wrappingResult = await queryable.query<{
    id: string; slug: string; name: string; subtitle: string; color: string;
    ribbon_color: string; sale_price: string; opacity: string; sort_order: number;
  }>(`
    SELECT id::text, slug, name, subtitle, color, ribbon_color,
           sale_price::text, opacity::text, sort_order
    FROM public.constructor_wrappings
    WHERE is_active = true
    ORDER BY sort_order, id
  `);
  const flowers: PublicFlower[] = result.rows.map((row) => ({
    id: row.id, name: row.name, color: row.color, imageUrl: row.image_url,
    salePrice: Number(row.sale_price), availableQuantity: Number(row.available_quantity),
    model: sanitizeFlowerModel(row.model_3d),
  }));
  const legacyLinks: LegacyFlowerLinks = {};
  for (const kind of ["rose", "peony", "tulip"] as const) {
    const matches = result.rows.filter((flower) => flower.constructor_kind === kind);
    if (matches.length === 1) legacyLinks[kind] = matches[0].id;
  }
  const wrappings: PublicWrapping[] = wrappingResult.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle,
    color: row.color,
    ribbonColor: row.ribbon_color,
    salePrice: Number(row.sale_price),
    opacity: Number(row.opacity),
    sortOrder: Number(row.sort_order),
  }));
  return { flowers, legacyLinks, wrappings };
}

/** Discard all client metadata; snapshot current database values, preserving geometry. */
export function verifyCustomBouquet(
  config: CustomBouquetConfig, flowers: PublicFlower[], legacyLinks: LegacyFlowerLinks,
  wrappings: PublicWrapping[],
): CustomBouquetConfig {
  const upgraded = upgradeLegacyConfiguration(config, legacyLinks);
  if (!upgraded) throw new BouquetAvailabilityError("Для старого букета нужно выбрать складскую позицию в конструкторе");
  const wrapping = wrappings.find((item) => item.slug === upgraded.wrappingKind);
  if (!wrapping) throw new BouquetAvailabilityError("Выбранная упаковка больше недоступна. Обновите букет в конструкторе");
  const byId = new Map(flowers.map((flower) => [flower.id, flower]));
  return { schemaVersion: 2, wrappingKind: wrapping.slug, wrappingSnapshot: wrappingSnapshot(wrapping), flowers: upgraded.flowers.map((flower) => {
    const stock = byId.get(flower.flowerId!);
    if (!stock || !Number.isFinite(stock.salePrice) || stock.salePrice < 0) {
      throw new BouquetAvailabilityError("Цветок в авторском букете недоступен. Обновите композицию в конструкторе");
    }
    return { id: flower.id, flowerId: stock.id, position: flower.position, rotation: flower.rotation, snapshot: flowerSnapshot(stock) };
  }) };
}

export function checkCartFlowerAvailability(requirements: Map<string, number>, flowers: PublicFlower[]) {
  const byId = new Map(flowers.map((flower) => [flower.id, flower]));
  for (const [id, quantity] of requirements) {
    const flower = byId.get(id);
    if (!flower || quantity > flower.availableQuantity) {
      throw new BouquetAvailabilityError(`Недостаточно цветов для заказа: ${flower?.name ?? `цветок №${id}`}. Уменьшите количество или измените состав`);
    }
  }
}
