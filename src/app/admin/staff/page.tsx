import Link from "next/link";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { STAFF_ROLES, ROLE_LABELS, type StaffRole } from "@/lib/permissions";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminStaffForm } from "@/components/admin-staff-form";
import { BrandLogo } from "@/components/brand-logo";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

type Employee = {
  id: string;
  name: string;
  phone: string;
  roles: string[];
  status: string;
  has_password: boolean;
  last_login_at: Date | null;
  active_sessions: number;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function staffUrl(filters: { q: string; role: string; status: string }, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === "status" && value === "all")) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/staff?${query}` : "/admin/staff";
}

function formatDate(value: Date | null) {
  if (!value) return "Ещё не входил";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dushanbe",
  }).format(value);
}

export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("staff.manage");
  const raw = await searchParams;
  const search = one(raw.q).trim().slice(0, 120);
  const roleInput = one(raw.role);
  const role = STAFF_ROLES.includes(roleInput as StaffRole) ? roleInput : "";
  const statusInput = one(raw.status);
  const status = ["active", "blocked"].includes(statusInput) ? statusInput : "all";
  const page = Math.min(100_000, Math.max(1, Number.parseInt(one(raw.page), 10) || 1));

  const values: unknown[] = [STAFF_ROLES];
  const conditions = ["cardinality(staff_role.roles) > 0"];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (search) {
    const term = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const p = parameter(term);
    conditions.push(`(employee.name ILIKE ${p} ESCAPE '\\' OR employee.phone ILIKE ${p} ESCAPE '\\')`);
  }
  if (role) conditions.push(`${parameter(role)}::text = ANY(staff_role.roles)`);
  if (status !== "all") conditions.push(`employee.status = ${parameter(status)}`);
  values.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);

  const result = await db.query<Employee>(`
    SELECT employee.id::text,
           employee.name,
           employee.phone,
           employee.status,
           employee.last_login_at,
           staff_role.roles,
           (credential.user_id IS NOT NULL) AS has_password,
           COALESCE(session_count.active_sessions, 0)::int AS active_sessions
    FROM public.users AS employee
    CROSS JOIN LATERAL (
      SELECT array_agg(role.code ORDER BY role.code) AS roles
      FROM public.user_roles AS user_role
      JOIN public.roles AS role ON role.id = user_role.role_id
      WHERE user_role.user_id = employee.id
        AND role.code = ANY($1::varchar[])
    ) AS staff_role
    LEFT JOIN public.staff_credentials AS credential ON credential.user_id = employee.id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS active_sessions
      FROM public.staff_sessions AS staff_session
      WHERE staff_session.user_id = employee.id
        AND staff_session.expires_at > NOW()
    ) AS session_count ON true
    WHERE ${conditions.join(" AND ")}
    ORDER BY lower(employee.name), employee.id
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  const hasNext = result.rows.length > PAGE_SIZE;
  const employees = result.rows.slice(0, PAGE_SIZE);
  const filters = { q: search, role, status };

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Панель управления</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Сотрудники</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">Персональный доступ, роли и активные сеансы команды Lotus.</p>
          <AdminNavigation />
        </header>

        <section className="mt-8 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
          <h2 className="font-serif text-2xl">Новый сотрудник</h2>
          <AdminStaffForm />
        </section>

        <form method="get" className="mt-6 grid gap-4 rounded-[28px] border border-[#f0dfd9] bg-white p-5 md:grid-cols-3">
          <label className="text-sm">Поиск
            <input name="q" defaultValue={search} placeholder="Имя или телефон" className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3" />
          </label>
          <label className="text-sm">Роль
            <select name="role" defaultValue={role} className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3">
              <option value="">Все роли</option>
              {STAFF_ROLES.map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="text-sm">Доступ
            <select name="status" defaultValue={status} className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3">
              <option value="all">Все</option>
              <option value="active">Активные</option>
              <option value="blocked">Отключённые</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3 md:col-span-3">
            <button className="rounded-full bg-[#342622] px-5 py-3 text-sm font-semibold text-white">Применить</button>
            <Link href="/admin/staff" className="rounded-full border border-[#ead8d1] px-5 py-3 text-sm">Сбросить</Link>
          </div>
        </form>

        {employees.length === 0 ? (
          <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white px-6 py-14 text-center">
            <h2 className="font-serif text-2xl">Сотрудники не найдены</h2>
            <p className="mt-2 text-sm text-[#806e68]">Измените поиск или фильтры.</p>
          </section>
        ) : employees.map((employee) => (
          <section key={employee.id} className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl">{employee.name}</h2>
                <p className="mt-2 text-sm text-[#806e68]">{employee.phone}</p>
              </div>
              <span className={`rounded-full px-4 py-2 text-sm ${employee.status === "active" ? "bg-green-50 text-green-700" : "bg-[#fbe5e8] text-[#9d4255]"}`}>
                {employee.status === "active" ? "Доступ активен" : "Доступ отключён"}
              </span>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-[#806e68]">Роли</dt><dd className="mt-1 font-medium">{employee.roles.map((item) => ROLE_LABELS[item as StaffRole] || item).join(", ")}</dd></div>
              <div><dt className="text-[#806e68]">Персональный пароль</dt><dd className="mt-1 font-medium">{employee.has_password ? "Создан" : "Не создан"}</dd></div>
              <div><dt className="text-[#806e68]">Последний вход</dt><dd className="mt-1 font-medium">{formatDate(employee.last_login_at)}</dd></div>
              <div><dt className="text-[#806e68]">Активные сеансы</dt><dd className="mt-1 font-medium">{employee.active_sessions}</dd></div>
            </dl>
            <AdminStaffForm employee={employee} />
          </section>
        ))}

        <nav className="mt-6 flex items-center justify-between" aria-label="Пагинация сотрудников">
          {page > 1 ? <Link href={staffUrl(filters, page - 1)} className="rounded-full border border-[#ead8d1] bg-white px-5 py-3 text-sm">← Назад</Link> : <span />}
          <span className="text-sm text-[#806e68]">Страница {page}</span>
          {hasNext ? <Link href={staffUrl(filters, page + 1)} className="rounded-full border border-[#ead8d1] bg-white px-5 py-3 text-sm">Далее →</Link> : <span />}
        </nav>
      </div>
    </main>
  );
}
