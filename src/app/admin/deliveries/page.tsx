import Link from "next/link";
import { hasPermission } from "@/lib/permissions";
import { CourierDeliveries } from "@/components/courier-deliveries";
import { AdminDeliveryEditor } from "@/components/admin-delivery-editor";
import { AdminSelect } from "@/components/admin-filter-select";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  DELIVERY_STATUS_LABELS,
  type DeliveryStatus,
} from "@/lib/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeliveryRow = {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  status: DeliveryStatus;
  recipient_name: string;
  recipient_phone: string;
  city: string;
  street_address: string;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  delivery_comment: string | null;
  requested_at: Date | null;
  scheduled_at: Date | null;
  scheduled_at_input: string | null;
  courier_user_id: string | null;
  courier_name: string | null;
  delivery_cost: string;
  internal_note: string | null;
  delivered_at: Date | null;
  created_at: Date;
};

type DeliveryStatistics = {
  planned: number;
  assigned: number;
  on_the_way: number;
  delivered_today: number;
  cancelled: number;
};

const deliveryFilterValues = [
  "active",
  "planned",
  "assigned",
  "on_the_way",
  "delivered",
  "cancelled",
  "all",
] as const;

type DeliveryFilter = (typeof deliveryFilterValues)[number];

const deliveryFilterOptions: Array<{
  value: DeliveryFilter;
  label: string;
}> = [
  { value: "active", label: "Активные" },
  { value: "planned", label: "Ожидают назначения" },
  { value: "assigned", label: "Назначены" },
  { value: "on_the_way", label: "В пути" },
  { value: "delivered", label: "Доставлены" },
  { value: "cancelled", label: "Отменены" },
  { value: "all", label: "Все" },
];

const orderStatusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  preparing: "Собирается",
  ready: "Готов",
  delivering: "Доставляется",
  completed: "Выполнен",
  cancelled: "Отменён",
};

const deliveryStatusClasses: Record<DeliveryStatus, string> = {
  planned: "bg-amber-50 text-amber-700",
  assigned: "bg-blue-50 text-blue-700",
  on_the_way: "bg-orange-50 text-orange-700",
  delivered: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-[#f5ece9] text-[#9a746c]",
};

function formatDateTime(value: Date | null) {
  if (!value) return "Не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Dushanbe",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatMoney(value: string) {
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))} сом`;
}

export default async function AdminDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    date?: string;
    courier?: string;
    sort?: string;
  }>;
}) {
  const session = await requirePermission("deliveries.read");
  if (!hasPermission(session.roles, "deliveries.manage")) return <CourierDeliveries />;
  const couriers = await db.query<{ id: string; name: string }>(`SELECT u.id::text,u.name FROM public.users u
    JOIN public.staff_credentials c ON c.user_id=u.id
    WHERE u.status='active' AND EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      WHERE ur.user_id=u.id AND r.code='courier') ORDER BY u.name`);

  const params = await searchParams;
  const searchQuery = (params.q ?? "").trim().slice(0, 160);
  const status = (
    (deliveryFilterValues as readonly string[]).includes(params.status ?? "")
      ? params.status
      : "active"
  ) as DeliveryFilter;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : "";
  const courier = ["assigned", "unassigned"].includes(params.courier ?? "")
    ? params.courier!
    : "all";
  const sort = ["nearest", "newest", "oldest"].includes(params.sort ?? "")
    ? params.sort!
    : "nearest";

  const values: string[] = [];
  const conditions: string[] = ["o.fulfillment_type = 'delivery'"];
  if (searchQuery) {
    values.push(`%${searchQuery}%`);
    const parameter = `$${values.length}`;
    conditions.push(`(
      o.order_number ILIKE ${parameter}
      OR d.recipient_name ILIKE ${parameter}
      OR d.recipient_phone ILIKE ${parameter}
      OR concat_ws(' ', d.city, d.street_address, d.apartment) ILIKE ${parameter}
      OR COALESCE(d.courier_name, '') ILIKE ${parameter}
    )`);
  }
  if (status === "active") {
    conditions.push(
      "d.status IN ('planned', 'assigned', 'on_the_way') AND o.status <> 'cancelled'",
    );
  } else if (["planned", "assigned", "on_the_way"].includes(status)) {
    values.push(status);
    conditions.push(
      `d.status = $${values.length}::varchar AND o.status <> 'cancelled'`,
    );
  } else if (status === "delivered") {
    conditions.push("d.status = 'delivered'");
  } else if (status === "cancelled") {
    conditions.push(
      "(d.status = 'cancelled' OR (o.status = 'cancelled' AND d.status <> 'delivered'))",
    );
  }
  if (date) {
    values.push(date);
    conditions.push(`
      (COALESCE(d.scheduled_at, d.requested_at) AT TIME ZONE 'Asia/Dushanbe')::date
        = $${values.length}::date
    `);
  }
  if (courier === "assigned") {
    conditions.push("NULLIF(btrim(d.courier_name), '') IS NOT NULL");
  } else if (courier === "unassigned") {
    conditions.push("NULLIF(btrim(d.courier_name), '') IS NULL");
  }
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const orderBy =
    sort === "oldest"
      ? "d.created_at ASC, d.id ASC"
      : sort === "newest"
        ? "d.created_at DESC, d.id DESC"
        : "COALESCE(d.scheduled_at, d.requested_at) ASC NULLS LAST, d.created_at DESC";

  const [deliveriesResult, statisticsResult] = await Promise.all([
    db.query<DeliveryRow>(
      `
        SELECT d.id::text,
               d.order_id::text,
               o.order_number,
               o.status AS order_status,
               d.status,
               d.recipient_name,
               d.recipient_phone,
               d.city,
               d.street_address,
               d.apartment,
               d.entrance,
               d.floor,
               d.delivery_comment,
               d.requested_at,
               d.scheduled_at,
               to_char(
                 d.scheduled_at AT TIME ZONE 'Asia/Dushanbe',
                 'YYYY-MM-DD"T"HH24:MI'
               ) AS scheduled_at_input,
               d.courier_user_id::text,
               d.courier_name,
               o.delivery_cost::text,
               d.internal_note,
               d.delivered_at,
               d.created_at
        FROM public.deliveries d
        JOIN public.orders o ON o.id = d.order_id
        ${whereClause}
        ORDER BY ${orderBy}
      `,
      values,
    ),
    db.query<DeliveryStatistics>(`
      SELECT count(*) FILTER (
               WHERE d.status = 'planned' AND o.status <> 'cancelled'
             )::int AS planned,
             count(*) FILTER (
               WHERE d.status = 'assigned' AND o.status <> 'cancelled'
             )::int AS assigned,
             count(*) FILTER (
               WHERE d.status = 'on_the_way' AND o.status <> 'cancelled'
             )::int AS on_the_way,
             count(*) FILTER (
               WHERE d.status = 'delivered'
                 AND (COALESCE(d.delivered_at, d.updated_at) AT TIME ZONE 'Asia/Dushanbe')::date
                   = (NOW() AT TIME ZONE 'Asia/Dushanbe')::date
             )::int AS delivered_today,
             count(*) FILTER (
               WHERE d.status = 'cancelled'
                  OR (o.status = 'cancelled' AND d.status <> 'delivered')
             )::int AS cancelled
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      WHERE o.fulfillment_type = 'delivery'
    `),
  ]);
  const statistics = statisticsResult.rows[0] ?? {
    planned: 0,
    assigned: 0,
    on_the_way: 0,
    delivered_today: 0,
    cancelled: 0,
  };

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Доставка</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">
            Назначение курьеров, планирование времени и контроль выполнения
            доставок Lotus.
          </p>
          <AdminNavigation />
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Ожидают назначения", statistics.planned],
            ["Назначены", statistics.assigned],
            ["В пути", statistics.on_the_way],
            ["Доставлены сегодня", statistics.delivered_today],
            ["Отменены", statistics.cancelled],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-[#f0dfd9] bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
                {label}
              </p>
              <strong className="mt-4 block font-serif text-4xl">
                {value}
              </strong>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[24px] border border-[#f0dfd9] bg-white p-5">
          <form
            method="GET"
            className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,190px)_minmax(0,170px)_minmax(0,190px)_minmax(0,190px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,190px)_minmax(0,170px)_minmax(0,190px)_minmax(0,190px)_minmax(0,auto)_minmax(0,auto)]"
          >
            <label className="min-w-0 text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Поиск
              <input
                type="search"
                name="q"
                maxLength={160}
                defaultValue={searchQuery}
                placeholder="Заказ, получатель, адрес, курьер"
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>

            <label className="min-w-0 text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Статус
              <AdminSelect
                className="mt-2"
                name="status"
                defaultValue={status}
                ariaLabel="Выбрать статус доставки"
                options={deliveryFilterOptions}
              />
            </label>

            <label className="min-w-0 text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Дата
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>

            <label className="min-w-0 text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Курьер
              <AdminSelect
                className="mt-2"
                name="courier"
                defaultValue={courier}
                ariaLabel="Фильтр назначения курьера"
                options={[
                  { value: "all", label: "Любое назначение" },
                  { value: "assigned", label: "Курьер назначен" },
                  { value: "unassigned", label: "Без курьера" },
                ]}
              />
            </label>

            <label className="min-w-0 text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Сортировка
              <AdminSelect
                className="mt-2"
                name="sort"
                defaultValue={sort}
                ariaLabel="Сортировка доставок"
                options={[
                  { value: "nearest", label: "Ближайшее время" },
                  { value: "newest", label: "Сначала новые" },
                  { value: "oldest", label: "Сначала старые" },
                ]}
              />
            </label>

            <div className="col-span-full flex min-w-0 justify-end gap-2 xl:col-span-5 2xl:contents">
              <button
                type="submit"
                className="h-12 min-w-0 self-end rounded-2xl bg-[#342622] px-5 text-sm font-semibold text-white transition hover:bg-[#4b3731] 2xl:w-full"
              >
                Показать
              </button>
              <Link
                href="/admin/deliveries"
                className="flex h-12 min-w-0 items-center justify-center self-end rounded-2xl border border-[#ead8d1] px-4 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1] 2xl:w-full"
              >
                Сбросить
              </Link>
            </div>
          </form>
        </section>

        {deliveriesResult.rows.length === 0 ? (
          <section className="mt-8 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden="true">
              🚚
            </span>
            <h2 className="mt-4 font-serif text-2xl">Доставки не найдены</h2>
            <p className="mt-2 text-sm text-[#806e68]">
              Измените параметры поиска или оформите заказ с доставкой.
            </p>
          </section>
        ) : (
          <section className="mt-8 space-y-5">
            {deliveriesResult.rows.map((delivery) => (
              <article
                key={delivery.id}
                className="rounded-[28px] border border-[#f0dfd9] bg-white p-6 shadow-[0_16px_45px_rgba(74,48,41,0.04)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b07b72]">
                      Заказ {delivery.order_number}
                    </p>
                    <h2 className="mt-2 font-serif text-2xl">
                      {delivery.recipient_name}
                    </h2>
                    <a
                      href={`tel:${delivery.recipient_phone}`}
                      className="mt-1 inline-block text-sm text-[#b85d70]"
                    >
                      {delivery.recipient_phone}
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#f8f0ed] px-3 py-1.5 text-xs font-semibold text-[#806e68]">
                      Заказ: {orderStatusLabels[delivery.order_status] ?? delivery.order_status}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${deliveryStatusClasses[delivery.status]}`}
                    >
                      {DELIVERY_STATUS_LABELS[delivery.status]}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 rounded-2xl bg-[#fffaf8] p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">
                      Адрес
                    </p>
                    <p className="mt-2 text-sm leading-6">
                      {delivery.city}, {delivery.street_address}
                      {(delivery.apartment || delivery.entrance || delivery.floor) && (
                        <>
                          <br />
                          Кв. {delivery.apartment || "—"}, подъезд{" "}
                          {delivery.entrance || "—"}, этаж {delivery.floor || "—"}
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">
                      Время
                    </p>
                    <p className="mt-2 text-sm">
                      Желаемое: {formatDateTime(delivery.requested_at)}
                    </p>
                    <p className="mt-1 text-sm">
                      Плановое: {formatDateTime(delivery.scheduled_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">
                      Курьер
                    </p>
                    <p className="mt-2 text-sm">
                      {delivery.courier_name || "Не назначен"}
                    </p>
                    <p className="mt-1 text-sm text-[#806e68]">
                      {formatMoney(delivery.delivery_cost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">
                      Создано
                    </p>
                    <p className="mt-2 text-sm">
                      {formatDateTime(delivery.created_at)}
                    </p>
                    <Link
                      href={`/admin#order-${delivery.order_id}`}
                      className="mt-2 inline-flex text-sm font-semibold text-[#b85d70] hover:text-[#95485a]"
                    >
                      Открыть заказ
                    </Link>
                  </div>
                </div>

                {(delivery.delivery_comment || delivery.internal_note) && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {delivery.delivery_comment && (
                      <div className="rounded-2xl border border-[#f0dfd9] px-4 py-3 text-sm">
                        <strong>Комментарий курьеру:</strong>{" "}
                        {delivery.delivery_comment}
                      </div>
                    )}
                    {delivery.internal_note && (
                      <div className="rounded-2xl border border-[#f0dfd9] px-4 py-3 text-sm">
                        <strong>Примечание:</strong> {delivery.internal_note}
                      </div>
                    )}
                  </div>
                )}

                <AdminDeliveryEditor
                  couriers={couriers.rows}
                  courierUserId={delivery.courier_user_id ?? ""}
                  deliveryId={delivery.id}
                  status={delivery.status}
                  courierName={delivery.courier_name ?? ""}
                  scheduledAt={delivery.scheduled_at_input ?? ""}
                  internalNote={delivery.internal_note ?? ""}
                />
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
