"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustInventory,
  updateConstructorKind,
  updateMinimumStock,
  type InventoryActionState,
} from "@/app/admin/inventory/actions";
import { AdminSelect } from "@/components/admin-filter-select";

const initialState: InventoryActionState = { error: "", message: "" };

export function AdminInventoryControls({
  flowerId,
  stockQuantity,
  minimumStock,
  constructorKind,
}: {
  flowerId: string;
  stockQuantity: number;
  minimumStock: number;
  constructorKind: string | null;
}) {
  const adjustmentAction = adjustInventory.bind(null, flowerId);
  const minimumAction = updateMinimumStock.bind(null, flowerId);
  const constructorKindAction = updateConstructorKind.bind(null, flowerId);
  const [adjustmentState, submitAdjustment, adjusting] = useActionState(
    adjustmentAction,
    initialState,
  );
  const [minimumState, submitMinimum, savingMinimum] = useActionState(
    minimumAction,
    initialState,
  );
  const [constructorKindState, submitConstructorKind, savingConstructorKind] =
    useActionState(constructorKindAction, initialState);
  const [operation, setOperation] = useState<"increase" | "decrease">("increase");
  const [quantity, setQuantity] = useState("1");
  const adjustmentSubmissionLocked = useRef(false);

  useEffect(() => {
    if (!adjusting) {
      adjustmentSubmissionLocked.current = false;
    }
  }, [adjusting, adjustmentState]);

  const displayedStock = adjustmentState.currentStock ?? stockQuantity;
  const resultingStock = useMemo(() => {
    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed <= 0) return displayedStock;
    return operation === "increase"
      ? displayedStock + parsed
      : displayedStock - parsed;
  }, [displayedStock, operation, quantity]);

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
        <h2 className="font-serif text-2xl">Корректировка остатка</h2>
        <p className="mt-2 text-sm leading-6 text-[#806e68]">
          Изменение будет записано отдельным складским движением.
        </p>

        <form
          action={submitAdjustment}
          className="mt-5 grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            if (adjustmentSubmissionLocked.current) {
              event.preventDefault();
              return;
            }
            if (
              !window.confirm(
                `Остаток изменится: ${displayedStock} → ${resultingStock}`,
              )
            ) {
              event.preventDefault();
              return;
            }
            adjustmentSubmissionLocked.current = true;
          }}
        >
          <input type="hidden" name="expected_stock" value={displayedStock} />
          <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
            Операция
            <AdminSelect
              className="mt-2"
              name="operation"
              value={operation}
              onChange={(event) =>
                setOperation(event as "increase" | "decrease")
              }
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

          {(adjustmentState.error || adjustmentState.message) && (
            <p
              role={adjustmentState.error ? "alert" : "status"}
              aria-live="polite"
              className={`rounded-2xl px-4 py-3 text-sm md:col-span-2 ${
                adjustmentState.error
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {adjustmentState.error || adjustmentState.message}
            </p>
          )}

          <button
            type="submit"
            disabled={adjusting || resultingStock < 0}
            className="min-h-12 rounded-2xl bg-[#342622] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3731] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
          >
            {adjusting ? "Сохраняем…" : "Подтвердить корректировку"}
          </button>
        </form>
      </section>

      <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
        <h2 className="font-serif text-2xl">Минимальный остаток</h2>
        <p className="mt-2 text-sm leading-6 text-[#806e68]">
          Используется для определения дефицита.
        </p>
        <form action={submitMinimum} className="mt-5">
          <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
            Минимальное количество
            <input
              name="min_stock_quantity"
              type="number"
              min="0"
              max="1000000"
              step="1"
              required
              defaultValue={minimumStock}
              className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
            />
          </label>

          {(minimumState.error || minimumState.message) && (
            <p
              role={minimumState.error ? "alert" : "status"}
              aria-live="polite"
              className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                minimumState.error
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {minimumState.error || minimumState.message}
            </p>
          )}

          <button
            type="submit"
            disabled={savingMinimum}
            className="mt-4 min-h-12 w-full rounded-2xl bg-[#c97d72] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingMinimum ? "Сохраняем…" : "Сохранить минимум"}
          </button>
        </form>
      </section>

      <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6 lg:col-span-2">
        <h2 className="font-serif text-2xl">Связь со старым конструктором</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#806e68]">
          Связь нужна для старых композиций и их перевода на складские позиции.
          Новым композициям она не нужна: они сохраняют ID конкретного цветка.
        </p>

        <form action={submitConstructorKind} className="mt-5 max-w-xl">
          <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
            Тип цветка в старом конструкторе
            <AdminSelect
              className="mt-2"
              name="constructor_kind"
              defaultValue={constructorKind ?? ""}
              ariaLabel="Связь со старым конструктором"
              options={[
                { value: "", label: "Не используется" },
                { value: "rose", label: "Роза" },
                { value: "peony", label: "Пион" },
                { value: "tulip", label: "Тюльпан" },
              ]}
            />
          </label>

          {(constructorKindState.error || constructorKindState.message) && (
            <p
              role={constructorKindState.error ? "alert" : "status"}
              aria-live="polite"
              className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
                constructorKindState.error
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
            >
              {constructorKindState.error || constructorKindState.message}
            </p>
          )}

          <button
            type="submit"
            disabled={savingConstructorKind}
            className="mt-4 min-h-12 rounded-2xl bg-[#342622] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3731] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingConstructorKind ? "Сохраняем…" : "Сохранить связь"}
          </button>
        </form>
      </section>
    </div>
  );
}
