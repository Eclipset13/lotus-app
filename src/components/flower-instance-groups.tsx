"use client";
import { useState, type ReactNode } from "react";
import type { FlowerInstance } from "@/lib/bouquet-layout";
import { groupFlowerInstances } from "@/lib/flower-groups";

export function FlowerInstanceGroups({ flowers, selectedId, onSelect, renderUnlinked }: {
  flowers: FlowerInstance[]; selectedId: string | null; onSelect: (id: string) => void;
  renderUnlinked?: (flower: FlowerInstance) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  return groupFlowerInstances(flowers).map((group) => (
    <div key={group.key} className="rounded-xl border border-[#ead8d1] p-2" data-flower-group={group.key}>
      <button type="button" aria-expanded={expanded.has(group.key)}
        className={`w-full rounded-lg p-1 text-left ${group.instances.some((f) => f.id === selectedId) ? "bg-[#fff1ed] text-[#9d4255]" : ""}`}
        onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>
        {group.name} × {group.instances.length}
        <span aria-hidden="true" className="float-right">{expanded.has(group.key) ? "−" : "+"}</span>
      </button>
      {expanded.has(group.key) && <div className="mt-2 flex flex-wrap gap-1.5">
        {group.instances.map((flower, index) => (
          <div key={flower.id}>
            <button type="button" onClick={() => onSelect(flower.id)} aria-pressed={selectedId === flower.id}
              aria-label={`${group.name}, экземпляр ${index + 1}`}
              className={`min-h-9 min-w-9 rounded-lg border px-2 ${selectedId === flower.id ? "border-[#c97d72] bg-[#c97d72] text-white" : "border-[#ead8d1] bg-white"}`}>
              {index + 1}
            </button>
            {renderUnlinked?.(flower)}
          </div>
        ))}
      </div>}
    </div>
  ));
}
