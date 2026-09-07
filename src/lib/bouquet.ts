export type FlowerKind = "rose" | "peony" | "tulip";
export type WrappingKind = "blush" | "kraft" | "ivory";
export type BouquetVector3 = [number, number, number];

export type CustomBouquetFlower = {
  id: string;
  kind: FlowerKind;
  position: BouquetVector3;
  rotation: BouquetVector3;
};

export type CustomBouquetConfig = {
  schemaVersion: 1;
  flowers: CustomBouquetFlower[];
  wrappingKind: WrappingKind;
};

export type CustomBouquetSummary = {
  totalFlowers: number;
  roseCount: number;
  peonyCount: number;
  tulipCount: number;
  wrappingName: string;
};

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

export const CUSTOM_BOUQUET_WRAPPINGS = [
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
const wrappingKinds = new Set<WrappingKind>(
  CUSTOM_BOUQUET_WRAPPINGS.map((wrapping) => wrapping.kind)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    value.schemaVersion !== 1 ||
    !Array.isArray(value.flowers) ||
    value.flowers.length < 1 ||
    value.flowers.length > MAX_CUSTOM_BOUQUET_FLOWERS ||
    typeof value.wrappingKind !== "string" ||
    !wrappingKinds.has(value.wrappingKind as WrappingKind)
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
      typeof candidate.kind !== "string" ||
      !flowerKinds.has(candidate.kind as FlowerKind)
    ) {
      return null;
    }

    const position = sanitizeTuple(candidate.position, 4);
    const rotation = sanitizeTuple(candidate.rotation, MAX_ABSOLUTE_FLOWER_ROTATION);

    if (!position || !rotation) {
      return null;
    }

    ids.add(candidate.id);
    flowers.push({
      id: candidate.id,
      kind: candidate.kind as FlowerKind,
      position,
      rotation,
    });
  }

  return {
    schemaVersion: 1,
    flowers,
    wrappingKind: value.wrappingKind as WrappingKind,
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
  const wrapping = CUSTOM_BOUQUET_WRAPPINGS.find(
    (option) => option.kind === config.wrappingKind
  );

  return config.flowers.reduce(
    (total, flower) => total + (flowerPrices.get(flower.kind) ?? 0),
    wrapping?.price ?? 0
  );
}

export function createCustomBouquetSummary(
  config: CustomBouquetConfig
): CustomBouquetSummary {
  const wrapping = CUSTOM_BOUQUET_WRAPPINGS.find(
    (option) => option.kind === config.wrappingKind
  );

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
