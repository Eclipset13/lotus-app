"use client";

import { useActionState, useState } from "react";
import {
  createWrapping, deleteWrapping, setWrappingActivity, updateWrapping,
  type WrappingActionState,
} from "@/app/admin/wrappings/actions";

export type AdminWrapping = {
  id: string; slug: string; name: string; subtitle: string; color: string;
  ribbon_color: string; sale_price: string; opacity: string; sort_order: number;
  is_active: boolean; has_been_active: boolean;
};
const initial: WrappingActionState = { error: "", message: "" };
const input = "mt-2 h-11 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 text-sm outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25";
const label = "text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]";

function Feedback({ state }: { state: WrappingActionState }) {
  if (!state.error && !state.message) return null;
  return <p role={state.error ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ${state.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{state.error || state.message}</p>;
}

function ColorField({ name, title, initialColor }: { name: string; title: string; initialColor: string }) {
  const [color, setColor] = useState(initialColor);
  return <label className={label}>{title}<span className="mt-2 flex items-center gap-2"><input name={name} type="color" required value={color} onChange={(event) => setColor(event.target.value)} className="h-11 w-16 rounded-lg border border-[#ead8d1] bg-white p-1" /><span className="h-8 flex-1 rounded-lg border border-white shadow" style={{ backgroundColor: color }} /></span></label>;
}

function Fields({ wrapping }: { wrapping?: AdminWrapping }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <label className={label}>Slug<input className={input} name="slug" required maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={wrapping?.slug} readOnly={Boolean(wrapping)} /></label>
    <label className={`${label} sm:col-span-1 lg:col-span-2`}>Название<input className={input} name="name" required maxLength={120} defaultValue={wrapping?.name} /></label>
    <label className={label}>Порядок<input className={input} name="sort_order" type="number" min="0" max="1000000" step="1" required defaultValue={wrapping?.sort_order ?? 0} /></label>
    <label className={`${label} sm:col-span-2`}>Подзаголовок<input className={input} name="subtitle" maxLength={180} defaultValue={wrapping?.subtitle} /></label>
    <label className={label}>Цена, сом<input className={input} name="sale_price" inputMode="decimal" required defaultValue={wrapping?.sale_price ?? "0.00"} /></label>
    <label className={label}>Прозрачность<input className={input} name="opacity" inputMode="decimal" required defaultValue={wrapping?.opacity ?? "0.500"} /></label>
    <ColorField name="color" title="Основной цвет" initialColor={wrapping?.color ?? "#f4cfc8"} />
    <ColorField name="ribbon_color" title="Цвет ленты" initialColor={wrapping?.ribbon_color ?? "#b85d70"} />
    <label className="flex items-center gap-3 self-end rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3 text-sm font-semibold"><input name="is_active" value="true" type="checkbox" defaultChecked={wrapping?.is_active ?? false} className="h-4 w-4 accent-[#b85d70]" />Активна</label>
  </div>;
}

function WrappingCard({ wrapping }: { wrapping: AdminWrapping }) {
  const [saveState, save, saving] = useActionState(updateWrapping.bind(null, wrapping.id), initial);
  const [activityState, activity, changing] = useActionState(setWrappingActivity.bind(null, wrapping.id), initial);
  const [deleteState, remove, deleting] = useActionState(deleteWrapping.bind(null, wrapping.id), initial);
  return <article className="rounded-[28px] border border-[#f0dfd9] bg-white p-5 shadow-sm">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-serif text-2xl">{wrapping.name}</h2><p className="text-sm text-[#806e68]">{wrapping.slug} · {wrapping.is_active ? "Активна" : "Отключена"}</p></div><div className="flex"><span className="h-10 w-10 rounded-l-full border border-white shadow" style={{ backgroundColor: wrapping.color }} /><span className="h-10 w-10 rounded-r-full border border-white shadow" style={{ backgroundColor: wrapping.ribbon_color }} /></div></div>
    <form action={save} className="space-y-4"><Fields wrapping={wrapping} /><Feedback state={saveState} /><button disabled={saving} className="min-h-11 rounded-xl bg-[#342622] px-5 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Сохраняем…" : "Сохранить"}</button></form>
    <div className="mt-5 flex flex-wrap gap-3 border-t border-[#f3e6e1] pt-5">
      <form action={activity} onSubmit={(event) => { if (wrapping.is_active && !window.confirm(`Отключить упаковку «${wrapping.name}»?`)) event.preventDefault(); }}><input type="hidden" name="is_active" value={String(!wrapping.is_active)} /><button disabled={changing} className="min-h-11 rounded-xl border border-[#ead8d1] px-4 text-sm font-semibold text-[#806e68]">{wrapping.is_active ? "Отключить" : "Включить"}</button></form>
      <form action={remove} onSubmit={(event) => { if (window.prompt(`Введите название упаковки для удаления: ${wrapping.name}`) !== wrapping.name) event.preventDefault(); }}><button disabled={deleting || wrapping.is_active} title={wrapping.is_active ? "Сначала отключите упаковку" : undefined} className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-45">Удалить</button></form>
    </div>
    <Feedback state={activityState.error ? activityState : deleteState.error ? deleteState : activityState.message ? activityState : deleteState} />
  </article>;
}

export function AdminWrappingManager({ wrappings }: { wrappings: AdminWrapping[] }) {
  const [state, submit, pending] = useActionState(createWrapping, initial);
  return <div className="mt-8 space-y-6">
    <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6"><h2 className="font-serif text-2xl">Новая упаковка</h2><p className="mt-2 text-sm text-[#806e68]">Создайте отключённой, проверьте оформление, затем включите.</p><form action={submit} className="mt-5 space-y-4"><Fields /><Feedback state={state} /><button disabled={pending} className="min-h-12 rounded-2xl bg-[#c97d72] px-6 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Создаём…" : "Создать упаковку"}</button></form></section>
    {wrappings.length ? <section className="grid gap-5 xl:grid-cols-2">{wrappings.map((item) => <WrappingCard key={item.id} wrapping={item} />)}</section> : <section className="rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-14 text-center text-[#806e68]">Упаковок пока нет.</section>}
  </div>;
}
