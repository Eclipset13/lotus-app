import Link from "next/link";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminSelect } from "@/components/admin-filter-select";
import { AdminSupplierStatusForm } from "@/components/admin-supplier-status-form";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  tax_id: string | null;
  bank_details: string | null;
  contract_details: string | null;
};

type SupplierCounts = {
  total: number;
  active: number;
  inactive: number;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
}

export default async function AdminSuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("suppliers.manage");

  const params = await searchParams;
  const searchQuery = (params.q ?? "").trim().slice(0, 120);
  const status =
    params.status === "active" || params.status === "inactive"
      ? params.status
      : "all";
  const values: Array<string | boolean> = [];
  const conditions: string[] = [];

  if (searchQuery) {
    values.push(`%${searchQuery}%`);
    const index = values.length;
    conditions.push(`(
      name ILIKE $${index}
      OR COALESCE(contact_name, '') ILIKE $${index}
      OR COALESCE(phone, '') ILIKE $${index}
      OR COALESCE(email, '') ILIKE $${index}
      OR COALESCE(tax_id, '') ILIKE $${index}
    )`);
  }

  if (status !== "all") {
    values.push(status === "active");
    conditions.push(`is_active = $${values.length}`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [suppliersResult, countsResult] = await Promise.all([
    db.query<Supplier>(
      `
        SELECT id::text,
               name,
               contact_name,
               phone,
               email,
               address,
               notes,
               is_active,
               created_at,
               tax_id,
               bank_details,
               contract_details
        FROM public.suppliers
        ${whereClause}
        ORDER BY is_active DESC, name ASC, created_at DESC
      `,
      values,
    ),
    db.query<SupplierCounts>(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_active)::int AS active,
             count(*) FILTER (WHERE NOT is_active)::int AS inactive
      FROM public.suppliers
    `),
  ]);

  const suppliers = suppliersResult.rows;
  const counts = countsResult.rows[0] ?? { total: 0, active: 0, inactive: 0 };

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-serif text-4xl md:text-5xl">Поставщики</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">
                Контакты, реквизиты и договоры партнёров Lotus.
              </p>
            </div>
            <Link
              href="/admin/suppliers/new"
              className="w-fit rounded-2xl bg-[#c97d72] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:-translate-y-0.5 hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              + Добавить поставщика
            </Link>
          </div>
          <AdminNavigation />
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Всего поставщиков", counts.total, "text-[#342622]"],
            ["Активные", counts.active, "text-green-700"],
            ["Неактивные", counts.inactive, "text-[#b07b72]"],
          ].map(([label, value, color]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-[#f0dfd9] bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                {label}
              </p>
              <strong className={`mt-4 block font-serif text-4xl ${color}`}>
                {value}
              </strong>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[24px] border border-[#f0dfd9] bg-white p-5">
          <form method="GET" className="grid gap-4 md:grid-cols-[1fr_220px_auto_auto]">
            <label className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
              Поиск
              <input
                type="search"
                name="q"
                defaultValue={searchQuery}
                maxLength={120}
                placeholder="Название, контакт, телефон, email или ИНН"
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
              Статус
              <AdminSelect
                className="mt-2"
                name="status"
                defaultValue={status}
                ariaLabel="Выбрать статус поставщика"
                options={[
                  { value: "all", label: "Все" },
                  { value: "active", label: "Активные" },
                  { value: "inactive", label: "Неактивные" },
                ]}
              />
            </label>
            <button
              type="submit"
              className="h-12 self-end rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white transition hover:bg-[#4b3731] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              Найти
            </button>
            <Link
              href="/admin/suppliers"
              className="flex h-12 items-center justify-center self-end rounded-2xl border border-[#ead8d1] px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              Сбросить
            </Link>
          </form>
        </section>

        {suppliers.length === 0 ? (
          <section className="mt-8 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden="true">🏢</span>
            <h2 className="mt-4 font-serif text-2xl">
              {counts.total === 0 ? "Поставщиков пока нет" : "Ничего не найдено"}
            </h2>
            <p className="mt-2 text-sm text-[#806e68]">
              {counts.total === 0
                ? "Добавьте первого поставщика Lotus."
                : "Измените поисковый запрос или фильтр статуса."}
            </p>
          </section>
        ) : (
          <section className="mt-8 grid gap-5 lg:grid-cols-2">
            {suppliers.map((supplier) => (
              <article
                key={supplier.id}
                className="rounded-[28px] border border-[#f0dfd9] bg-white p-6 shadow-[0_12px_35px_rgba(74,48,41,0.04)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif text-2xl">{supplier.name}</h2>
                    <p className="mt-1 text-sm text-[#806e68]">
                      {supplier.contact_name || "Контактное лицо не указано"}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${supplier.is_active ? "bg-green-50 text-green-700" : "bg-[#f5ece9] text-[#9a746c]"}`}>
                    {supplier.is_active ? "Активен" : "Отключён"}
                  </span>
                </div>

                <dl className="mt-5 grid gap-x-5 gap-y-4 border-y border-[#f3e6e1] py-5 sm:grid-cols-2">
                  {[
                    ["Телефон", supplier.phone || "Не указан"],
                    ["Email", supplier.email || "Не указан"],
                    ["ИНН", supplier.tax_id || "Не указан"],
                    ["Дата добавления", formatDate(supplier.created_at)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#a18d87]">{label}</dt>
                      <dd className="mt-1 break-words text-sm text-[#4d3934]">{value}</dd>
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#a18d87]">Адрес</dt>
                    <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-[#4d3934]">{supplier.address || "Не указан"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#a18d87]">Договор</dt>
                    <dd className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-6 text-[#4d3934]">{supplier.contract_details || "Информация не указана"}</dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-end">
                  <Link
                    href={`/admin/suppliers/${supplier.id}/edit`}
                    className="flex min-h-11 items-center justify-center rounded-xl bg-[#342622] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4b3731] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
                  >
                    Редактировать
                  </Link>
                  <AdminSupplierStatusForm
                    supplierId={supplier.id}
                    isActive={supplier.is_active}
                  />
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
