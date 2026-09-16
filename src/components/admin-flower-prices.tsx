"use client";
import { useActionState } from "react";
import { updateFlowerPrices } from "@/app/admin/inventory/actions";
import { parsePrice } from "@/lib/money-input";
export function AdminFlowerPrices({ flowerId, purchasePrice, salePrice }: { flowerId: string; purchasePrice: string; salePrice: string }) {
  const [state, action, pending] = useActionState(async (previous: { error: string; message: string }, data: FormData) => {
    if (parsePrice(data.get("purchase_price")) === null || parsePrice(data.get("sale_price")) === null) {
      return { error: "Введите неотрицательные цены: до 10 цифр и не более двух знаков после запятой", message: "" };
    }
    return updateFlowerPrices(flowerId, previous, data);
  }, { error: "", message: "" });
  return <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
    <h2 className="font-serif text-2xl">Цены</h2>
    <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
      {[["purchase_price", "Закупочная цена", purchasePrice], ["sale_price", "Цена продажи", salePrice]].map(([name, label, value]) =>
        <label key={name} className="text-sm">{label}<input name={name} type="text" inputMode="decimal" defaultValue={value} required maxLength={13}
          className="mt-2 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3" /></label>)}
      <button type="submit" disabled={pending} className="justify-self-start rounded-full bg-[#342622] px-6 py-3 text-sm text-white disabled:opacity-50">{pending ? "Сохраняем…" : "Сохранить цены"}</button>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-green-700 sm:col-span-2">{state.message}</p>}
    </form>
  </section>;
}
