import {
  calculateCustomBouquetPrice,
  createCustomBouquetSummary,
  sanitizeCustomBouquetConfig,
  type CustomBouquetConfig,
  type CustomBouquetSummary,
} from "@/lib/bouquet";

export const CART_STORAGE_KEY = "lotus-cart";
export const CART_ITEM_MAX_QUANTITY = 99;

export type CatalogCartItem = {
  id: string;
  itemType: "catalog-bouquet";
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type CustomBouquetCartItem = {
  id: string;
  itemType: "custom-bouquet";
  name: "Авторский букет";
  quantity: number;
  unitPrice: number;
  configuration: CustomBouquetConfig;
  summary: CustomBouquetSummary;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
};

export type CartItem = CatalogCartItem | CustomBouquetCartItem;

export function addCatalogBouquetToCart(
  items: CartItem[],
  bouquet: { id: string; name: string; sale_price: string },
): CartItem[] {
  const existing = items.find(
    (item) => item.itemType === "catalog-bouquet" && item.productId === bouquet.id,
  );
  if (existing) {
    return items.map((item) =>
      item.itemType === "catalog-bouquet" && item.id === existing.id
        ? {
            ...item,
            name: bouquet.name,
            unitPrice: Number(bouquet.sale_price),
            quantity: Math.min(CART_ITEM_MAX_QUANTITY, item.quantity + 1),
          }
        : item,
    );
  }
  return [...items, {
    id: `catalog-bouquet-${bouquet.id}`,
    itemType: "catalog-bouquet",
    productId: bouquet.id,
    name: bouquet.name,
    unitPrice: Number(bouquet.sale_price),
    quantity: 1,
  }];
}

export type CartReadResult = {
  items: CartItem[];
  priceAdjusted: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeQuantity(value: unknown): number | null {
  const quantity = Number(value);
  return Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= CART_ITEM_MAX_QUANTITY
    ? quantity
    : null;
}

function sanitizeThumbnail(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.startsWith("data:image/webp") &&
    value.length <= 900_000
    ? value
    : undefined;
}

export function sanitizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];

  const items: CartItem[] = [];
  const ids = new Set<string>();

  for (const candidate of value) {
    if (!isRecord(candidate)) continue;

    const id = typeof candidate.id === "string" ? candidate.id : "";
    const quantity = sanitizeQuantity(candidate.quantity);

    if (!id || ids.has(id) || quantity === null) continue;

    if (candidate.itemType === "custom-bouquet") {
      const configuration = sanitizeCustomBouquetConfig(
        candidate.configuration
      );

      if (!configuration) continue;

      const createdAt =
        typeof candidate.createdAt === "string" &&
        Number.isFinite(Date.parse(candidate.createdAt))
          ? candidate.createdAt
          : new Date().toISOString();
      const updatedAt =
        typeof candidate.updatedAt === "string" &&
        Number.isFinite(Date.parse(candidate.updatedAt))
          ? candidate.updatedAt
          : createdAt;

      items.push({
        id,
        itemType: "custom-bouquet",
        name: "Авторский букет",
        quantity,
        unitPrice: Number.isFinite(Number(candidate.unitPrice)) && Number(candidate.unitPrice) >= 0
          ? Number(candidate.unitPrice)
          : calculateCustomBouquetPrice(configuration),
        configuration,
        summary: createCustomBouquetSummary(configuration),
        thumbnail: configuration.flowers.some((flower) => !flower.kind && !flower.snapshot?.model) ? undefined : sanitizeThumbnail(candidate.thumbnail),
        createdAt,
        updatedAt,
      });
      ids.add(id);
      continue;
    }

    if (
      candidate.itemType !== undefined &&
      candidate.itemType !== "catalog-bouquet"
    ) {
      continue;
    }

    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const productId =
      typeof candidate.productId === "string"
        ? candidate.productId
        : id;
    const legacyPrice = candidate.price;
    const unitPrice = Number(candidate.unitPrice ?? legacyPrice);

    if (
      !name ||
      !productId ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      continue;
    }

    items.push({
      id,
      itemType: "catalog-bouquet",
      productId,
      name,
      quantity,
      unitPrice,
    });
    ids.add(id);
  }

  return items;
}

export function readCartItems(): CartItem[] {
  return readCartState().items;
}

export function readCartState(): CartReadResult {
  try {
    const stored = window.localStorage.getItem(CART_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    const items = sanitizeCartItems(parsed);
    const customItemsById = new Map(
      items
        .filter(
          (item): item is CustomBouquetCartItem =>
            item.itemType === "custom-bouquet"
        )
        .map((item) => [item.id, item])
    );
    const priceAdjusted = Array.isArray(parsed)
      ? parsed.some((candidate) => {
          if (
            !isRecord(candidate) ||
            candidate.itemType !== "custom-bouquet" ||
            typeof candidate.id !== "string"
          ) {
            return false;
          }

          const sanitized = customItemsById.get(candidate.id);
          const storedPrice = Number(candidate.unitPrice);

          return Boolean(
            sanitized &&
              (!Number.isFinite(storedPrice) ||
                Math.abs(storedPrice - sanitized.unitPrice) > 0.001)
          );
        })
      : false;

    if (stored) {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }

    return { items, priceAdjusted };
  } catch {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    return { items: [], priceAdjusted: false };
  }
}

export function writeCartItems(items: CartItem[]): void {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify(sanitizeCartItems(items))
  );
}

export function getCartItemLineTotal(item: CartItem): number {
  return item.unitPrice * item.quantity;
}
