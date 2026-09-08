import "server-only";

import {
  sanitizeCustomBouquetConfig,
  type FlowerKind,
} from "@/lib/bouquet";
import { db } from "@/lib/db";

export type OrderFlowerRequirement = {
  flowerId: string;
  name: string;
  requiredQuantity: number;
  stockQuantity: number;
  isAvailable: boolean;
  missingQuantity: number;
};

export type OrderFlowerRequirementsResult = {
  requirements: OrderFlowerRequirement[];
  errors: string[];
  canCalculate: boolean;
  hasShortage: boolean;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  item_type: string;
  bouquet_id: string | null;
  product_name: string;
  quantity: number;
  custom_configuration: unknown;
};

type BouquetItemRow = {
  bouquet_id: string;
  flower_id: string;
  quantity: number;
  flower_name: string | null;
  stock_quantity: number | null;
};

type ConstructorFlowerRow = {
  flower_id: string;
  flower_name: string;
  stock_quantity: number;
  constructor_kind: FlowerKind;
};

type StockFlower = {
  flowerId: string;
  name: string;
  stockQuantity: number;
};

type MutableOrderResult = {
  quantities: Map<string, number>;
  flowers: Map<string, StockFlower>;
  errors: Set<string>;
};

const FLOWER_KINDS: FlowerKind[] = ["rose", "peony", "tulip"];
const KIND_LABELS: Record<FlowerKind, string> = {
  rose: "Роза",
  peony: "Пион",
  tulip: "Тюльпан",
};

function emptyMutableResult(): MutableOrderResult {
  return {
    quantities: new Map(),
    flowers: new Map(),
    errors: new Set(),
  };
}

function addRequirement(
  result: MutableOrderResult,
  flower: StockFlower,
  quantity: number,
) {
  result.flowers.set(flower.flowerId, flower);
  result.quantities.set(
    flower.flowerId,
    (result.quantities.get(flower.flowerId) ?? 0) + quantity,
  );
}

export async function getOrderFlowerRequirements(
  orderIds: string[],
): Promise<Map<string, OrderFlowerRequirementsResult>> {
  const uniqueOrderIds = [...new Set(orderIds)];
  if (uniqueOrderIds.length === 0) return new Map();

  const orderItemsResult = await db.query<OrderItemRow>(
    `
      SELECT id::text,
             order_id::text,
             item_type,
             bouquet_id::text,
             product_name,
             quantity,
             custom_configuration
      FROM public.order_items
      WHERE order_id = ANY($1::uuid[])
      ORDER BY order_id, id
    `,
    [uniqueOrderIds],
  );

  const bouquetIds = [
    ...new Set(
      orderItemsResult.rows
        .filter((item) => item.item_type === "bouquet" && item.bouquet_id)
        .map((item) => item.bouquet_id as string),
    ),
  ];
  const hasCustomBouquets = orderItemsResult.rows.some(
    (item) => item.item_type === "custom_bouquet",
  );

  const [bouquetItemsResult, constructorFlowersResult] = await Promise.all([
    bouquetIds.length > 0
      ? db.query<BouquetItemRow>(
          `
            SELECT bi.bouquet_id::text,
                   bi.flower_id::text,
                   bi.quantity,
                   f.name AS flower_name,
                   f.stock_quantity
            FROM public.bouquet_items bi
            LEFT JOIN public.flowers f ON f.id = bi.flower_id
            WHERE bi.bouquet_id = ANY($1::bigint[])
            ORDER BY bi.bouquet_id, bi.flower_id
          `,
          [bouquetIds],
        )
      : Promise.resolve({ rows: [] as BouquetItemRow[] }),
    hasCustomBouquets
      ? db.query<ConstructorFlowerRow>(`
          SELECT id::text AS flower_id,
                 name AS flower_name,
                 stock_quantity,
                 constructor_kind
          FROM public.flowers
          WHERE constructor_kind IS NOT NULL
        `)
      : Promise.resolve({ rows: [] as ConstructorFlowerRow[] }),
  ]);

  const compositionByBouquet = new Map<string, BouquetItemRow[]>();
  for (const item of bouquetItemsResult.rows) {
    const rows = compositionByBouquet.get(item.bouquet_id) ?? [];
    rows.push(item);
    compositionByBouquet.set(item.bouquet_id, rows);
  }
  const flowerByKind = new Map<FlowerKind, StockFlower>();
  for (const flower of constructorFlowersResult.rows) {
    flowerByKind.set(flower.constructor_kind, {
      flowerId: flower.flower_id,
      name: flower.flower_name,
      stockQuantity: Number(flower.stock_quantity),
    });
  }

  const mutableByOrder = new Map<string, MutableOrderResult>();
  for (const orderId of uniqueOrderIds) {
    mutableByOrder.set(orderId, emptyMutableResult());
  }

  for (const item of orderItemsResult.rows) {
    const order = mutableByOrder.get(item.order_id);
    if (!order) continue;
    const orderItemQuantity = Number(item.quantity);
    if (!Number.isInteger(orderItemQuantity) || orderItemQuantity <= 0) {
      order.errors.add(`Некорректное количество позиции «${item.product_name}»`);
      continue;
    }

    if (item.item_type === "bouquet") {
      if (!item.bouquet_id) {
        order.errors.add(`У букета «${item.product_name}» отсутствует состав`);
        continue;
      }
      const composition = compositionByBouquet.get(item.bouquet_id) ?? [];
      if (composition.length === 0) {
        order.errors.add(`У букета «${item.product_name}» отсутствует состав`);
        continue;
      }
      for (const compositionItem of composition) {
        if (
          !compositionItem.flower_name ||
          compositionItem.stock_quantity === null
        ) {
          order.errors.add(
            `Цветок из состава букета «${item.product_name}» не найден`,
          );
          continue;
        }
        addRequirement(
          order,
          {
            flowerId: compositionItem.flower_id,
            name: compositionItem.flower_name,
            stockQuantity: Number(compositionItem.stock_quantity),
          },
          Number(compositionItem.quantity) * orderItemQuantity,
        );
      }
      continue;
    }

    if (item.item_type === "custom_bouquet") {
      const configuration = sanitizeCustomBouquetConfig(
        item.custom_configuration,
      );
      if (!configuration) {
        console.error("getOrderFlowerRequirements invalid custom bouquet:", {
          orderId: item.order_id,
          orderItemId: item.id,
        });
        order.errors.add(
          `Конфигурация авторского букета «${item.product_name}» повреждена`,
        );
        continue;
      }

      const counts: Record<FlowerKind, number> = {
        rose: 0,
        peony: 0,
        tulip: 0,
      };
      for (const flower of configuration.flowers) counts[flower.kind] += 1;
      for (const kind of FLOWER_KINDS) {
        if (counts[kind] === 0) continue;
        const stockFlower = flowerByKind.get(kind);
        if (!stockFlower) {
          order.errors.add(
            `Для типа «${KIND_LABELS[kind]}» не настроена связь со складом`,
          );
          continue;
        }
        addRequirement(
          order,
          stockFlower,
          counts[kind] * orderItemQuantity,
        );
      }
    }
  }

  return new Map(
    [...mutableByOrder].map(([orderId, result]) => {
      const requirements = [...result.quantities].map(
        ([flowerId, requiredQuantity]): OrderFlowerRequirement => {
          const flower = result.flowers.get(flowerId)!;
          const missingQuantity = Math.max(
            0,
            requiredQuantity - flower.stockQuantity,
          );
          return {
            flowerId,
            name: flower.name,
            requiredQuantity,
            stockQuantity: flower.stockQuantity,
            isAvailable: missingQuantity === 0,
            missingQuantity,
          };
        },
      );
      requirements.sort((first, second) =>
        first.name.localeCompare(second.name, "ru"),
      );
      return [
        orderId,
        {
          requirements,
          errors: [...result.errors],
          canCalculate: result.errors.size === 0,
          hasShortage: requirements.some((item) => !item.isAvailable),
        },
      ];
    }),
  );
}
