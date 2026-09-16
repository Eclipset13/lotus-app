"use client";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
export function CourierDeliveryActions({ deliveryId, status }: { deliveryId: string; status: string }) {
  const router = useRouter();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const next = status === "assigned" ? "on_the_way" : status === "on_the_way" ? "delivered" : null;
  async function changeStatus() {
    if (lock.current || !next) return;
    lock.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/api/admin/deliveries/${deliveryId}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", status: next }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Не удалось изменить статус");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось изменить статус"); }
    finally { lock.current = false; setPending(false); }
  }
  return <div className="mt-4">
    {next && <button type="button" disabled={pending} onClick={changeStatus} className="rounded-full bg-[#342622] px-5 py-3 text-sm text-white disabled:opacity-50">{next === "on_the_way" ? "В пути" : "Доставлена"}</button>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
