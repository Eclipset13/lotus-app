"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { adjustInventory, type InventoryActionState } from "@/app/admin/inventory/actions";
import { AdminSelect } from "@/components/admin-filter-select";

const initialState: InventoryActionState = { error: "", message: "" };

export function AdminInventoryControls({ flowerId, stockQuantity }: { flowerId: string; stockQuantity: number }) {
  const [state, submit, pending] = useActionState(adjustInventory.bind(null, flowerId), initialState);
  const [operation, setOperation] = useState<"increase" | "decrease">("increase");
  const [quantity, setQuantity] = useState("1");
  const submissionLocked = useRef(false);

  useEffect(() => {
    if (!pending) submissionLocked.current = false;
  }, [pending, state]);

  const displayedStock = state.currentStock ?? stockQuantity;
  const resultingStock = useMemo(() => {
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed <= 0) return displayedStock;
    return operation === "increase" ? displayedStock + parsed : displayedStock - parsed;
  }, [displayedStock, operation, quantity]);

  return (
    <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <h2 className="font-serif text-2xl">Корректировка остатка</h2>
      <p className="mt-2 text-sm leading-6 text-[#806e68]">
        Изменение будет записано отдельным складским движением.
      </p>
      <form
        action={submit}
        className="mt-5 grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          if (submissionLocked.current) {
            event.preventDefault();
            return;
          }
          if (!window.confirm(`Остаток изменится: ${displayedStock} → ${resultingStock}`)) {
            event.preventDefault();
            return;
          }
          submissionLocked.current = true;
        }}
      >
        <input type="hidden" name="expected_stock" value={displayedStock} />
        <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
          Операция
          <AdminSelect
            className="mt-2"
            name="operation"
            value={operation}
            onChange={(value) => setOperation(value as "increase" | "decrease")}
            ariaLabel="Выбрать операцию"
            options={[
              { value: "increase", label: "Увеличить" },
              { value: "decrease", label: "Уменьшить" },
            ]}
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
          Количество
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a] md:col-span-2">
          Причина
          <input
            name="reason"
            type="text"
            required
            maxLength={500}
            list="inventory-reasons"
            placeholder="Например: результат инвентаризации"
            className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
          />
          <datalist id="inventory-reasons">
            <option value="Результат инвентаризации" />
            <option value="Повреждение" />
            <option value="Списание" />
            <option value="Исправление ошибки" />
            <option value="Другое" />
          </datalist>
        </label>
        <div className="rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3 text-sm md:col-span-2">
          Остаток изменится: <strong>{displayedStock} → {resultingStock}</strong>
        </div>
        {(state.error || state.message) && (
          <p
            role={state.error ? "alert" : "status"}
            aria-live="polite"
            className={`rounded-2xl px-4 py-3 text-sm md:col-span-2 ${state.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
          >
            {state.error || state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || resultingStock < 0}
          className="min-h-12 rounded-2xl bg-[#342622] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3731] disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
        >
          {pending ? "Сохраняем…" : "Подтвердить корректировку"}
        </button>
      </form>
    </section>
  );
}
