"use client";

import { useActionState } from "react";
import {
  createCategory,
  deleteCategory,
  setCategoryActivity,
  updateCategory,
  type InventoryActionState,
} from "@/app/admin/inventory/actions";

type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  flower_count: number;
};

const initialState: InventoryActionState = { error: "", message: "" };
const inputClass = "mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25";
const labelClass = "text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]";

function Result({ state }: { state: InventoryActionState }) {
  if (!state.error && !state.message) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`rounded-2xl px-4 py-3 text-sm ${state.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
      {state.error || state.message}
    </p>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const [editState, save, saving] = useActionState(updateCategory.bind(null, category.id), initialState);
  const [activityState, changeActivity, changing] = useActionState(setCategoryActivity.bind(null, category.id), initialState);
  const [deleteState, remove, deleting] = useActionState(deleteCategory.bind(null, category.id), initialState);

  return (
    <article className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">{category.name}</h2>
          <p className="mt-1 text-sm text-[#806e68]">Цветов: {category.flower_count} · {category.is_active ? "активна" : "отключена"}</p>
        </div>
      </div>
      <form action={save} className="mt-5 grid gap-4 md:grid-cols-3">
        <label className={labelClass}>Название<input className={inputClass} name="name" required maxLength={100} defaultValue={category.name} /></label>
        <label className={labelClass}>Slug<input className={inputClass} name="slug" required maxLength={120} defaultValue={category.slug} /></label>
        <label className={labelClass}>Порядок<input className={inputClass} name="sort_order" type="number" min="0" max="1000000" step="1" required defaultValue={category.sort_order} /></label>
        <div className="md:col-span-3"><Result state={editState} /></div>
        <button type="submit" disabled={saving} className="min-h-11 rounded-2xl bg-[#342622] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 md:col-span-3">
          {saving ? "Сохраняем…" : "Сохранить категорию"}
        </button>
      </form>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <form
          action={changeActivity}
          onSubmit={(event) => {
            if (category.is_active && !window.confirm("Отключить категорию?")) event.preventDefault();
          }}
        >
          <input type="hidden" name="is_active" value={category.is_active ? "false" : "true"} />
          <button type="submit" disabled={changing} className="min-h-11 w-full rounded-2xl border border-[#d9b7af] px-5 py-2.5 text-sm font-semibold text-[#8b544c] disabled:opacity-60">
            {changing ? "Сохраняем…" : category.is_active ? "Отключить" : "Включить"}
          </button>
        </form>
        <form
          action={remove}
          onSubmit={(event) => {
            if (!window.confirm("Удалить неиспользуемую категорию?")) event.preventDefault();
          }}
        >
          <button type="submit" disabled={deleting || category.flower_count > 0} title={category.flower_count > 0 ? "Категория используется цветами" : undefined} className="min-h-11 w-full rounded-2xl border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-45">
            {deleting ? "Удаляем…" : "Удалить"}
          </button>
        </form>
      </div>
      <div className="mt-4 space-y-3"><Result state={activityState} /><Result state={deleteState} /></div>
    </article>
  );
}

export function AdminCategoryManager({ categories }: { categories: Category[] }) {
  const [state, submit, pending] = useActionState(createCategory, initialState);
  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
        <h2 className="font-serif text-2xl">Добавить категорию</h2>
        <form action={submit} className="mt-5 grid gap-4 md:grid-cols-3">
          <label className={labelClass}>Название<input className={inputClass} name="name" required maxLength={100} /></label>
          <label className={labelClass}>Slug<input className={inputClass} name="slug" required maxLength={120} /></label>
          <label className={labelClass}>Порядок<input className={inputClass} name="sort_order" type="number" min="0" max="1000000" step="1" required defaultValue="0" /></label>
          <label className="flex items-center gap-3 text-sm font-semibold text-[#5d4741] md:col-span-3">
            <input type="checkbox" name="is_active" value="true" defaultChecked className="h-4 w-4 accent-[#b85d70]" /> Активная категория
          </label>
          <div className="md:col-span-3"><Result state={state} /></div>
          <button type="submit" disabled={pending} className="min-h-12 rounded-2xl bg-[#342622] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60 md:col-span-3">
            {pending ? "Создаём…" : "Добавить категорию"}
          </button>
        </form>
      </section>
      {categories.map((category) => <CategoryCard key={category.id} category={category} />)}
    </div>
  );
}
