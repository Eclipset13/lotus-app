"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Не удалось войти");
      }

      window.location.assign("/admin");
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Не удалось войти"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#fff7f4] px-5">
      <section className="w-full max-w-md rounded-[36px] border border-[#f0dfd9] bg-white p-8 shadow-xl shadow-[#6b4030]/5 md:p-10">
        <BrandLogo className="mx-auto" />

        <p className="mt-8 text-center text-xs font-bold uppercase tracking-[0.2em] text-[#b85d70]">
          Панель управления
        </p>

        <h1 className="mt-3 text-center font-serif text-4xl text-[#342622]">
          Вход
        </h1>

        <p className="mt-3 text-center text-sm leading-6 text-[#806e68]">
          Введите пароль владельца магазина
        </p>

        <form onSubmit={login} className="mt-8">
          <label className="text-sm text-[#342622]">
            Пароль

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-2xl border border-[#ead8d2] bg-[#fffaf8] px-4 py-4 outline-none transition focus:border-[#b85d70] focus:ring-2 focus:ring-[#f7d9df]"
            />
          </label>

          {error && (
            <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-full bg-[#342622] px-6 py-4 text-white transition hover:bg-[#b85d70] disabled:opacity-60"
          >
            {loading ? "Входим…" : "Войти в админ-панель"}
          </button>
        </form>

        <Link
          href="/"
          className="mt-6 block text-center text-sm text-[#806e68] hover:text-[#b85d70]"
        >
          ← Вернуться в магазин
        </Link>
      </section>
    </main>
  );
}
