import Link from "next/link";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminSelect } from "@/components/admin-filter-select";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PurchaseListRow = {
  id: string;
  document_number: string | null;
  status: "draft" | "posted" | "cancelled";
  supplier_name: string;
  received_at: Date | null;
  created_at: Date;
  item_count: number;
  total_amount: string;
};

type PurchaseCounts = {
  total: number;
  drafts: number;
  posted: number;
};

const statusLabels = {
  draft: "Черновик",
  posted: "Проведено",
  cancelled: "Отменено",
};

const statusClasses = {
  draft: "bg-amber-50 text-amber-700",
  posted: "bg-green-50 text-green-700",
  cancelled: "bg-[#f5ece9] text-[#9a746c]",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
}

function money(value: string) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export default async function AdminPurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("purchases.manage");

  const params = await searchParams;
  const searchQuery = (params.q ?? "").trim().slice(0, 120);
  const allowedStatuses = new Set(["draft", "posted", "cancelled"]);
  const status = allowedStatuses.has(params.status ?? "")
    ? params.status!
    : "all";
  const values: string[] = [];
  const conditions: string[] = [];

  if (searchQuery) {
    values.push(`%${searchQuery}%`);
    conditions.push(`(
      COALESCE(p.document_number, '') ILIKE $${values.length}
      OR s.name ILIKE $${values.length}
    )`);
  }
  if (status !== "all") {
    values.push(status);
    conditions.push(`p.status = $${values.length}`);
  }
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [rowsResult, countsResult] = await Promise.all([
    db.query<PurchaseListRow>(
      `
        SELECT p.id::text,
               p.document_number,
               p.status,
               s.name AS supplier_name,
               p.received_at,
               p.created_at,
               count(pi.id)::int AS item_count,
               COALESCE(sum(pi.quantity * pi.unit_cost), 0)::text AS total_amount
        FROM public.purchases p
        JOIN public.suppliers s ON s.id = p.supplier_id
        LEFT JOIN public.purchase_items pi ON pi.purchase_id = p.id
        ${whereClause}
        GROUP BY p.id, s.name
        ORDER BY COALESCE(p.received_at, p.created_at) DESC, p.id DESC
      `,
      values,
    ),
    db.query<PurchaseCounts>(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'draft')::int AS drafts,
             count(*) FILTER (WHERE status = 'posted')::int AS posted
      FROM public.purchases
    `),
  ]);

  const counts = countsResult.rows[0] ?? { total: 0, drafts: 0, posted: 0 };
  const purchases = rowsResult.rows;

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
              <h1 className="font-serif text-4xl md:text-5xl">Поступления</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">
                Черновики и проведённые поставки цветов на склад Lotus.
              </p>
            </div>
            <Link
              href="/admin/purchases/new"
              className="w-fit rounded-2xl bg-[#c97d72] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(201,125,114,0.25)] transition hover:-translate-y-0.5 hover:bg-[#b96e64] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              + Новое поступление
            </Link>
          </div>
          <AdminNavigation />
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Всего документов", counts.total],
            ["Черновики", counts.drafts],
            ["Проведено", counts.posted],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-[#f0dfd9] bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                {label}
              </p>
              <strong className="mt-4 block font-serif text-4xl">{value}</strong>
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
                maxLength={120}
                defaultValue={searchQuery}
                placeholder="Номер документа или поставщик"
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
              Статус
              <AdminSelect
                className="mt-2"
                name="status"
                defaultValue={status}
                ariaLabel="Выбрать статус поступления"
                options={[
                  { value: "all", label: "Все" },
                  { value: "draft", label: "Черновики" },
                  { value: "posted", label: "Проведённые" },
                  { value: "cancelled", label: "Отменённые" },
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
              href="/admin/purchases"
              className="flex h-12 items-center justify-center self-end rounded-2xl border border-[#ead8d1] px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b85d70]"
            >
              Сбросить
            </Link>
          </form>
        </section>

        {purchases.length === 0 ? (
          <section className="mt-8 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden="true">🚚</span>
            <h2 className="mt-4 font-serif text-2xl">
              {counts.total === 0 ? "Поступлений пока нет" : "Ничего не найдено"}
            </h2>
            <p className="mt-2 text-sm text-[#806e68]">
              {counts.total === 0
                ? "Создайте первый черновик поступления."
                : "Измените запрос или фильтр статуса."}
            </p>
          </section>
        ) : (
          <section className="mt-8 overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[#fff4f1] text-xs uppercase tracking-[0.13em] text-[#99817a]">
                  <tr>
                    <th className="px-5 py-4">Документ</th>
                    <th className="px-5 py-4">Поставщик</th>
                    <th className="px-5 py-4">Дата</th>
                    <th className="px-5 py-4">Статус</th>
                    <th className="px-5 py-4">Позиций</th>
                    <th className="px-5 py-4">Сумма</th>
                    <th className="px-5 py-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3e6e1]">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-[#fffdfc]">
                      <td className="px-5 py-4 font-semibold">
                        {purchase.document_number || `№${purchase.id}`}
                      </td>
                      <td className="px-5 py-4">{purchase.supplier_name}</td>
                      <td className="px-5 py-4 text-[#806e68]">
                        {formatDate(purchase.received_at ?? purchase.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusClasses[purchase.status]}`}>
                          {statusLabels[purchase.status]}
                        </span>
                      </td>
                      <td className="px-5 py-4">{purchase.item_count}</td>
                      <td className="px-5 py-4 font-semibold">
                        {money(purchase.total_amount)} сом
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/admin/purchases/${purchase.id}`}
                          className="inline-flex min-h-11 items-center rounded-xl bg-[#342622] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4b3731]"
                        >
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
