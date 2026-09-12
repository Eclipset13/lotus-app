"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type AdminOrderActionsProps = {
    orderId: string;
    orderNumber: string;
    currentStatus: string;
    fulfillmentType: string;
    deliveryStatus: string | null;
    courierName: string | null;
};

const statuses = [
    {
        value: "confirmed",
        label: "Подтвердить",
        className:
            "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    },
    {
        value: "preparing",
        label: "Начать сборку",
        className:
            "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    },
    {
        value: "ready",
        label: "Готов",
        className:
            "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100",
    },
    {
        value: "delivering",
        label: "Доставляется",
        className:
            "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100",
    },
    {
        value: "completed",
        label: "Выполнен",
        className:
            "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
    },
    {
        value: "cancelled",
        label: "Отменить",
        className:
            "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    },
];

const allowedTransitions: Record<string, string[]> = {
    new: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["ready", "cancelled"],
    ready: ["delivering", "completed", "cancelled"],
    delivering: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
};

export function AdminOrderActions({
    orderId,
    orderNumber,
    currentStatus,
    fulfillmentType,
    deliveryStatus,
    courierName,
}: AdminOrderActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const submissionLocked = useRef(false);

    async function changeStatus(status: string) {
        if (submissionLocked.current) return;
        if (status === "cancelled") {
            const stockWasConsumed = ["preparing", "ready", "delivering"].includes(currentStatus);
            const confirmation = stockWasConsumed
                ? "Цветы уже списаны и не будут возвращены автоматически. Отменить заказ?"
                : "Вы уверены, что хотите отменить заказ?";
            if (!window.confirm(confirmation)) return;
        }

        setError("");
        setNotice("");
        submissionLocked.current = true;
        setIsSubmitting(true);

        try {
            const response = await fetch(
                `/api/admin/orders/${encodeURIComponent(orderId)}/status`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ status }),
                }
            );

            const contentType = response.headers.get("content-type") || "";

            if (!contentType.includes("application/json")) {
                const responseText = await response.text();

                console.error("API вернул не JSON:", {
                    status: response.status,
                    url: response.url,
                    responseText,
                });

                throw new Error(
                    response.status === 404
                        ? "API изменения статуса не найден. Проверь расположение route.ts"
                        : `Ошибка сервера: ${response.status}`
                );
            }

            const result = await response.json();

            if (!response.ok) {
                const shortages = Array.isArray(result.shortages)
                    ? result.shortages
                        .map((item: { name?: string; missing?: number }) =>
                            item.name && Number.isFinite(item.missing)
                                ? `${item.name}: ${item.missing} шт.`
                                : "",
                        )
                        .filter(Boolean)
                        .join(", ")
                    : "";
                throw new Error(
                    `${result.message || "Не удалось изменить статус"}${shortages ? `. Не хватает: ${shortages}` : ""}`
                );
            }

            if (result.warning) setNotice(String(result.warning));

            startTransition(() => {
                router.refresh();
            });
        } catch (statusError) {
            setError(
                statusError instanceof Error
                    ? statusError.message
                    : "Не удалось изменить статус"
            );
        } finally {
            submissionLocked.current = false;
            setIsSubmitting(false);
        }
    }

    const visibleTransitions = (allowedTransitions[currentStatus] ?? []).filter(
        (nextStatus) => {
            if (fulfillmentType !== "delivery") return true;
            if (currentStatus === "ready" && nextStatus === "completed") {
                return false;
            }
            if (currentStatus === "ready" && nextStatus === "delivering") {
                return deliveryStatus === "assigned" && Boolean(courierName?.trim());
            }
            if (currentStatus === "delivering" && nextStatus === "completed") {
                return deliveryStatus === "on_the_way";
            }
            return true;
        },
    );
    const showDeliveryManagement =
        fulfillmentType === "delivery" &&
        ["ready", "delivering"].includes(currentStatus);

    return (
        <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                Изменить статус
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                {statuses
                  .filter((status) => visibleTransitions.includes(status.value))
                  .map((status) => {
                    return (
                        <button
                            key={status.value}
                            type="button"
                            disabled={isPending || isSubmitting}
                            onClick={() => changeStatus(status.value)}
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${status.className} ${isPending || isSubmitting ? "opacity-60" : ""}`}
                        >
                            {status.label}
                        </button>
                    );
                })}
                {showDeliveryManagement && (
                    <Link
                        href={`/admin/deliveries?q=${encodeURIComponent(orderNumber)}`}
                        className="rounded-full border border-[#d7b6ad] bg-white px-4 py-2 text-sm font-semibold text-[#9f5f56] transition hover:bg-[#fff4f1]"
                    >
                        Управлять доставкой
                    </Link>
                )}
                {visibleTransitions.length === 0 && !showDeliveryManagement && (
                    <p className="text-sm text-[#806e68]">
                        Для этого статуса дальнейшие переходы недоступны.
                    </p>
                )}
            </div>

            {(isPending || isSubmitting) && (
                <p className="mt-3 text-sm text-[#806e68]">
                    Обновляем статус…
                </p>
            )}

            {error && (
                <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </p>
            )}

            {notice && (
                <p role="status" className="mt-3 rounded-xl bg-orange-50 px-4 py-3 text-sm text-orange-800">
                    {notice}
                </p>
            )}
        </div>
    );
}
