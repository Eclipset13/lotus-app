import {
  Euler,
  Quaternion,
  Vector3 as ThreeVector3,
} from "three";
import type {
  BouquetVector3,
  CustomBouquetFlower,
  FlowerKind,
} from "@/lib/bouquet";

export type { FlowerKind } from "@/lib/bouquet";
export type Vector3 = BouquetVector3;
export type FlowerInstance = CustomBouquetFlower;

export const FLOWER_GAP = 0.075;
export const FLOWER_HEAD_OFFSET = 0.9;

const BOUQUET_INNER_PADDING = 0.055;
const MAX_BOUQUET_RADIUS = 1.88;
// Обычная композиция стабилизируется за 8–12 проходов. Верхний предел
// нужен только для патологического случая, когда много цветов имеют
// абсолютно одинаковые координаты; цикл завершится раньше без коллизий.
const COLLISION_ITERATIONS = 48;
const WRAPPING_TOP_Y = 0.52;
// The flower is tilted around the centre of its head. The model's stem ends
// 3.05 units below that pivot (0.9 to the old origin + 2.15 to the stem end).
const STEM_BOTTOM_OFFSET = 3.05;
const EPSILON = 0.0001;
const COLLISION_SAFETY = 0.003;

export function getFlowerCollisionRadius(kind?: FlowerKind): number {
  switch (kind) {
    case "peony":
      return 0.28;
    case "tulip":
      return 0.22;
    case "rose":
    default:
      return 0.24;
  }
}

// The procedural meshes are slightly wider than their collision circles.
// This conservative visual envelope keeps every petal inside the wrapping,
// including tall tulip petals after the flower is tilted.
export function getFlowerBoundaryRadius(kind?: FlowerKind): number {
  switch (kind) {
    case "peony":
      return 0.45;
    case "tulip":
      return 0.4;
    case "rose":
    default:
      return 0.4;
  }
}

export function getMinimumFlowerDistance(
  a: Pick<FlowerInstance, "kind">,
  b: Pick<FlowerInstance, "kind">
): number {
  return (
    getFlowerCollisionRadius(a.kind) +
    getFlowerCollisionRadius(b.kind) +
    FLOWER_GAP
  );
}

export function getBouquetRadius(
  flowersOrCount: FlowerInstance[] | number
): number {
  const count =
    typeof flowersOrCount === "number"
      ? flowersOrCount
      : flowersOrCount.length;

  if (count <= 0) {
    return 0.42;
  }

  const countRadius = 0.45 + Math.sqrt(count) * 0.23;

  if (typeof flowersOrCount === "number") {
    return Math.min(MAX_BOUQUET_RADIUS, countRadius);
  }

  const occupiedArea = flowersOrCount.reduce((sum, flower) => {
    const radius =
      getFlowerCollisionRadius(flower.kind) + FLOWER_GAP / 2;

    return sum + radius ** 2;
  }, 0);

  const packingRadius =
    Math.sqrt(occupiedArea / 0.67) +
    BOUQUET_INNER_PADDING +
    0.055;
  const visualEnvelopeMargin = flowersOrCount.reduce(
    (maximum, flower) =>
      Math.max(
        maximum,
        getFlowerBoundaryRadius(flower.kind) -
          getFlowerCollisionRadius(flower.kind)
      ),
    0
  );

  return Math.min(
    MAX_BOUQUET_RADIUS,
    Math.max(
      countRadius,
      packingRadius + visualEnvelopeMargin + 0.02
    )
  );
}

export function clampFlowerToBouquet(
  flower: FlowerInstance,
  bouquetRadius: number
): FlowerInstance {
  const maxCenterRadius = Math.max(
    0,
    bouquetRadius -
      getFlowerBoundaryRadius(flower.kind) -
      BOUQUET_INNER_PADDING
  );
  const x = Number.isFinite(flower.position[0])
    ? flower.position[0]
    : 0;
  const z = Number.isFinite(flower.position[2])
    ? flower.position[2]
    : 0;
  const distance = Math.hypot(x, z);

  if (distance <= maxCenterRadius || distance < EPSILON) {
    if (x === flower.position[0] && z === flower.position[2]) {
      return flower;
    }

    return {
      ...flower,
      position: [x, flower.position[1], z],
    };
  }

  const scale = maxCenterRadius / distance;

  return {
    ...flower,
    position: [
      x * scale,
      flower.position[1],
      z * scale,
    ],
  };
}

function deterministicDirection(
  firstId: string,
  secondId: string,
  firstIndex: number,
  secondIndex: number
): [number, number] {
  const seed = `${firstId}:${secondId}`.split("").reduce(
    (sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0,
    firstIndex * 97 + secondIndex * 193
  );
  const angle = (seed % 360) * (Math.PI / 180);

  return [Math.cos(angle), Math.sin(angle)];
}

function shiftFlower(
  flower: FlowerInstance,
  deltaX: number,
  deltaZ: number,
  bouquetRadius: number
): FlowerInstance {
  return clampFlowerToBouquet(
    {
      ...flower,
      position: [
        flower.position[0] + deltaX,
        flower.position[1],
        flower.position[2] + deltaZ,
      ],
    },
    bouquetRadius
  );
}

export function resolveFlowerCollisions(
  flowers: FlowerInstance[],
  activeId: string | null,
  bouquetRadius: number
): FlowerInstance[] {
  if (flowers.length <= 1) {
    return flowers.map((flower) =>
      clampFlowerToBouquet(
        {
          ...flower,
          position: [...flower.position],
          rotation: [...flower.rotation],
        },
        bouquetRadius
      )
    );
  }

  let working = flowers.map((flower) =>
    clampFlowerToBouquet(
      {
        ...flower,
        position: [...flower.position],
        rotation: [...flower.rotation],
      },
      bouquetRadius
    )
  );

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    let collisionFound = false;

    for (let firstIndex = 0; firstIndex < working.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < working.length;
        secondIndex += 1
      ) {
        let first = working[firstIndex];
        let second = working[secondIndex];
        let deltaX = second.position[0] - first.position[0];
        let deltaZ = second.position[2] - first.position[2];
        let distance = Math.hypot(deltaX, deltaZ);
        const minimumDistance =
          getMinimumFlowerDistance(first, second) + COLLISION_SAFETY;

        if (distance + EPSILON >= minimumDistance) {
          continue;
        }

        collisionFound = true;

        if (distance < EPSILON) {
          [deltaX, deltaZ] = deterministicDirection(
            first.id,
            second.id,
            firstIndex,
            secondIndex
          );
          distance = 1;
        }

        const directionX = deltaX / distance;
        const directionZ = deltaZ / distance;
        const overlap = minimumDistance - Math.min(distance, minimumDistance);
        const firstIsActive = first.id === activeId;
        const secondIsActive = second.id === activeId;
        const firstShare = firstIsActive ? 0.06 : secondIsActive ? 0.94 : 0.5;
        const secondShare = secondIsActive ? 0.06 : firstIsActive ? 0.94 : 0.5;

        first = shiftFlower(
          first,
          -directionX * overlap * firstShare,
          -directionZ * overlap * firstShare,
          bouquetRadius
        );
        second = shiftFlower(
          second,
          directionX * overlap * secondShare,
          directionZ * overlap * secondShare,
          bouquetRadius
        );

        const remainingDistance = Math.hypot(
          second.position[0] - first.position[0],
          second.position[2] - first.position[2]
        );
        const remainingOverlap = minimumDistance - remainingDistance;

        if (remainingOverlap > EPSILON) {
          if (firstIsActive) {
            second = shiftFlower(
              second,
              directionX * remainingOverlap,
              directionZ * remainingOverlap,
              bouquetRadius
            );

            const afterNeighborMove =
              minimumDistance -
              Math.hypot(
                second.position[0] - first.position[0],
                second.position[2] - first.position[2]
              );

            if (afterNeighborMove > EPSILON) {
              first = shiftFlower(
                first,
                -directionX * afterNeighborMove,
                -directionZ * afterNeighborMove,
                bouquetRadius
              );
            }
          } else if (secondIsActive) {
            first = shiftFlower(
              first,
              -directionX * remainingOverlap,
              -directionZ * remainingOverlap,
              bouquetRadius
            );

            const afterNeighborMove =
              minimumDistance -
              Math.hypot(
                second.position[0] - first.position[0],
                second.position[2] - first.position[2]
              );

            if (afterNeighborMove > EPSILON) {
              second = shiftFlower(
                second,
                directionX * afterNeighborMove,
                directionZ * afterNeighborMove,
                bouquetRadius
              );
            }
          } else {
            first = shiftFlower(
              first,
              -directionX * remainingOverlap * 0.5,
              -directionZ * remainingOverlap * 0.5,
              bouquetRadius
            );
            second = shiftFlower(
              second,
              directionX * remainingOverlap * 0.5,
              directionZ * remainingOverlap * 0.5,
              bouquetRadius
            );
          }
        }

        working[firstIndex] = first;
        working[secondIndex] = second;
      }
    }

    working = working.map((flower) =>
      clampFlowerToBouquet(flower, bouquetRadius)
    );

    if (!collisionFound) {
      break;
    }
  }

  return working;
}

function getMaximumOverlap(flowers: FlowerInstance[]): number {
  let maximumOverlap = 0;

  for (let firstIndex = 0; firstIndex < flowers.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < flowers.length;
      secondIndex += 1
    ) {
      const first = flowers[firstIndex];
      const second = flowers[secondIndex];
      const distance = Math.hypot(
        second.position[0] - first.position[0],
        second.position[2] - first.position[2]
      );

      maximumOverlap = Math.max(
        maximumOverlap,
        getMinimumFlowerDistance(first, second) - distance
      );
    }
  }

  return maximumOverlap;
}

export function generateRandomBouquetLayout(
  flowers: FlowerInstance[],
  bouquetRadius: number
): FlowerInstance[] {
  if (!flowers.length) {
    return flowers;
  }

  const sorted = [...flowers].sort(
    (a, b) =>
      getFlowerCollisionRadius(b.kind) -
      getFlowerCollisionRadius(a.kind)
  );
  let bestLayout = flowers;
  let bestOverlap = Number.POSITIVE_INFINITY;

  for (let layoutAttempt = 0; layoutAttempt < 24; layoutAttempt += 1) {
    const placed: FlowerInstance[] = [];

    for (const flower of sorted) {
      const availableRadius = Math.max(
        0,
        bouquetRadius -
          getFlowerBoundaryRadius(flower.kind) -
          BOUQUET_INNER_PADDING
      );
      let bestPosition: [number, number] = [0, 0];
      let bestClearance = Number.NEGATIVE_INFINITY;

      for (let pointAttempt = 0; pointAttempt < 140; pointAttempt += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * availableRadius;
        const candidate: [number, number] = [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        ];
        const clearance = placed.reduce((minimum, neighbor) => {
          const distance = Math.hypot(
            candidate[0] - neighbor.position[0],
            candidate[1] - neighbor.position[2]
          );

          return Math.min(
            minimum,
            distance - getMinimumFlowerDistance(flower, neighbor)
          );
        }, Number.POSITIVE_INFINITY);

        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestPosition = candidate;
        }

        if (clearance >= 0.004) {
          break;
        }
      }

      placed.push({
        ...flower,
        position: [bestPosition[0], flower.position[1], bestPosition[1]],
      });
    }

    const positionsById = new Map(
      placed.map((flower) => [flower.id, flower.position] as const)
    );
    const candidate = flowers.map((flower) => ({
      ...flower,
      position: [...(positionsById.get(flower.id) ?? flower.position)] as Vector3,
    }));
    const resolved = resolveFlowerCollisions(candidate, null, bouquetRadius);
    const overlap = getMaximumOverlap(resolved);

    if (overlap < bestOverlap) {
      bestLayout = resolved;
      bestOverlap = overlap;
    }

    if (overlap <= EPSILON) {
      return resolved;
    }
  }

  return resolveFlowerCollisions(bestLayout, null, bouquetRadius);
}

/**
 * Creates a deterministic, visually regular layout. Flowers are placed on
 * centred concentric rings with equal angular steps; collision relaxation is
 * only a safety pass for mixed head sizes and therefore keeps the symmetry.
 */
export function generateEvenBouquetLayout(
  flowers: FlowerInstance[],
  bouquetRadius: number
): FlowerInstance[] {
  const count = flowers.length;

  if (!count) {
    return flowers;
  }

  const largestHead = Math.max(
    ...flowers.map((flower) => getFlowerBoundaryRadius(flower.kind))
  );
  const availableRadius = Math.max(
    0,
    bouquetRadius - largestHead - BOUQUET_INNER_PADDING
  );
  const placements: Array<[number, number]> = [];

  const addRing = (
    ringCount: number,
    radius: number,
    angleOffset = -Math.PI / 2
  ) => {
    for (let index = 0; index < ringCount; index += 1) {
      const angle = angleOffset + (index / ringCount) * Math.PI * 2;
      placements.push([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ]);
    }
  };

  if (count === 1) {
    placements.push([0, 0]);
  } else if (count <= 6) {
    addRing(count, availableRadius * 0.62);
  } else if (count <= 12) {
    placements.push([0, 0]);
    addRing(count - 1, availableRadius * 0.78);
  } else {
    const innerCount = count <= 16 ? 5 : count >= 20 ? 7 : 6;
    const outerCount = count - innerCount - 1;

    placements.push([0, 0]);
    addRing(innerCount, availableRadius * 0.48);
    addRing(
      outerCount,
      availableRadius * 0.92,
      -Math.PI / 2 + Math.PI / Math.max(outerCount, 1)
    );
  }

  const laidOut = flowers.map((flower, index) => {
    const [x, z] = placements[index] ?? [0, 0];

    return {
      ...flower,
      position: [x, flower.position[1], z] as Vector3,
    };
  });

  return resolveFlowerCollisions(laidOut, null, bouquetRadius);
}

export function alignStemsToAnchor(
  flowers: FlowerInstance[],
  bouquetRadius: number,
  verticalOffset = 0
): FlowerInstance[] {
  if (!flowers.length) {
    return flowers;
  }

  const wrappingHeight = 2.15 + bouquetRadius * 0.25;
  const stemAnchorY =
    WRAPPING_TOP_Y - wrappingHeight + 0.15 + verticalOffset;
  const downDirection = new ThreeVector3(0, -1, 0);

  return flowers.map((flower) => {
    const x = flower.position[0];
    const z = flower.position[2];
    const horizontalDistance = Math.hypot(x, z);
    const verticalDistance = Math.sqrt(
      Math.max(0.01, STEM_BOTTOM_OFFSET ** 2 - horizontalDistance ** 2)
    );
    const headY = stemAnchorY + verticalDistance;
    const positionY = headY - FLOWER_HEAD_OFFSET;
    const directionToAnchor = new ThreeVector3(
      -x,
      stemAnchorY - headY,
      -z
    ).normalize();
    const quaternion = new Quaternion().setFromUnitVectors(
      downDirection,
      directionToAnchor
    );
    const rotation = new Euler().setFromQuaternion(quaternion, "XYZ");

    return {
      ...flower,
      position: [x, positionY, z],
      rotation: [rotation.x, rotation.y, rotation.z],
    };
  });
}
