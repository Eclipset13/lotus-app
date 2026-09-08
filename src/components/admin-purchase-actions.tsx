"use client";

import { useActionState } from "react";
import {
  cancelPurchase,
  postPurchase,
  type PurchaseActionState,
} from "@/app/admin/purchases/actions";

const initialState: PurchaseActionState = { error: "", message: "" };

export function AdminPurchaseActions({ purchaseId }: { purchaseId: string }) {
  const postAction = postPurchase.bind(null, purchaseId);
  const cancelAction = cancelPurchase.bind(null, purchaseId);
  const [postState, submitPost, posting] = useActionState(postAction, initialState);
  const [cancelState, submitCancel, cancelling] = useActionState(
    cancelAction,
    initialState,
  );

  return (
    <section className="mt-5 rounded-[24px] border border-[#f0dfd9] bg-white p-5">
      {(postState.error || cancelState.error) && (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {postState.error || cancelState.error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <form
          action={submitCancel}
          onSubmit={(event) => {
            if (!window.confirm("Отменить этот черновик? Вернуть его в работу будет нельзя.")) {
              event.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            disabled={posting || cancelling}
            className="min-h-12 rounded-2xl border border-red-200 px-6 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelling ? "Отменяем…" : "Отменить черновик"}
          </button>
        </form>
        <form
          action={submitPost}
          onSubmit={(event) => {
            if (!window.confirm("Провести поступление и увеличить складские остатки?")) {
              event.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            disabled={posting || cancelling}
            className="min-h-12 rounded-2xl bg-[#c97d72] px-7 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.22)] transition hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {posting ? "Проводим…" : "Провести поступление"}
          </button>
        </form>
      </div>
    </section>
  );
}
