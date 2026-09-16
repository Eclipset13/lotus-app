"use client";

import { useActionState } from "react";
import {
  createFlower,
  updateFlowerDetails,
  type InventoryActionState,
} from "@/app/admin/inventory/actions";

type CategoryOption = { id: string; name: string; is_active: boolean };

type FlowerDefaults = {
  id: string;
  name: string;
  slug: string;
  category_id: string | null;
  description: string | null;
  color: string | null;
  unit: string;
  image_url: string | null;
  min_stock_quantity: number;
};

const initialState: InventoryActionState = { error: "", message: "" };
const inputClass = "mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25";
const labelClass = "text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]";

export function AdminFlowerDetailsForm({
  categories,
  flower,
}: {
  categories: CategoryOption[];
  flower?: FlowerDefaults;
}) {
  const action = flower ? updateFlowerDetails.bind(null, flower.id) : createFlower;
  const [state, submit, pending] = useActionState(action, initialState);

  return (
    <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <h2 className="font-serif text-2xl">{flower ? "Основные данные" : "Новый цветок"}</h2>
      <p className="mt-2 text-sm leading-6 text-[#806e68]">
        Физический остаток изменяется только поступлением или корректировкой склада.
      </p>
      <form action={submit} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Название
          <input className={inputClass} name="name" required maxLength={140} defaultValue={flower?.name} />
        </label>
        <label className={labelClass}>
          Slug
          <input className={inputClass} name="slug" required maxLength={160} defaultValue={flower?.slug} placeholder="white-eustoma" />
        </label>
        <label className={labelClass}>
          Категория
          <select className={inputClass} name="category_id" defaultValue={flower?.category_id ?? ""}>
            <option value="">Без категории</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id} disabled={!category.is_active && category.id !== flower?.category_id}>
                {category.name}{category.is_active ? "" : " (отключена)"}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Цвет
          <input className={inputClass} name="color" maxLength={80} defaultValue={flower?.color ?? ""} />
        </label>
        <label className={labelClass}>
          Единица измерения
          <input className={inputClass} name="unit" required maxLength={30} defaultValue={flower?.unit ?? "шт"} />
        </label>
        <label className={labelClass}>
          Минимальный остаток
          <input className={inputClass} name="min_stock_quantity" type="number" min="0" max="1000000" step="1" required defaultValue={flower?.min_stock_quantity ?? 0} />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          URL фотографии
          <input className={inputClass} name="image_url" type="url" maxLength={2000} defaultValue={flower?.image_url ?? ""} placeholder="https://…" />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          Описание
          <textarea className="mt-2 min-h-32 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25" name="description" maxLength={5000} defaultValue={flower?.description ?? ""} />
        </label>
        {!flower && (
          <label className="flex items-center gap-3 text-sm font-semibold text-[#5d4741] md:col-span-2">
            <input type="checkbox" name="is_active" value="true" defaultChecked className="h-4 w-4 accent-[#b85d70]" />
            Сразу включить цветок
          </label>
        )}
        {state.error && (
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">{state.error}</p>
        )}
        <button type="submit" disabled={pending} className="min-h-12 rounded-2xl bg-[#342622] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3731] disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2">
          {pending ? "Сохраняем…" : flower ? "Сохранить основные данные" : "Создать цветок"}
        </button>
      </form>
    </section>
  );
}
