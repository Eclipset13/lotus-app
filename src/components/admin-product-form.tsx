"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { ProductActionState } from "@/app/admin/products/actions";
import { AdminSelect } from "@/components/admin-filter-select";
import { AdminProductImageField } from "@/components/admin-product-image-field";

export type ProductFlowerOption = {
  id: string;
  name: string;
  unit: string;
  stockQuantity: number;
  isActive: boolean;
};

export type ProductCompositionItem = {
  flowerId: string;
  quantity: number;
};

type ProductFormValues = {
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  isActive: boolean;
  composition: ProductCompositionItem[];
};

const initialActionState: ProductActionState = { error: "" };

export function AdminProductForm({
  action,
  flowers,
  initialValues,
  submitLabel,
}: {
  action: (
    state: ProductActionState,
    formData: FormData,
  ) => Promise<ProductActionState>;
  flowers: ProductFlowerOption[];
  initialValues: ProductFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialActionState,
  );
  const [composition, setComposition] = useState(initialValues.composition);
  const totalFlowers = useMemo(
    () => composition.reduce((total, item) => total + item.quantity, 0),
    [composition],
  );

  function addFlower() {
    const used = new Set(composition.map((item) => item.flowerId));
    const nextFlower = flowers.find((flower) => !used.has(flower.id));
    if (!nextFlower) return;
    setComposition((items) => [
      ...items,
      { flowerId: nextFlower.id, quantity: 1 },
    ]);
  }

  return (
    <form
      action={formAction}
      className="mt-8 overflow-hidden rounded-[32px] border border-[#f0dfd9] bg-white shadow-[0_20px_60px_rgba(74,48,41,0.06)]"
    >
      <input type="hidden" name="composition" value={JSON.stringify(composition)} />

      <div className="grid gap-8 p-6 md:p-8 lg:grid-cols-2">
        <section className="space-y-6">
          <div>
            <label htmlFor="name" className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">Название букета</label>
            <input id="name" name="name" type="text" required maxLength={255} defaultValue={initialValues.name} placeholder="Например: Нежный рассвет" className="h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25" />
          </div>
          <div>
            <label htmlFor="description" className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">Описание</label>
            <textarea id="description" name="description" rows={6} maxLength={5000} defaultValue={initialValues.description} placeholder="Расскажите о букете" className="w-full resize-none rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3.5 text-sm leading-6 outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25" />
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <label htmlFor="price" className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">Цена</label>
            <div className="relative">
              <input id="price" name="price" type="number" min="0" step="0.01" required defaultValue={initialValues.price} className="h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 pr-24 text-sm outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#99817a]">сом</span>
            </div>
          </div>
          <AdminProductImageField currentUrl={initialValues.imageUrl || null} />
          <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-[#ead8d1] bg-[#fffaf8] p-4">
            <div>
              <span className="block text-sm font-semibold">Показывать в каталоге</span>
              <span className="mt-1 block text-xs text-[#99817a]">Для активного букета состав обязателен</span>
            </div>
            <input type="checkbox" name="is_active" defaultChecked={initialValues.isActive} className="peer sr-only" />
            <span className="relative h-7 w-12 shrink-0 rounded-full bg-[#dccbc6] transition peer-checked:bg-[#c97d72] after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-5" />
          </label>
        </section>
      </div>

      <section className="border-t border-[#f3e6e1] px-6 py-7 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl">Состав букета</h2>
            <p className="mt-1 text-sm text-[#806e68]">Всего цветов: <strong>{totalFlowers}</strong></p>
          </div>
          <button type="button" onClick={addFlower} disabled={flowers.length === 0 || composition.length >= flowers.length} className="min-h-11 rounded-2xl border border-[#dcb8ae] bg-[#fff8f5] px-5 text-sm font-semibold text-[#9a5f56] transition hover:bg-[#fff0ec] disabled:cursor-not-allowed disabled:opacity-50">
            + Добавить цветок
          </button>
        </div>

        {composition.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-orange-200 bg-orange-50 px-5 py-6 text-sm text-orange-800">Состав не настроен</div>
        ) : (
          <div className="mt-5 space-y-3">
            {composition.map((item, index) => {
              const selectedFlower = flowers.find((flower) => flower.id === item.flowerId);
              const usedByOtherRows = new Set(composition.filter((_, itemIndex) => itemIndex !== index).map((entry) => entry.flowerId));
              return (
                <div key={`${item.flowerId}-${index}`} className="grid gap-3 rounded-[22px] border border-[#f0dfd9] bg-[#fffaf8] p-4 md:grid-cols-[1fr_150px_auto] md:items-end">
                  <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
                    Цветок
                    <AdminSelect
                      className="mt-2"
                      name={`composition_flower_${index}`}
                      value={item.flowerId}
                      onChange={(flowerId) => setComposition((items) => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, flowerId } : entry))}
                      ariaLabel={`Выбрать цветок в строке ${index + 1}`}
                      options={flowers.map((flower) => ({
                        value: flower.id,
                        label: `${flower.name} · остаток ${flower.stockQuantity} ${flower.unit}${flower.isActive ? "" : " · неактивен"}`,
                        disabled: usedByOtherRows.has(flower.id),
                      }))}
                    />
                  </label>
                  <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
                    Количество
                    <input type="number" min="1" max="10000" step="1" required value={item.quantity} onChange={(event) => {
                      const quantity = Number(event.target.value);
                      setComposition((items) => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, quantity: Number.isFinite(quantity) ? quantity : 0 } : entry));
                    }} className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-white px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25" />
                  </label>
                  <button type="button" aria-label={`Удалить ${selectedFlower?.name ?? "цветок"} из состава`} onClick={() => setComposition((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="min-h-12 rounded-2xl border border-red-200 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50">Удалить</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {state.error && <p role="alert" aria-live="polite" className="mx-6 mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 md:mx-8">{state.error}</p>}

      <footer className="flex flex-col-reverse gap-3 border-t border-[#f3e6e1] bg-[#fffaf8] px-6 py-5 sm:flex-row sm:justify-end md:px-8">
        <Link href="/admin/products" className="flex h-12 items-center justify-center rounded-2xl border border-[#ead8d1] px-6 text-sm font-semibold text-[#806e68] transition hover:bg-white">Отмена</Link>
        <button type="submit" disabled={pending} className="h-12 rounded-2xl bg-[#c97d72] px-7 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:bg-[#b96e64] disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Сохраняем…" : submitLabel}</button>
      </footer>
    </form>
  );
}
