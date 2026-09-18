"use client";

import { useActionState } from "react";
import { deleteProduct, type ProductActionState } from "@/app/admin/products/actions";

export function AdminProductDelete({ productId, productName, isActive }: { productId: string; productName: string; isActive: boolean }) {
  const [state, action, pending] = useActionState(deleteProduct.bind(null, productId), { error: "" } as ProductActionState);
  return <section className="mt-6 rounded-[28px] border border-red-200 bg-white p-6"><h2 className="font-serif text-2xl text-red-800">Удаление букета</h2><p className="mt-2 text-sm leading-6 text-[#806e68]">Удалить можно только скрытый букет, который никогда не использовался в заказах.</p>{isActive && <p className="mt-3 rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">Сначала скройте букет на странице ассортимента.</p>}<form action={action} className="mt-4" onSubmit={(event) => { if (window.prompt(`Введите название букета для удаления: ${productName}`) !== productName) event.preventDefault(); }}><button disabled={pending || isActive} className="min-h-12 rounded-2xl border border-red-300 px-5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45">{pending ? "Удаляем…" : "Удалить букет"}</button></form>{state.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}</section>;
}
