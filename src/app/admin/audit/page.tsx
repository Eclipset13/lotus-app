import Link from "next/link";
import { AdminNavigation } from "@/components/admin-navigation";
import { AuditDetails } from "@/components/audit-details";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, auditEntityType } from "@/lib/audit-display";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const entityTypes = ["order", "payment", "delivery", "flower", "category", "bouquet", "inventory", "purchase", "staff"];

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_phone: string | null;
  action: string;
  entity_id: string;
  details: unknown;
  created_at: Date;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function pageUrl(filters: Record<string, string>, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dushanbe",
  }).format(value);
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("settings.manage");
  const raw = await searchParams;
  const search = one(raw.q).trim().slice(0, 120);
  const actionInput = one(raw.action).trim().slice(0, 100);
  const action = /^[a-z0-9._-]+$/i.test(actionInput) ? actionInput : "";
  const entityInput = one(raw.entity).trim();
  const entity = entityTypes.includes(entityInput) ? entityInput : "";
  const dateFrom = validDate(one(raw.from));
  const dateTo = validDate(one(raw.to));
  const page = Math.min(100_000, Math.max(1, Number.parseInt(one(raw.page), 10) || 1));

  const values: unknown[] = [];
  const conditions: string[] = [];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (search) {
    const term = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const p = parameter(term);
    conditions.push(`(actor.name ILIKE ${p} ESCAPE '\\' OR actor.phone ILIKE ${p} ESCAPE '\\')`);
  }
  if (action) conditions.push(`audit_log.action = ${parameter(action)}`);
  if (entity) conditions.push(`split_part(audit_log.action, '.', 1) = ${parameter(entity)}`);
  if (dateFrom) conditions.push(`audit_log.created_at >= ${parameter(dateFrom)}::date AT TIME ZONE 'Asia/Dushanbe'`);
  if (dateTo) conditions.push(`audit_log.created_at < (${parameter(dateTo)}::date + 1) AT TIME ZONE 'Asia/Dushanbe'`);
  values.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const limitParameter = `$${values.length - 1}`;
  const offsetParameter = `$${values.length}`;

  const result = await db.query<AuditRow>(`
    SELECT audit_log.id::text,
           audit_log.actor_user_id::text,
           actor.name AS actor_name,
           actor.phone AS actor_phone,
           audit_log.action,
           audit_log.entity_id,
           audit_log.details,
           audit_log.created_at
    FROM public.admin_audit_log AS audit_log
    LEFT JOIN public.users AS actor ON actor.id = audit_log.actor_user_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY audit_log.created_at DESC, audit_log.id DESC
    LIMIT ${limitParameter} OFFSET ${offsetParameter}
  `, values);
  const hasNext = result.rows.length > PAGE_SIZE;
  const events = result.rows.slice(0, PAGE_SIZE);
  const filters = { q: search, action, entity, from: dateFrom, to: dateTo };

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Панель управления</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Журнал действий</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">Безопасная история административных изменений Lotus.</p>
          <AdminNavigation />
        </header>

        <form className="mt-8 grid gap-4 rounded-[28px] border border-[#f0dfd9] bg-white p-5 md:grid-cols-2 xl:grid-cols-6" method="get">
          <label className="text-sm xl:col-span-2">Сотрудник
            <input name="q" defaultValue={search} placeholder="Имя или телефон" className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3" />
          </label>
          <label className="text-sm">Действие
            <input name="action" defaultValue={action} placeholder="order.status" className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3" />
          </label>
          <label className="text-sm">Тип объекта
            <select name="entity" defaultValue={entity} className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3">
              <option value="">Все</option>
              {entityTypes.map((type) => <option key={type} value={type}>{AUDIT_ENTITY_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="text-sm">Дата от
            <input name="from" type="date" defaultValue={dateFrom} className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3" />
          </label>
          <label className="text-sm">Дата до
            <input name="to" type="date" defaultValue={dateTo} className="mt-2 w-full rounded-xl border border-[#ead8d1] bg-[#fffaf8] px-3 py-3" />
          </label>
          <div className="flex flex-wrap gap-3 md:col-span-2 xl:col-span-6">
            <button className="rounded-full bg-[#342622] px-5 py-3 text-sm font-semibold text-white">Применить</button>
            <Link href="/admin/audit" className="rounded-full border border-[#ead8d1] px-5 py-3 text-sm">Сбросить</Link>
          </div>
        </form>

        {events.length === 0 ? (
          <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white px-6 py-14 text-center">
            <h2 className="font-serif text-2xl">Записей не найдено</h2>
            <p className="mt-2 text-sm text-[#806e68]">Измените фильтры или дождитесь новых административных действий.</p>
          </section>
        ) : (
          <div className="mt-6 space-y-4">
            {events.map((event) => {
              const type = auditEntityType(event.action);
              return (
                <article key={event.id} className="rounded-[24px] border border-[#f0dfd9] bg-white p-5 md:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b85d70]">{formatDate(event.created_at)}</p>
                      <h2 className="mt-2 font-serif text-xl">{AUDIT_ACTION_LABELS[event.action] || event.action}</h2>
                      <p className="mt-1 text-sm text-[#806e68]">
                        {event.actor_name ? `${event.actor_name} · ${event.actor_phone}` : "Сотрудник недоступен"}
                      </p>
                    </div>
                    <div className="text-right text-sm text-[#806e68]">
                      <p>{AUDIT_ENTITY_LABELS[type] || type}</p>
                      <p className="mt-1 break-all font-mono text-xs">{event.entity_id}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl bg-[#fffaf8] p-4 text-sm">
                    <AuditDetails details={event.details} />
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <nav className="mt-6 flex items-center justify-between" aria-label="Пагинация журнала">
          {page > 1 ? <Link href={pageUrl(filters, page - 1)} className="rounded-full border border-[#ead8d1] bg-white px-5 py-3 text-sm">← Назад</Link> : <span />}
          <span className="text-sm text-[#806e68]">Страница {page}</span>
          {hasNext ? <Link href={pageUrl(filters, page + 1)} className="rounded-full border border-[#ead8d1] bg-white px-5 py-3 text-sm">Далее →</Link> : <span />}
        </nav>
      </div>
    </main>
  );
}
