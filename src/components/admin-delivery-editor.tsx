"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TRANSITIONS,
  type DeliveryStatus,
} from "@/lib/delivery";

type AdminDeliveryEditorProps = {
  deliveryId: string;
  status: DeliveryStatus;
  courierName: string;
  scheduledAt: string;
  courierCost: string;
  internalNote: string;
};

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 text-sm outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25";

const statusButtonClasses: Record<DeliveryStatus, string> = {
  planned: "border-[#ead8d1] bg-white text-[#806e68]",
  assigned: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  on_the_way:
    "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100",
  delivered:
    "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
  failed: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  cancelled: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
};

async function patchDelivery(deliveryId: string, payload: object) {
  const response = await fetch(
    `/api/admin/deliveries/${encodeURIComponent(deliveryId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = (await response.json()) as {
    success?: boolean;
    message?: string;
  };
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Не удалось сохранить доставку");
  }
  return result.message || "Доставка сохранена";
}

export function AdminDeliveryEditor({
  deliveryId,
  status,
  courierName,
  scheduledAt,
  courierCost,
  internalNote,
}: AdminDeliveryEditorProps) {
  const router = useRouter();
  const submissionLocked = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function runRequest(payload: object) {
    if (submissionLocked.current) return;
    submissionLocked.current = true;
    setPending(true);
    setMessage("");
    setError("");
    try {
      setMessage(await patchDelivery(deliveryId, payload));
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сохранить доставку",
      );
    } finally {
      submissionLocked.current = false;
      setPending(false);
    }
  }

  function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runRequest({
      action: "details",
      courierName: formData.get("courier_name"),
      scheduledAt: formData.get("scheduled_at"),
      courierCost: formData.get("courier_cost"),
      internalNote: formData.get("internal_note"),
    });
  }

  function changeStatus(nextStatus: DeliveryStatus) {
    if (
      ["cancelled", "failed"].includes(nextStatus) &&
      !window.confirm(
        nextStatus === "cancelled"
          ? "Отменить доставку?"
          : "Отметить доставку как не выполненную?",
      )
    ) {
      return;
    }
    void runRequest({ action: "status", status: nextStatus });
  }

  const availableStatuses = DELIVERY_STATUS_TRANSITIONS[status];

  return (
    <div className="mt-5 border-t border-[#f0dfd9] pt-5">
      <form onSubmit={saveDetails} className="grid gap-4 lg:grid-cols-3">
        <label className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">
          Курьер
          <input
            name="courier_name"
            type="text"
            maxLength={120}
            defaultValue={courierName}
            placeholder="Имя курьера"
            className={inputClass}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">
          Плановое время
          <input
            name="scheduled_at"
            type="datetime-local"
            maxLength={19}
            defaultValue={scheduledAt}
            className={inputClass}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">
          Стоимость доставки
          <input
            name="courier_cost"
            type="text"
            inputMode="decimal"
            required
            maxLength={16}
            defaultValue={courierCost}
            className={inputClass}
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a] lg:col-span-3">
          Внутреннее примечание
          <textarea
            name="internal_note"
            rows={3}
            maxLength={4_000}
            defaultValue={internalNote}
            placeholder="Информация для менеджеров и курьера"
            className="mt-2 w-full resize-y rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-[#d89b91] focus:bg-white focus:ring-4 focus:ring-[#f4cbc4]/25"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3 lg:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl bg-[#342622] px-5 text-sm font-semibold text-white transition hover:bg-[#4b3731] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Сохраняем…" : "Сохранить доставку"}
          </button>
          <span className="text-xs text-[#99817a]">
            Для назначения сначала сохраните имя курьера.
          </span>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">
          Изменить статус
        </span>
        {availableStatuses.map((nextStatus) => (
          <button
            key={nextStatus}
            type="button"
            disabled={pending}
            onClick={() => changeStatus(nextStatus)}
            className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${statusButtonClasses[nextStatus]}`}
          >
            {DELIVERY_STATUS_LABELS[nextStatus]}
          </button>
        ))}
        {availableStatuses.length === 0 && (
          <span className="text-sm text-[#806e68]">
            Дальнейшие переходы недоступны
          </span>
        )}
      </div>

      <div aria-live="polite" className="mt-3 min-h-5 text-sm">
        {message && <p className="text-green-700">{message}</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </div>
  );
}
