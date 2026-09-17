"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Financials = {
  subtotal: string;
  deliveryCost: string;
  totalAmount: string;
  paymentAmount: string | null;
};

type Props = {
  orderId: string;
  orderStatus: string;
  fulfillmentType: string;
  paymentStatus: string | null;
  canManage: boolean;
  subtotal: string;
  deliveryCost: string;
  totalAmount: string;
  paymentAmount: string | null;
};

function formatMoney(value: string) {
  return `${Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} сом`;
}

function readonlyReason(props: Props) {
  if (props.fulfillmentType === "pickup") return null;
  if (props.orderStatus === "cancelled") {
    return "Стоимость доставки отменённого заказа недоступна для редактирования.";
  }
  if (props.orderStatus === "completed") {
    return "Стоимость доставки выполненного заказа недоступна для редактирования.";
  }
  if (props.paymentStatus === "paid") {
    return "Заказ уже оплачен. Финансовые значения доступны только для чтения.";
  }
  if (props.paymentStatus === "refunded") {
    return "Оплата возвращена. Финансовые значения доступны только для чтения.";
  }
  if (props.paymentStatus && props.paymentStatus !== "pending") {
    return "Стоимость доставки можно менять только при ожидающей оплате.";
  }
  if (!props.canManage) {
    return "Недостаточно прав для изменения стоимости доставки.";
  }
  return null;
}

export function AdminDeliveryFeeEditor(props: Props) {
  const router = useRouter();
  const [financials, setFinancials] = useState<Financials>({
    subtotal: props.subtotal,
    deliveryCost: props.deliveryCost,
    totalAmount: props.totalAmount,
    paymentAmount: props.paymentAmount,
  });
  const [deliveryFee, setDeliveryFee] = useState(props.deliveryCost);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const reason = readonlyReason(props);
  const canEdit = props.fulfillmentType === "delivery" && reason === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(props.orderId)}/delivery-fee`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliveryFee }),
        },
      );
      const data = (await response.json()) as {
        message?: string;
        financials?: Financials;
      };
      if (!response.ok || !data.financials) {
        throw new Error(data.message || "Не удалось сохранить стоимость доставки");
      }

      setFinancials(data.financials);
      setDeliveryFee(data.financials.deliveryCost);
      setMessage(data.message || "Стоимость доставки сохранена");
      router.refresh();
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить стоимость доставки",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-[#ead7d1] bg-white p-4">
      <div className="space-y-1 text-sm text-[#594943]">
        <p className="flex justify-between gap-4">
          <span>Товары:</span>
          <strong>{formatMoney(financials.subtotal)}</strong>
        </p>
        <p className="flex justify-between gap-4">
          <span>Доставка:</span>
          <strong>
            {props.fulfillmentType === "pickup"
              ? `Самовывоз, ${formatMoney("0")}`
              : formatMoney(financials.deliveryCost)}
          </strong>
        </p>
        <p className="flex justify-between gap-4 border-t border-[#f0dfd9] pt-2 text-base text-[#342622]">
          <span>Итого:</span>
          <strong>{formatMoney(financials.totalAmount)}</strong>
        </p>
        {financials.paymentAmount !== null && (
          <p className="flex justify-between gap-4 text-[#806e68]">
            <span>Сумма оплаты:</span>
            <strong>{formatMoney(financials.paymentAmount)}</strong>
          </p>
        )}
      </div>

      {canEdit && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-[#594943]">
            Стоимость доставки, сом
            <input
              value={deliveryFee}
              onChange={(event) => setDeliveryFee(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              disabled={loading}
              aria-describedby={`delivery-fee-message-${props.orderId}`}
              className="mt-2 w-full rounded-xl border border-[#dfc8c1] bg-[#fffaf8] px-4 py-3 outline-none transition focus:border-[#b85d70] disabled:opacity-60"
              placeholder="Например, 25 или 25,50"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#9d4255] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#863648] disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Сохраняем…" : "Сохранить стоимость доставки"}
          </button>
        </form>
      )}

      {(reason || message) && (
        <p
          id={`delivery-fee-message-${props.orderId}`}
          role={isError ? "alert" : undefined}
          className={`mt-3 text-xs leading-5 ${isError ? "text-[#a33f52]" : "text-[#806e68]"}`}
        >
          {message || reason}
        </p>
      )}
    </div>
  );
}
