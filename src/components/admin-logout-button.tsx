"use client";

import { FormEvent, useState } from "react";

export function AdminLogoutButton({ className = "" }: { className?: string }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function logout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");

    try {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error("Не удалось выйти");
      window.location.replace("/admin/login");
    } catch {
      setError("Не удалось выйти. Обновите страницу и повторите попытку.");
      setLoggingOut(false);
    }
  }

  return (
    <form onSubmit={logout} className="inline-flex">
      <button
        type="submit"
        disabled={loggingOut}
        aria-busy={loggingOut}
        className={`rounded-2xl px-5 py-3 text-sm text-[#806e68] disabled:cursor-wait disabled:opacity-60 ${className}`}
      >
        {loggingOut ? "Выходим…" : "Выйти"}
      </button>
      {error && <p role="alert" className="ml-3 self-center text-sm text-red-700">{error}</p>}
    </form>
  );
}
