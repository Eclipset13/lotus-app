import type { FlowerInstance } from "@/lib/bouquet-layout";

export function groupFlowerInstances(flowers: readonly FlowerInstance[]) {
  const groups = new Map<string, { key: string; name: string; instances: FlowerInstance[] }>();
  for (const flower of flowers) {
    // Unlinked legacy instances stay separate until the user chooses a stock item.
    const key = flower.flowerId ? `stock:${flower.flowerId}` : `instance:${flower.id}`;
    const group = groups.get(key) ?? { key,
      name: flower.snapshot?.name ?? `Цветок ${flower.kind ?? flower.flowerId ?? "без связи"}`, instances: [] };
    group.instances.push(flower);
    groups.set(key, group);
  }
  return [...groups.values()];
}
