import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { STAFF_ROLES, ROLE_LABELS, type StaffRole } from "@/lib/permissions";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminStaffForm } from "@/components/admin-staff-form";
import { BrandLogo } from "@/components/brand-logo";
export const dynamic = "force-dynamic";
export default async function StaffPage() {
  await requirePermission("staff.manage");
  const employees = await db.query<{ id: string; name: string; phone: string; roles: string[]; status: string; last_login_at: Date | null }>(`
    SELECT u.id::text, u.name, u.phone, u.status, u.last_login_at, array_agg(r.code ORDER BY r.code) AS roles
    FROM public.users u JOIN public.user_roles ur ON ur.user_id=u.id JOIN public.roles r ON r.id=ur.role_id
    WHERE r.code = ANY($1::varchar[]) GROUP BY u.id ORDER BY u.name`, [STAFF_ROLES]);
  return <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10"><div className="mx-auto max-w-7xl">
    <BrandLogo /><h1 className="mt-6 font-serif text-4xl">Сотрудники</h1><AdminNavigation />
    <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6"><h2 className="font-serif text-2xl">Новый сотрудник</h2><AdminStaffForm /></section>
    {employees.rows.map((employee) => <section key={employee.id} className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <h2 className="font-serif text-2xl">{employee.name}</h2>
      <p className="mt-2 text-sm">{employee.phone} · {employee.roles.map((r) => ROLE_LABELS[r as StaffRole]).join(", ")} · {employee.status === "active" ? "Активен" : "Доступ отключён"}</p>
      <p className="mt-2 text-xs text-[#806e68]">Последний вход: {employee.last_login_at ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dushanbe" }).format(employee.last_login_at) : "ещё не входил"}</p>
      <AdminStaffForm employee={employee} />
    </section>)}
  </div></main>;
}
