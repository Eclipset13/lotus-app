"use client";

import { useActionState } from "react";
import { deleteFlower, setFlowerActivity, type InventoryActionState } from "@/app/admin/inventory/actions";

const initialState: InventoryActionState = { error: "", message: "" };

export function AdminFlowerActivity({ flowerId, isActive }: { flowerId: string; isActive: boolean }) {
  const [state, submit, pending] = useActionState(setFlowerActivity.bind(null, flowerId), initialState);
  const [deleteState, remove, deleting] = useActionState(deleteFlower.bind(null, flowerId), initialState);
  return (
    <section className="rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <h2 className="font-serif text-2xl">Активность</h2>
      <p className="mt-2 text-sm leading-6 text-[#806e68]">
        Активный цветок доступен в каталоге и конструкторе по его идентификатору.
      </p>
      <form
        action={submit}
        className="mt-5"
        onSubmit={(event) => {
          if (isActive && !window.confirm("Отключить цветок? Он перестанет быть доступен для новых композиций.")) event.preventDefault();
        }}
      >
        <input type="hidden" name="is_active" value={isActive ? "false" : "true"} />
        {(state.error || state.message) && (
          <p role={state.error ? "alert" : "status"} className={`mb-4 rounded-2xl px-4 py-3 text-sm ${state.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
            {state.error || state.message}
          </p>
        )}
        <button type="submit" disabled={pending} className={`min-h-12 rounded-2xl px-6 py-3 text-sm font-semibold text-white disabled:opacity-60 ${isActive ? "bg-[#9d4255] hover:bg-[#843547]" : "bg-green-700 hover:bg-green-800"}`}>
          {pending ? "Сохраняем…" : isActive ? "Отключить цветок" : "Включить цветок"}
        </button>
      </form>

      <div className="mt-7 border-t border-[#f0dfd9] pt-6">
        <h3 className="font-serif text-xl text-[#8d3548]">Удаление</h3>
        <p className="mt-2 text-sm leading-6 text-[#806e68]">
          Удалить можно только новый цветок с нулевым остатком и без связей с букетами, заказами и складскими операциями.
        </p>
        <form
          action={remove}
          className="mt-4"
          onSubmit={(event) => {
            if (!window.confirm("Удалить цветок без возможности восстановления?")) event.preventDefault();
          }}
        >
          {deleteState.error && (
            <p role="alert" className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {deleteState.error}
            </p>
          )}
          <button type="submit" disabled={deleting} className="min-h-12 rounded-2xl bg-[#8d3548] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#72283a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8d3548] disabled:cursor-not-allowed disabled:opacity-60">
            {deleting ? "Удаляем…" : "Удалить цветок"}
          </button>
        </form>
      </div>
    </section>
  );
}
