"use client";
import { useActionState } from "react";
import { changeOwnPassword } from "@/app/admin/password/actions";
export function AdminPasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, { error: "" });
  return <form action={action} className="mt-6 space-y-4">
    {[["currentPassword", "Текущий или временный пароль"], ["password", "Новый пароль"], ["confirmation", "Повторите новый пароль"]].map(([name, label]) =>
      <label key={name} className="block text-sm">{label}<input type="password" name={name} required minLength={name === "currentPassword" ? 1 : 12} maxLength={128}
        autoComplete={name === "currentPassword" ? "current-password" : "new-password"} className="mt-2 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 py-3" /></label>)}
    <p className="text-sm text-[#806e68]">12–128 символов. После сохранения войдите с новым паролем.</p>
    <button type="submit" disabled={pending} className="rounded-full bg-[#342622] px-6 py-3 text-white disabled:opacity-50">Сохранить пароль</button>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
  </form>;
}
