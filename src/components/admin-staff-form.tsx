"use client";
import { useActionState, useRef } from "react";
import { saveStaff } from "@/app/admin/staff/actions";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/permissions";
const input = "mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3 text-sm";
export function AdminStaffForm({ employee }: { employee?: { id: string; roles: string[]; status: string } }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (previous: { error: string; message: string }, data: FormData) => {
    const result = await saveStaff(previous, data);
    // Do not keep a submitted password in the DOM, including after an error.
    const password = form.current?.elements.namedItem("password") as HTMLInputElement | null;
    if (password) password.value = "";
    return result;
  }, { error: "", message: "" });
  return <form ref={form} action={action} className="mt-4 space-y-4">
    {employee && <input type="hidden" name="userId" value={employee.id} />}
    {!employee && <div className="grid gap-4 sm:grid-cols-2">
      <label>Имя<input name="name" required maxLength={120} className={input} autoComplete="off" /></label>
      <label>Телефон<input name="phone" type="tel" required maxLength={30} className={input} autoComplete="off" /></label>
    </div>}
    <fieldset disabled={pending}><legend className="text-sm font-semibold">Роли</legend>
      <div className="mt-2 flex flex-wrap gap-4">{STAFF_ROLES.map((role) => <label key={role} className="text-sm">
        <input type="checkbox" name="roles" value={role} defaultChecked={employee?.roles.includes(role)} className="mr-2 accent-[#b85d70]" />{ROLE_LABELS[role]}
      </label>)}</div>
    </fieldset>
    <label className="block text-sm">Временный пароль (12–128 символов)
      <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required={!employee} className={input} />
    </label>
    <p className="text-xs text-[#806e68]">При следующем входе сотрудник должен сменить временный пароль.</p>
    <div className="flex flex-wrap gap-2">
      {(employee ? [ ["roles", "Сохранить роли"], ["password_reset", "Сбросить пароль"],
        [employee.status === "active" ? "disable" : "enable", employee.status === "active" ? "Отключить доступ" : "Включить доступ"],
        ["sessions_revoke", "Отозвать сессии"] ] : [["create", "Создать сотрудника"]]).map(([value, label]) =>
        <button key={value} type="submit" name="action" value={value} disabled={pending}
          onClick={(event) => { if (["disable", "password_reset", "sessions_revoke"].includes(value) && !window.confirm(`${label}? Активные сессии будут отозваны.`)) event.preventDefault(); }}
          className="rounded-full border border-[#ead8d1] bg-[#342622] px-4 py-2 text-sm text-white disabled:opacity-50">{label}</button>)}
    </div>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    {state.message && <p role="status" className="text-sm text-green-700">{state.message}</p>}
  </form>;
}
