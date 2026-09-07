"use client";

import { useActionState } from "react";
import {
  toggleSupplierStatus,
  type SupplierActionState,
} from "@/app/admin/suppliers/actions";

const initialSupplierActionState: SupplierActionState = {
  error: "",
  message: "",
};

export function AdminSupplierStatusForm({
  supplierId,
  isActive,
}: {
  supplierId: string;
  isActive: boolean;
}) {
  const toggleAction = toggleSupplierStatus.bind(null, supplierId);
  const [state, formAction, pending] = useActionState(
    toggleAction,
    initialSupplierActionState,
  );

  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2">
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-xl border border-[#ead8d1] px-4 py-2.5 text-sm font-medium text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? "Сохраняем…"
          : isActive
            ? "Отключить"
            : "Включить"}
      </button>
      {state.error && (
        <span role="alert" className="max-w-44 text-xs text-red-700">
          {state.error}
        </span>
      )}
      {state.message && (
        <span role="status" className="max-w-44 text-xs text-green-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
