import "server-only";

import {
  sanitizeCustomBouquetConfig,
  type FlowerKind,
} from "@/lib/bouquet";
import { db } from "@/lib/db";
import type { PoolClient } from "pg";

export type OrderFlowerRequirement = {
  flowerId: string;
  name: string;
  requiredQuantity: number;
  stockQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  isAvailable: boolean;
  missingQuantity: number;
};

export type BouquetCompositionSnapshotFlower = {
  flowerId: string;
  name: string;
  quantity: number;
};

export type BouquetCompositionSnapshot = {
  version: 1;
  flowers: BouquetCompositionSnapshotFlower[];
};

export type OrderBouquetComposition = {
  orderItemId: string;
  source: "snapshot" | "catalog" | "missing";
  flowers: Array<BouquetCompositionSnapshotFlower & { totalQuantity: number }>;
};

export type OrderFlowerRequirementsResult = {
  requirements: OrderFlowerRequirement[];
  errors: string[];
  canCalculate: boolean;
  hasShortage: boolean;
  reservationState: "none" | "active" | "consumed" | "released";
  reservedForOrder: number;
  bouquetCompositions: OrderBouquetComposition[];
};

type OrderItemRow = {
  id: string;
  order_id: string;
  item_type: string;
  bouquet_id: string | null;
  product_name: string;
  quantity: number;
  custom_configuration: unknown;
  bouquet_composition_snapshot: unknown;
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

type SnapshotFlowerRow = {
  flower_id: string;
  stock_quantity: number;
};

type ReservationRow = {
  order_id: string;
  flower_id: string;
  quantity: number;
  status: "active" | "consumed" | "released";
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
  bouquetCompositions: OrderBouquetComposition[];
};

const FLOWER_KINDS: FlowerKind[] = ["rose", "peony", "tulip"];
const KIND_LABELS: Record<FlowerKind, string> = {
  rose: "Роза",
  peony: "Пион",
  tulip: "Тюльпан",
};
const MAX_BIGINT = "9223372036854775807";

function isDatabaseId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

export function parseBouquetCompositionSnapshot(
  value: unknown,
): BouquetCompositionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as { version?: unknown; flowers?: unknown };
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.flowers) ||
    snapshot.flowers.length === 0 ||
    snapshot.flowers.length > 100
  ) {
    return null;
  }

  const flowers: BouquetCompositionSnapshotFlower[] = [];
  const flowerIds = new Set<string>();
  for (const valueFlower of snapshot.flowers) {
    if (
      !valueFlower ||
      typeof valueFlower !== "object" ||
      Array.isArray(valueFlower)
    ) {
      return null;
    }
    const flower = valueFlower as {
      flowerId?: unknown;
      name?: unknown;
      quantity?: unknown;
    };
    const name = typeof flower.name === "string" ? flower.name.trim() : "";
    if (
      !isDatabaseId(flower.flowerId) ||
      flowerIds.has(flower.flowerId) ||
      !name ||
      name.length > 255 ||
      !Number.isInteger(flower.quantity) ||
      Number(flower.quantity) <= 0 ||
      Number(flower.quantity) > 2_147_483_647
    ) {
      return null;
    }
    flowerIds.add(flower.flowerId);
    flowers.push({
      flowerId: flower.flowerId,
      name,
      quantity: Number(flower.quantity),
    });
  }
  return { version: 1, flowers };
}

export function createBouquetCompositionSnapshot(
  flowers: BouquetCompositionSnapshotFlower[],
) {
  return parseBouquetCompositionSnapshot({ version: 1, flowers });
}

function emptyMutableResult(): MutableOrderResult {
  return {
    quantities: new Map(),
    flowers: new Map(),
    errors: new Set(),
    bouquetCompositions: [],
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
  client?: PoolClient,
): Promise<Map<string, OrderFlowerRequirementsResult>> {
  const uniqueOrderIds = [...new Set(orderIds)];
  if (uniqueOrderIds.length === 0) return new Map();

  const queryable = client ?? db;
  const orderItemsResult = await queryable.query<OrderItemRow>(
    `
      SELECT id::text,
             order_id::text,
             item_type,
             bouquet_id::text,
             product_name,
             quantity,
             custom_configuration,
             bouquet_composition_snapshot
      FROM public.order_items
      WHERE order_id = ANY($1::uuid[])
      ORDER BY order_id, id
    `,
    [uniqueOrderIds],
  );

  const bouquetSnapshots = new Map<string, BouquetCompositionSnapshot | null>();
  for (const item of orderItemsResult.rows) {
    if (
      item.item_type === "bouquet" &&
      item.bouquet_composition_snapshot !== null &&
      item.bouquet_composition_snapshot !== undefined
    ) {
      bouquetSnapshots.set(
        item.id,
        parseBouquetCompositionSnapshot(item.bouquet_composition_snapshot),
      );
    }
  }
  const bouquetIds = [
    ...new Set(
      orderItemsResult.rows
        .filter(
          (item) =>
            item.item_type === "bouquet" &&
            item.bouquet_id &&
            !bouquetSnapshots.has(item.id),
        )
        .map((item) => item.bouquet_id as string),
    ),
  ];
  const snapshotFlowerIds = [
    ...new Set(
      [...bouquetSnapshots.values()].flatMap((snapshot) =>
        snapshot ? snapshot.flowers.map((flower) => flower.flowerId) : [],
      ),
    ),
  ];
  const hasCustomBouquets = orderItemsResult.rows.some(
    (item) => item.item_type === "custom_bouquet",
  );

  const bouquetItemsResult = bouquetIds.length > 0
    ? await queryable.query<BouquetItemRow>(
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
    : { rows: [] as BouquetItemRow[] };
  const constructorFlowersResult = hasCustomBouquets
    ? await queryable.query<ConstructorFlowerRow>(`
          SELECT id::text AS flower_id,
                 name AS flower_name,
                 stock_quantity,
                 constructor_kind
          FROM public.flowers
          WHERE constructor_kind IS NOT NULL
        `)
    : { rows: [] as ConstructorFlowerRow[] };
  const snapshotFlowersResult = snapshotFlowerIds.length > 0
    ? await queryable.query<SnapshotFlowerRow>(
        `
          SELECT id::text AS flower_id, stock_quantity
          FROM public.flowers
          WHERE id = ANY($1::bigint[])
        `,
        [snapshotFlowerIds],
      )
    : { rows: [] as SnapshotFlowerRow[] };
  const reservationsResult = await queryable.query<ReservationRow>(
    `
      SELECT order_id::text, flower_id::text, quantity, status
      FROM public.order_stock_reservations
      WHERE status = 'active'
         OR order_id = ANY($1::uuid[])
    `,
    [uniqueOrderIds],
  );

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
  const snapshotStockByFlower = new Map(
    snapshotFlowersResult.rows.map((flower) => [
      flower.flower_id,
      Number(flower.stock_quantity),
    ]),
  );

  const activeReservedByFlower = new Map<string, number>();
  const reservationsByOrder = new Map<string, ReservationRow[]>();
  for (const reservation of reservationsResult.rows) {
    const orderReservations =
      reservationsByOrder.get(reservation.order_id) ?? [];
    orderReservations.push(reservation);
    reservationsByOrder.set(reservation.order_id, orderReservations);
    if (reservation.status === "active") {
      activeReservedByFlower.set(
        reservation.flower_id,
        (activeReservedByFlower.get(reservation.flower_id) ?? 0) +
          Number(reservation.quantity),
      );
    }
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
      if (bouquetSnapshots.has(item.id)) {
        const snapshot = bouquetSnapshots.get(item.id);
        if (!snapshot) {
          console.error("Invalid bouquet composition snapshot:", {
            orderId: item.order_id,
            orderItemId: item.id,
          });
          order.errors.add(
            `Сохранённый состав букета «${item.product_name}» повреждён`,
          );
          order.bouquetCompositions.push({
            orderItemId: item.id,
            source: "missing",
            flowers: [],
          });
          continue;
        }
        order.bouquetCompositions.push({
          orderItemId: item.id,
          source: "snapshot",
          flowers: snapshot.flowers.map((flower) => ({
            ...flower,
            totalQuantity: flower.quantity * orderItemQuantity,
          })),
        });
        for (const snapshotFlower of snapshot.flowers) {
          const stockQuantity = snapshotStockByFlower.get(
            snapshotFlower.flowerId,
          );
          if (stockQuantity === undefined) {
            order.errors.add(
              `Цветок «${snapshotFlower.name}» из сохранённого состава не найден`,
            );
            continue;
          }
          addRequirement(
            order,
            {
              flowerId: snapshotFlower.flowerId,
              name: snapshotFlower.name,
              stockQuantity,
            },
            snapshotFlower.quantity * orderItemQuantity,
          );
        }
        continue;
      }
      if (!item.bouquet_id) {
        order.errors.add(`У букета «${item.product_name}» отсутствует состав`);
        order.bouquetCompositions.push({
          orderItemId: item.id,
          source: "missing",
          flowers: [],
        });
        continue;
      }
      const composition = compositionByBouquet.get(item.bouquet_id) ?? [];
      if (composition.length === 0) {
        order.errors.add(`У букета «${item.product_name}» отсутствует состав`);
        order.bouquetCompositions.push({
          orderItemId: item.id,
          source: "missing",
          flowers: [],
        });
        continue;
      }
      order.bouquetCompositions.push({
        orderItemId: item.id,
        source: "catalog",
        flowers: composition
          .filter((compositionItem) => compositionItem.flower_name)
          .map((compositionItem) => ({
            flowerId: compositionItem.flower_id,
            name: compositionItem.flower_name as string,
            quantity: Number(compositionItem.quantity),
            totalQuantity:
              Number(compositionItem.quantity) * orderItemQuantity,
          })),
      });
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
      const orderReservations = reservationsByOrder.get(orderId) ?? [];
      const activeForOrder = new Map<string, number>();
      for (const reservation of orderReservations) {
        if (reservation.status === "active") {
          activeForOrder.set(
            reservation.flower_id,
            (activeForOrder.get(reservation.flower_id) ?? 0) +
              Number(reservation.quantity),
          );
        }
      }
      const requirements = [...result.quantities].map(
        ([flowerId, requiredQuantity]): OrderFlowerRequirement => {
          const flower = result.flowers.get(flowerId)!;
          const reservedQuantity = activeForOrder.get(flowerId) ?? 0;
          const availableQuantity = Math.max(
            0,
            flower.stockQuantity -
              (activeReservedByFlower.get(flowerId) ?? 0) +
              reservedQuantity,
          );
          const missingQuantity = Math.max(
            0,
            requiredQuantity - availableQuantity,
          );
          return {
            flowerId,
            name: flower.name,
            requiredQuantity,
            stockQuantity: flower.stockQuantity,
            reservedQuantity,
            availableQuantity,
            isAvailable: missingQuantity === 0,
            missingQuantity,
          };
        },
      );
      requirements.sort((first, second) =>
        first.name.localeCompare(second.name, "ru"),
      );
      const reservationStatuses = new Set(
        orderReservations.map((reservation) => reservation.status),
      );
      const reservationState = reservationStatuses.has("active")
        ? "active"
        : reservationStatuses.has("consumed")
          ? "consumed"
          : reservationStatuses.has("released")
            ? "released"
            : "none";
      return [
        orderId,
        {
          requirements,
          errors: [...result.errors],
          canCalculate: result.errors.size === 0,
          hasShortage: requirements.some((item) => !item.isAvailable),
          reservationState,
          reservedForOrder: [...activeForOrder.values()].reduce(
            (total, quantity) => total + quantity,
            0,
          ),
          bouquetCompositions: result.bouquetCompositions,
        },
      ];
    }),
  );
}
