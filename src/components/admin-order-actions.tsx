"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type AdminOrderActionsProps = {
    orderId: string;
    currentStatus: string;
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
        label: "Собирается",
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

export function AdminOrderActions({
    orderId,
    currentStatus,
}: AdminOrderActionsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState("");

    async function changeStatus(status: string) {
        if (
            status === "cancelled" &&
            !window.confirm("Вы уверены, что хотите отменить заказ?")
        ) {
            return;
        }

        setError("");

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
                throw new Error(
                    result.message || "Не удалось изменить статус"
                );
            }

            startTransition(() => {
                router.refresh();
            });
        } catch (statusError) {
            setError(
                statusError instanceof Error
                    ? statusError.message
                    : "Не удалось изменить статус"
            );
        }
    }

    return (
        <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                Изменить статус
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
                {statuses.map((status) => {
                    const isCurrent = currentStatus === status.value;

                    return (
                        <button
                            key={status.value}
                            type="button"
                            disabled={isPending || isCurrent}
                            onClick={() => changeStatus(status.value)}
                            className={`rounded-full border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${isCurrent
                                    ? "border-[#342622] bg-[#342622] text-white"
                                    : status.className
                                } ${isPending ? "opacity-60" : ""}`}
                        >
                            {isCurrent ? `✓ ${status.label}` : status.label}
                        </button>
                    );
                })}
            </div>

            {isPending && (
                <p className="mt-3 text-sm text-[#806e68]">
                    Обновляем статус…
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