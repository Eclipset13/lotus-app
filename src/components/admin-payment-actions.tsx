"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AdminPaymentActionsProps = {
  orderId: string;
  orderStatus: string;
  currentStatus: string;
};

export function AdminPaymentActions({
  orderId,
  orderStatus,
  currentStatus,
}: AdminPaymentActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  async function changePaymentStatus(status: "pending" | "paid" | "refunded") {
    setError("");

    if (
      status === "refunded" &&
      !window.confirm("Подтвердить возврат оплаты? Это действие нельзя отменить.")
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(orderId)}/payment`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }
      );

      const contentType =
        response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        throw new Error(
          `Ошибка сервера: ${response.status}`
        );
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Не удалось обновить оплату"
        );
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Не удалось обновить оплату"
      );
    }
  }

  const isPaid = currentStatus === "paid";
  const isRefunded = currentStatus === "refunded";
  const isCancelled = orderStatus === "cancelled";

  return (
    <div className="xl:text-right">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
        Управление оплатой
      </p>

      {isRefunded ? (
        <p className="mt-3 text-sm font-semibold text-[#806e68]">
          Оплата возвращена
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            disabled={isPending || isPaid || isCancelled}
            onClick={() => changePaymentStatus("paid")}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${
              isPaid
                ? "border-green-700 bg-green-700 text-white"
                : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {isPaid ? "✓ Оплачен" : "Отметить оплаченным"}
          </button>

          <button
            type="button"
            disabled={isPending || !isPaid || isCancelled}
            onClick={() => changePaymentStatus("pending")}
            className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Вернуть в ожидание
          </button>

          {isPaid && (
            <button
              type="button"
              disabled={isPending || isCancelled}
              onClick={() => changePaymentStatus("refunded")}
              className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Отметить возврат
            </button>
          )}
        </div>
      )}

      {isCancelled && (
        <p className="mt-3 text-sm text-[#806e68]">
          Оплата отменённого заказа не изменяется
        </p>
      )}

      {isPending && (
        <p className="mt-3 text-sm text-[#806e68]">
          Обновляем оплату…
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}