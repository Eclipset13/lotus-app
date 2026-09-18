import { sanitizeFlowerModel, type FlowerModel } from "@/lib/flower-model";

export type FlowerKind = "rose" | "peony" | "tulip";
export type WrappingKind = string;
export type BouquetVector3 = [number, number, number];

export type PublicWrapping = {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  color: string;
  ribbonColor: string;
  salePrice: number;
  opacity: number;
  sortOrder: number;
};

export type WrappingSnapshot = Omit<PublicWrapping, "id" | "sortOrder">;

export type CustomBouquetFlower = {
  id: string;
  /** Legacy v1 identity only. New flowers have no procedural model yet. */
  kind?: FlowerKind;
  flowerId?: string;
  snapshot?: FlowerSnapshot;
  position: BouquetVector3;
  rotation: BouquetVector3;
};

export type CustomBouquetConfig = {
  schemaVersion: 1 | 2;
  flowers: CustomBouquetFlower[];
  wrappingKind: WrappingKind;
  wrappingSnapshot?: WrappingSnapshot;
};

export type CustomBouquetSummary = {
  totalFlowers: number;
  roseCount?: number;
  peonyCount?: number;
  tulipCount?: number;
  flowers?: Array<{ flowerId: string; name: string; quantity: number; unitPrice: number }>;
  wrappingName: string;
};

export type FlowerSnapshot = { name: string; salePrice: number; color: string | null; imageUrl: string | null; model?: FlowerModel | null };
export type PublicFlower = { id: string; name: string; color: string | null; imageUrl: string | null; salePrice: number; availableQuantity: number; model?: FlowerModel | null };
export type LegacyFlowerLinks = Partial<Record<FlowerKind, string>>;

export function isFlowerId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 19 && /^[1-9][0-9]*$/.test(value) &&
    (value.length < 19 || value <= "9223372036854775807");
}

export function flowerSnapshot(flower: PublicFlower): FlowerSnapshot {
  return { name: flower.name, salePrice: flower.salePrice, color: flower.color, imageUrl: flower.imageUrl, model: sanitizeFlowerModel(flower.model) };
}

/** Only explicit, unambiguous legacy links may translate v1 stock identity. */
export function upgradeLegacyConfiguration(config: CustomBouquetConfig, links: LegacyFlowerLinks): CustomBouquetConfig | null {
  if (config.schemaVersion === 2) return config;
  const flowers: CustomBouquetFlower[] = [];
  for (const flower of config.flowers) {
    const flowerId = flower.kind && links[flower.kind];
    if (!flowerId) return null;
    flowers.push({ id: flower.id, flowerId, position: [...flower.position], rotation: [...flower.rotation] });
  }
  return { ...config, schemaVersion: 2, flowers };
}

export const MAX_CUSTOM_BOUQUET_FLOWERS = 21;
const MAX_ABSOLUTE_FLOWER_ROTATION = Math.PI * 20;

export const CUSTOM_BOUQUET_FLOWERS = [
  {
    kind: "rose" as const,
    name: "Роза",
    subtitle: "Пудровая",
    color: "#d98291",
    price: 18,
  },
  {
    kind: "peony" as const,
    name: "Пион",
    subtitle: "Нежно-розовый",
    color: "#efb7c2",
    price: 24,
  },
  {
    kind: "tulip" as const,
    name: "Тюльпан",
    subtitle: "Кремовый",
    color: "#f5d7c9",
    price: 15,
  },
] as const;

// Historical v1/v2 carts and orders did not contain a wrapping snapshot.
// These values are only a compatibility fallback when reading those records.
export const LEGACY_CUSTOM_BOUQUET_WRAPPINGS = [
  {
    kind: "blush" as const,
    name: "Пудровая",
    subtitle: "Нежно-розовая",
    color: "#f4cfc8",
    ribbonColor: "#b85d70",
    price: 25,
    opacity: 0.5,
  },
  {
    kind: "kraft" as const,
    name: "Крафтовая",
    subtitle: "Тёплая натуральная",
    color: "#c99b72",
    ribbonColor: "#744b3d",
    price: 20,
    opacity: 0.72,
  },
  {
    kind: "ivory" as const,
    name: "Молочная",
    subtitle: "Светлая премиальная",
    color: "#f6eee4",
    ribbonColor: "#c49a72",
    price: 35,
    opacity: 0.58,
  },
] as const;

const flowerKinds = new Set<FlowerKind>(
  CUSTOM_BOUQUET_FLOWERS.map((flower) => flower.kind)
);
const wrappingSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeWrappingSnapshot(value: unknown): WrappingSnapshot | undefined {
  if (!isRecord(value) || typeof value.slug !== "string" ||
      !wrappingSlugPattern.test(value.slug) || value.slug.length > 64 ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 120 ||
      typeof value.subtitle !== "string" || value.subtitle.length > 180 ||
      typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color) ||
      typeof value.ribbonColor !== "string" || !/^#[0-9a-f]{6}$/i.test(value.ribbonColor) ||
      typeof value.salePrice !== "number" || !Number.isFinite(value.salePrice) || value.salePrice < 0 ||
      typeof value.opacity !== "number" || !Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1) {
    return undefined;
  }
  return {
    slug: value.slug,
    name: value.name.trim(),
    subtitle: value.subtitle.trim(),
    color: value.color.toLowerCase(),
    ribbonColor: value.ribbonColor.toLowerCase(),
    salePrice: Math.round(value.salePrice * 100) / 100,
    opacity: value.opacity,
  };
}

export function wrappingSnapshot(wrapping: PublicWrapping): WrappingSnapshot {
  return {
    slug: wrapping.slug,
    name: wrapping.name,
    subtitle: wrapping.subtitle,
    color: wrapping.color,
    ribbonColor: wrapping.ribbonColor,
    salePrice: wrapping.salePrice,
    opacity: wrapping.opacity,
  };
}

export function resolveWrappingSnapshot(config: CustomBouquetConfig): WrappingSnapshot | undefined {
  if (config.wrappingSnapshot?.slug === config.wrappingKind) return config.wrappingSnapshot;
  const legacy = LEGACY_CUSTOM_BOUQUET_WRAPPINGS.find((item) => item.kind === config.wrappingKind);
  return legacy ? {
    slug: legacy.kind,
    name: legacy.name,
    subtitle: legacy.subtitle,
    color: legacy.color,
    ribbonColor: legacy.ribbonColor,
    salePrice: legacy.price,
    opacity: legacy.opacity,
  } : undefined;
}

function sanitizeTuple(
  value: unknown,
  maximumAbsoluteValue: number
): BouquetVector3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (coordinate) =>
        typeof coordinate !== "number" ||
        !Number.isFinite(coordinate) ||
        Math.abs(coordinate) > maximumAbsoluteValue
    )
  ) {
    return null;
  }

  return [value[0], value[1], value[2]];
}

export function sanitizeCustomBouquetConfig(
  value: unknown
): CustomBouquetConfig | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    !Array.isArray(value.flowers) ||
    value.flowers.length < 1 ||
    value.flowers.length > MAX_CUSTOM_BOUQUET_FLOWERS ||
    typeof value.wrappingKind !== "string" ||
    value.wrappingKind.length > 64 ||
    !wrappingSlugPattern.test(value.wrappingKind)
  ) {
    return null;
  }

  const ids = new Set<string>();
  const flowers: CustomBouquetFlower[] = [];

  for (const candidate of value.flowers) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      candidate.id.trim().length < 1 ||
      candidate.id.length > 120 ||
      ids.has(candidate.id) ||
      (value.schemaVersion === 1
        ? !flowerKinds.has(candidate.kind as FlowerKind)
        : !isFlowerId(candidate.flowerId))
    ) {
      return null;
    }

    const position = sanitizeTuple(candidate.position, 4);
    const rotation = sanitizeTuple(candidate.rotation, MAX_ABSOLUTE_FLOWER_ROTATION);

    if (!position || !rotation) {
      return null;
    }

    ids.add(candidate.id);
    const snapshot = candidate.snapshot;
    const validSnapshot = isRecord(snapshot) && typeof snapshot.name === "string" &&
      snapshot.name.length > 0 && snapshot.name.length <= 255 &&
      typeof snapshot.salePrice === "number" && Number.isFinite(snapshot.salePrice) && snapshot.salePrice >= 0;
    flowers.push({
      id: candidate.id,
      ...(value.schemaVersion === 1 ? { kind: candidate.kind as FlowerKind } : {
        flowerId: candidate.flowerId as string,
        ...(validSnapshot ? { snapshot: {
          name: snapshot.name as string, salePrice: snapshot.salePrice as number,
          color: typeof snapshot.color === "string" ? snapshot.color.slice(0, 120) : null,
          imageUrl: typeof snapshot.imageUrl === "string" ? snapshot.imageUrl.slice(0, 2000) : null,
          model: sanitizeFlowerModel(snapshot.model),
        } } : {}),
      }),
      position,
      rotation,
    });
  }

  const safeWrappingSnapshot = sanitizeWrappingSnapshot(value.wrappingSnapshot);
  return {
    schemaVersion: value.schemaVersion,
    flowers,
    wrappingKind: value.wrappingKind,
    ...(safeWrappingSnapshot
      ? { wrappingSnapshot: safeWrappingSnapshot }
      : {}),
  };
}

export function validateCustomBouquetConfig(
  value: unknown
): value is CustomBouquetConfig {
  return sanitizeCustomBouquetConfig(value) !== null;
}

export function calculateCustomBouquetPrice(
  config: CustomBouquetConfig
): number {
  const flowerPrices = new Map(
    CUSTOM_BOUQUET_FLOWERS.map((flower) => [flower.kind, flower.price])
  );
  const wrapping = resolveWrappingSnapshot(config);

  const total = config.flowers.reduce(
    (sum, flower) => sum + Math.round((config.schemaVersion === 2
      ? flower.snapshot?.salePrice ?? NaN
      : flower.kind ? flowerPrices.get(flower.kind) ?? NaN : NaN) * 100),
    Math.round((wrapping?.salePrice ?? 0) * 100)
  );
  return total / 100;
}

export function createCustomBouquetSummary(
  config: CustomBouquetConfig
): CustomBouquetSummary {
  const wrapping = resolveWrappingSnapshot(config);

  if (config.schemaVersion === 2) {
    const groups = new Map<string, { flowerId: string; name: string; quantity: number; unitPrice: number }>();
    for (const flower of config.flowers) {
      const id = flower.flowerId!;
      const group = groups.get(id) ?? { flowerId: id, name: flower.snapshot?.name ?? `Цветок №${id}`, quantity: 0, unitPrice: flower.snapshot?.salePrice ?? 0 };
      group.quantity++;
      groups.set(id, group);
    }
    return { totalFlowers: config.flowers.length, wrappingName: wrapping?.name ?? "Неизвестная", flowers: [...groups.values()] };
  }
  return {
    totalFlowers: config.flowers.length,
    roseCount: config.flowers.filter((flower) => flower.kind === "rose").length,
    peonyCount: config.flowers.filter((flower) => flower.kind === "peony").length,
    tulipCount: config.flowers.filter((flower) => flower.kind === "tulip").length,
    wrappingName: wrapping?.name ?? "Неизвестная",
  };
}

export function sanitizeCustomBouquetSummary(
  value: unknown
): CustomBouquetSummary | null {
  if (!isRecord(value)) return null;

  if (Array.isArray(value.flowers)) {
    const entries = value.flowers;
    if (entries.length < 1 || entries.length > MAX_CUSTOM_BOUQUET_FLOWERS ||
        typeof value.wrappingName !== "string" || value.wrappingName.length > 120 ||
        !Number.isInteger(value.totalFlowers) || Number(value.totalFlowers) > MAX_CUSTOM_BOUQUET_FLOWERS ||
        entries.some((item) => !isRecord(item) || !isFlowerId(item.flowerId) ||
          typeof item.name !== "string" || !item.name || item.name.length > 255 ||
          !Number.isInteger(item.quantity) || Number(item.quantity) < 1 ||
          typeof item.unitPrice !== "number" || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) ||
        entries.reduce((sum, item) => sum + item.quantity, 0) !== value.totalFlowers ||
        new Set(entries.map((item) => item.flowerId)).size !== entries.length) return null;
    return { totalFlowers: Number(value.totalFlowers), wrappingName: value.wrappingName,
      flowers: entries.map((item) => ({ flowerId: item.flowerId, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice })) };
  }

  const totalFlowers = Number(value.totalFlowers);
  const roseCount = Number(value.roseCount);
  const peonyCount = Number(value.peonyCount);
  const tulipCount = Number(value.tulipCount);
  const counts = [totalFlowers, roseCount, peonyCount, tulipCount];

  if (
    counts.some((count) => !Number.isInteger(count) || count < 0) ||
    totalFlowers < 1 ||
    totalFlowers > MAX_CUSTOM_BOUQUET_FLOWERS ||
    roseCount + peonyCount + tulipCount !== totalFlowers ||
    typeof value.wrappingName !== "string" ||
    value.wrappingName.trim().length < 1 ||
    value.wrappingName.length > 120
  ) {
    return null;
  }

  return {
    totalFlowers,
    roseCount,
    peonyCount,
    tulipCount,
    wrappingName: value.wrappingName.trim(),
  };
}

function pluralize(
  count: number,
  one: string,
  few: string,
  many: string
): string {
  const lastTwo = count % 100;
  const last = count % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function formatCustomBouquetComposition(
  summary: CustomBouquetSummary
): string {
  if (summary.flowers) {
    return `${summary.totalFlowers} ${pluralize(summary.totalFlowers, "цветок", "цветка", "цветов")}: ${summary.flowers.map((item) => `${item.name} — ${item.quantity}`).join(", ")}`;
  }
  const parts = [
    summary.roseCount
      ? `${summary.roseCount} ${pluralize(summary.roseCount, "роза", "розы", "роз")}`
      : "",
    summary.peonyCount
      ? `${summary.peonyCount} ${pluralize(summary.peonyCount, "пион", "пиона", "пионов")}`
      : "",
    summary.tulipCount
      ? `${summary.tulipCount} ${pluralize(summary.tulipCount, "тюльпан", "тюльпана", "тюльпанов")}`
      : "",
  ].filter(Boolean);

  return `${summary.totalFlowers} ${pluralize(summary.totalFlowers, "цветок", "цветка", "цветов")}: ${parts.join(", ")}`;
}
