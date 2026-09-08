"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import type { PurchaseActionState } from "@/app/admin/purchases/actions";

export type PurchaseSupplierOption = {
  id: string;
  name: string;
  isActive: boolean;
};

export type PurchaseFlowerOption = {
  id: string;
  name: string;
  stockQuantity: number;
  purchasePrice: number;
  isActive: boolean;
};

export type PurchaseFormItem = {
  flowerId: string;
  quantity: string;
  unitCost: string;
};

export type PurchaseFormValues = {
  supplierId: string;
  documentNumber: string;
  receivedAt: string;
  note: string;
  items: PurchaseFormItem[];
};

type PurchaseFormAction = (
  state: PurchaseActionState,
  formData: FormData,
) => Promise<PurchaseActionState>;

type EditableRow = PurchaseFormItem & { key: number };

const initialActionState: PurchaseActionState = { error: "", message: "" };
const inputClass =
  "mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25";
const labelClass =
  "block text-xs font-bold uppercase tracking-[0.15em] text-[#99817a]";

function createInitialRows(items?: PurchaseFormItem[]): EditableRow[] {
  const source = items?.length
    ? items
    : [{ flowerId: "", quantity: "1", unitCost: "" }];
  return source.map((item, index) => ({ ...item, key: index + 1 }));
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function AdminPurchaseForm({
  action,
  suppliers,
  flowers,
  values,
  submitLabel,
}: {
  action: PurchaseFormAction;
  suppliers: PurchaseSupplierOption[];
  flowers: PurchaseFlowerOption[];
  values?: PurchaseFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [rows, setRows] = useState<EditableRow[]>(() =>
    createInitialRows(values?.items),
  );
  const nextKey = useRef(rows.length + 1);

  const total = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const quantity = Number(row.quantity);
        const unitCost = Number(row.unitCost);
        return sum +
          (Number.isFinite(quantity) && Number.isFinite(unitCost)
            ? quantity * unitCost
            : 0);
      }, 0),
    [rows],
  );

  const serializedItems = JSON.stringify(
    rows.map(({ flowerId, quantity, unitCost }) => ({
      flowerId,
      quantity,
      unitCost,
    })),
  );

  function updateRow(key: number, patch: Partial<PurchaseFormItem>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function selectFlower(row: EditableRow, flowerId: string) {
    const flower = flowers.find((option) => option.id === flowerId);
    updateRow(row.key, {
      flowerId,
      unitCost:
        row.unitCost || !flower ? row.unitCost : flower.purchasePrice.toFixed(2),
    });
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { key: nextKey.current++, flowerId: "", quantity: "1", unitCost: "" },
    ]);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <form
      action={formAction}
      className="mt-8 overflow-hidden rounded-[32px] border border-[#f0dfd9] bg-white shadow-[0_20px_60px_rgba(74,48,41,0.06)]"
    >
      <input type="hidden" name="items" value={serializedItems} />

      <div className="grid gap-6 p-6 md:grid-cols-2 md:p-8">
        <label className={labelClass}>
          Поставщик
          <select
            name="supplier_id"
            required
            defaultValue={values?.supplierId ?? ""}
            className={inputClass}
          >
            <option value="">Выберите поставщика</option>
            {suppliers.map((supplier) => (
              <option
                key={supplier.id}
                value={supplier.id}
                disabled={!supplier.isActive}
              >
                {supplier.name}{supplier.isActive ? "" : " — отключён"}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Номер документа
          <input
            name="document_number"
            type="text"
            maxLength={64}
            defaultValue={values?.documentNumber}
            placeholder="Например: НК-104"
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Дата поступления
          <input
            name="received_at"
            type="date"
            defaultValue={values?.receivedAt}
            className={inputClass}
          />
        </label>

        <label className={labelClass}>
          Примечание
          <textarea
            name="note"
            rows={3}
            maxLength={4_000}
            defaultValue={values?.note}
            placeholder="Условия поставки или комментарий"
            className="mt-2 w-full resize-y rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3 text-sm outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
          />
        </label>
      </div>

      <section className="border-t border-[#f3e6e1] px-6 py-7 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl">Цветы</h2>
            <p className="mt-1 text-sm text-[#806e68]">
              Остатки изменятся только после проведения документа.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= flowers.length}
            className="min-h-11 rounded-xl border border-[#dfb9af] px-4 py-2.5 text-sm font-semibold text-[#9a5f56] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Добавить цветок
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((row, index) => {
            const selectedFlower = flowers.find(
              (flower) => flower.id === row.flowerId,
            );
            const selectedElsewhere = new Set(
              rows
                .filter((other) => other.key !== row.key)
                .map((other) => other.flowerId),
            );
            const lineTotal = Number(row.quantity) * Number(row.unitCost);

            return (
              <div
                key={row.key}
                className="grid gap-4 rounded-[22px] border border-[#f0dfd9] bg-[#fffaf8] p-4 lg:grid-cols-[minmax(220px,1fr)_140px_170px_150px_48px] lg:items-end"
              >
                <label className={labelClass}>
                  Цветок {index + 1}
                  <select
                    required
                    value={row.flowerId}
                    onChange={(event) => selectFlower(row, event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Выберите цветок</option>
                    {flowers.map((flower) => (
                      <option
                        key={flower.id}
                        value={flower.id}
                        disabled={
                          !flower.isActive || selectedElsewhere.has(flower.id)
                        }
                      >
                        {flower.name}{flower.isActive ? "" : " — отключён"}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1.5 block text-xs font-normal normal-case tracking-normal text-[#99817a]">
                    Остаток: {selectedFlower?.stockQuantity ?? "—"}
                  </span>
                </label>

                <label className={labelClass}>
                  Количество
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={row.quantity}
                    onChange={(event) =>
                      updateRow(row.key, { quantity: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>

                <label className={labelClass}>
                  Цена закупки
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={row.unitCost}
                    onChange={(event) =>
                      updateRow(row.key, { unitCost: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>

                <div className="rounded-2xl border border-[#ead8d1] bg-white px-4 py-3">
                  <span className="block text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">
                    Сумма
                  </span>
                  <strong className="mt-1 block text-sm">
                    {money(Number.isFinite(lineTotal) ? lineTotal : 0)} ₽
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  aria-label={`Удалить позицию ${index + 1}`}
                  title="Удалить позицию"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-red-200 text-xl text-red-600 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        {rows.length === 0 && (
          <div className="mt-5 rounded-[22px] border border-dashed border-[#e5cbc3] px-5 py-10 text-center text-sm text-[#806e68]">
            Добавьте хотя бы один цветок.
          </div>
        )}
      </section>

      <div className="border-t border-[#f3e6e1] bg-[#fffaf8] px-6 py-5 md:px-8">
        {(state.error || state.message) && (
          <p
            role={state.error ? "alert" : "status"}
            aria-live="polite"
            className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
              state.error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {state.error || state.message}
          </p>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[#806e68]">
            Итого: <strong className="text-xl text-[#342622]">{money(total)} ₽</strong>
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <Link
              href="/admin/purchases"
              className="flex h-12 items-center justify-center rounded-2xl border border-[#ead8d1] px-6 text-sm font-semibold text-[#806e68] transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              К списку
            </Link>
            <button
              type="submit"
              disabled={pending || rows.length === 0}
              className="h-12 rounded-2xl bg-[#342622] px-7 text-sm font-semibold text-white transition hover:bg-[#4b3731] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Сохраняем…" : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
