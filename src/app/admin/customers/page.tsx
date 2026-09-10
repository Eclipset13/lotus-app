import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSelect } from "@/components/admin-filter-select";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const customerFilters = ["all", "none", "one", "repeat", "new"] as const;
const customerSorts = ["newest", "oldest", "orders", "spent", "last_order"] as const;

type CustomerFilter = (typeof customerFilters)[number];
type CustomerSort = (typeof customerSorts)[number];

type CustomerStatistics = {
  total: number;
  new_last_30_days: number;
  with_orders: number;
  repeat_customers: number;
  paid_total: string;
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  created_at: Date;
  order_count: number;
  completed_order_count: number;
  paid_total: string;
  last_order_at: Date | null;
  address: string | null;
};

type SearchParams = {
  q?: string | string[];
  filter?: string | string[];
  sort?: string | string[];
  page?: string | string[];
};

const customerScopeSql = `
  customer_scope AS (
    SELECT u.id, u.name, u.phone, u.created_at
    FROM public.users u
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_roles admin_user_role
      JOIN public.roles admin_role ON admin_role.id = admin_user_role.role_id
      WHERE admin_user_role.user_id = u.id
        AND admin_role.code IN ('admin', 'super_admin')
    )
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_roles customer_user_role
          JOIN public.roles customer_role ON customer_role.id = customer_user_role.role_id
          WHERE customer_user_role.user_id = u.id
            AND customer_role.code = 'customer'
        )
        OR EXISTS (
          SELECT 1
          FROM public.orders customer_order
          WHERE customer_order.customer_id = u.id
        )
      )
  ),
  order_aggregates AS (
    SELECT o.customer_id,
           count(*) FILTER (WHERE o.status <> 'cancelled')::int AS order_count,
           count(*) FILTER (WHERE o.status = 'completed')::int AS completed_order_count,
           max(o.created_at) FILTER (WHERE o.status <> 'cancelled') AS last_order_at
    FROM public.orders o
    GROUP BY o.customer_id
  ),
  payment_aggregates AS (
    SELECT o.customer_id,
           COALESCE(sum(p.amount), 0)::text AS paid_total
    FROM public.orders o
    JOIN public.payments p ON p.order_id = o.id
    WHERE o.status <> 'cancelled'
      AND p.status = 'paid'
    GROUP BY o.customer_id
  )
`;

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function formatDate(value: Date | null) {
  if (!value) return "Не указан";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatMoney(value: string | number) {
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))} сом`;
}

function buildPageHref(
  page: number,
  query: string,
  filter: CustomerFilter,
  sort: CustomerSort,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("filter", filter);
  params.set("sort", sort);
  params.set("page", String(page));
  return `/admin/customers?${params.toString()}`;
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");

  const params = await searchParams;
  const query = singleParam(params.q).trim().slice(0, 120);
  const filterValue = singleParam(params.filter);
  const filter = (
    (customerFilters as readonly string[]).includes(filterValue)
      ? filterValue
      : "all"
  ) as CustomerFilter;
  const sortValue = singleParam(params.sort);
  const sort = (
    (customerSorts as readonly string[]).includes(sortValue)
      ? sortValue
      : "newest"
  ) as CustomerSort;
  const requestedPageValue = singleParam(params.page);
  const requestedPage = /^\d{1,7}$/.test(requestedPageValue)
    ? Math.max(1, Number(requestedPageValue))
    : 1;

  const queryValues: string[] = [];
  const conditions: string[] = [];

  if (query) {
    queryValues.push(`%${query}%`);
    const placeholder = `$${queryValues.length}`;
    conditions.push(`(
      c.name ILIKE ${placeholder}
      OR c.phone ILIKE ${placeholder}
      OR EXISTS (
        SELECT 1
        FROM public.customer_addresses search_address
        WHERE search_address.user_id = c.id
          AND concat_ws(
            ' ', search_address.city, search_address.street_address,
            search_address.apartment, search_address.entrance, search_address.floor
          ) ILIKE ${placeholder}
      )
      OR EXISTS (
        SELECT 1
        FROM public.orders search_order
        LEFT JOIN public.deliveries search_delivery
          ON search_delivery.order_id = search_order.id
        WHERE search_order.customer_id = c.id
          AND (
            search_order.order_number ILIKE ${placeholder}
            OR concat_ws(
              ' ', search_delivery.city, search_delivery.street_address,
              search_delivery.apartment, search_delivery.entrance,
              search_delivery.floor, search_delivery.recipient_name,
              search_delivery.recipient_phone
            ) ILIKE ${placeholder}
          )
      )
    )`);
  }

  if (filter === "none") {
    conditions.push("COALESCE(oa.order_count, 0) = 0");
  } else if (filter === "one") {
    conditions.push("COALESCE(oa.order_count, 0) = 1");
  } else if (filter === "repeat") {
    conditions.push("COALESCE(oa.order_count, 0) >= 2");
  } else if (filter === "new") {
    conditions.push("c.created_at >= NOW() - INTERVAL '30 days'");
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const orderBy =
    sort === "oldest"
      ? "c.created_at ASC, c.id ASC"
      : sort === "orders"
        ? "COALESCE(oa.order_count, 0) DESC, c.created_at DESC, c.id ASC"
        : sort === "spent"
          ? "COALESCE(pa.paid_total::numeric, 0) DESC, c.created_at DESC, c.id ASC"
          : sort === "last_order"
            ? "oa.last_order_at DESC NULLS LAST, c.created_at DESC, c.id ASC"
            : "c.created_at DESC, c.id ASC";

  const [statisticsResult, countResult] = await Promise.all([
    db.query<CustomerStatistics>(`
      WITH ${customerScopeSql}
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE c.created_at >= NOW() - INTERVAL '30 days'
             )::int AS new_last_30_days,
             count(*) FILTER (
               WHERE COALESCE(oa.order_count, 0) >= 1
             )::int AS with_orders,
             count(*) FILTER (
               WHERE COALESCE(oa.order_count, 0) >= 2
             )::int AS repeat_customers,
             COALESCE(sum(COALESCE(pa.paid_total::numeric, 0)), 0)::text AS paid_total
      FROM customer_scope c
      LEFT JOIN order_aggregates oa ON oa.customer_id = c.id
      LEFT JOIN payment_aggregates pa ON pa.customer_id = c.id
    `),
    db.query<{ total: number }>(
      `
        WITH ${customerScopeSql}
        SELECT count(*)::int AS total
        FROM customer_scope c
        LEFT JOIN order_aggregates oa ON oa.customer_id = c.id
        LEFT JOIN payment_aggregates pa ON pa.customer_id = c.id
        ${whereClause}
      `,
      queryValues,
    ),
  ]);

  const statistics = statisticsResult.rows[0] ?? {
    total: 0,
    new_last_30_days: 0,
    with_orders: 0,
    repeat_customers: 0,
    paid_total: "0",
  };
  const foundCustomers = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(foundCustomers / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const limitPlaceholder = `$${queryValues.length + 1}`;
  const offsetPlaceholder = `$${queryValues.length + 2}`;

  const customersResult = await db.query<CustomerRow>(
    `
      WITH ${customerScopeSql}
      SELECT c.id::text,
             c.name,
             c.phone,
             c.created_at,
             COALESCE(oa.order_count, 0)::int AS order_count,
             COALESCE(oa.completed_order_count, 0)::int AS completed_order_count,
             COALESCE(pa.paid_total, '0') AS paid_total,
             oa.last_order_at,
             COALESCE(saved_address.address, delivery_address.address) AS address
      FROM customer_scope c
      LEFT JOIN order_aggregates oa ON oa.customer_id = c.id
      LEFT JOIN payment_aggregates pa ON pa.customer_id = c.id
      LEFT JOIN LATERAL (
        SELECT concat_ws(
                 ', ', NULLIF(address.city, ''), NULLIF(address.street_address, ''),
                 CASE WHEN NULLIF(address.apartment, '') IS NOT NULL
                   THEN 'кв. ' || address.apartment END,
                 CASE WHEN NULLIF(address.entrance, '') IS NOT NULL
                   THEN 'подъезд ' || address.entrance END,
                 CASE WHEN NULLIF(address.floor, '') IS NOT NULL
                   THEN 'этаж ' || address.floor END
               ) AS address
        FROM public.customer_addresses address
        WHERE address.user_id = c.id
        ORDER BY address.is_default DESC, address.updated_at DESC, address.id
        LIMIT 1
      ) saved_address ON TRUE
      LEFT JOIN LATERAL (
        SELECT concat_ws(
                 ', ', NULLIF(delivery.city, ''), NULLIF(delivery.street_address, ''),
                 CASE WHEN NULLIF(delivery.apartment, '') IS NOT NULL
                   THEN 'кв. ' || delivery.apartment END,
                 CASE WHEN NULLIF(delivery.entrance, '') IS NOT NULL
                   THEN 'подъезд ' || delivery.entrance END,
                 CASE WHEN NULLIF(delivery.floor, '') IS NOT NULL
                   THEN 'этаж ' || delivery.floor END
               ) AS address
        FROM public.orders address_order
        JOIN public.deliveries delivery ON delivery.order_id = address_order.id
        WHERE address_order.customer_id = c.id
        ORDER BY address_order.created_at DESC, delivery.created_at DESC
        LIMIT 1
      ) delivery_address ON TRUE
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}::integer
      OFFSET ${offsetPlaceholder}::integer
    `,
    [...queryValues, String(PAGE_SIZE), String(offset)],
  );

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Покупатели</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">
            Клиентская база Lotus, история покупок и оплаченные заказы.
          </p>
          <AdminNavigation />
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Всего покупателей", statistics.total, ""],
            ["Новые за 30 дней", statistics.new_last_30_days, "text-[#b85d70]"],
            ["Сделали заказ", statistics.with_orders, "text-green-700"],
            ["Повторные", statistics.repeat_customers, "text-[#9f5f56]"],
            ["Оплачено", formatMoney(statistics.paid_total), "text-[#342622]"],
          ].map(([label, value, color]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-[#f0dfd9] bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
                {label}
              </p>
              <strong className={`mt-4 block font-serif text-3xl ${color}`}>
                {value}
              </strong>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[24px] border border-[#f0dfd9] bg-white p-5">
          <form
            method="GET"
            className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_230px_230px_auto_auto]"
          >
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Поиск
              <input
                type="search"
                name="q"
                maxLength={120}
                defaultValue={query}
                placeholder="Имя, телефон, адрес или номер заказа"
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Покупки
              <AdminSelect
                className="mt-2"
                name="filter"
                defaultValue={filter}
                ariaLabel="Фильтр покупателей"
                options={[
                  { value: "all", label: "Все покупатели" },
                  { value: "none", label: "Без заказов" },
                  { value: "one", label: "Один заказ" },
                  { value: "repeat", label: "Повторные покупатели" },
                  { value: "new", label: "Новые за 30 дней" },
                ]}
              />
            </label>

            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Сортировка
              <AdminSelect
                className="mt-2"
                name="sort"
                defaultValue={sort}
                ariaLabel="Сортировка покупателей"
                options={[
                  { value: "newest", label: "Сначала новые" },
                  { value: "oldest", label: "Сначала старые" },
                  { value: "orders", label: "По количеству заказов" },
                  { value: "spent", label: "По сумме покупок" },
                  { value: "last_order", label: "По последнему заказу" },
                ]}
              />
            </label>

            <button
              type="submit"
              className="h-12 self-end rounded-2xl bg-[#342622] px-5 text-sm font-semibold text-white transition hover:bg-[#4b3731]"
            >
              Показать
            </button>
            <Link
              href="/admin/customers"
              className="flex h-12 items-center justify-center self-end rounded-2xl border border-[#ead8d1] px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]"
            >
              Сбросить
            </Link>
          </form>
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-[#806e68]">
          <p>Найдено покупателей: {foundCustomers}</p>
          <p>
            Страница {currentPage} из {totalPages}
          </p>
        </div>

        {customersResult.rows.length === 0 ? (
          <section className="mt-6 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden="true">👥</span>
            <h2 className="mt-4 font-serif text-2xl">Покупатели не найдены</h2>
            <p className="mt-2 text-sm text-[#806e68]">
              Измените поиск или выбранный фильтр.
            </p>
          </section>
        ) : (
          <section className="mt-6 grid gap-5 xl:grid-cols-2">
            {customersResult.rows.map((customer) => (
              <article
                key={customer.id}
                className="rounded-[28px] border border-[#f0dfd9] bg-white p-6 shadow-[0_16px_45px_rgba(74,48,41,0.04)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#b07b72]">
                      Покупатель
                    </p>
                    <h2 className="mt-2 font-serif text-2xl">
                      {customer.name?.trim() || "Не указан"}
                    </h2>
                    <a
                      href={`tel:${customer.phone}`}
                      className="mt-1 inline-block text-sm font-semibold text-[#b85d70]"
                    >
                      {customer.phone}
                    </a>
                  </div>
                  <Link
                    href={`/admin?q=${encodeURIComponent(customer.phone)}`}
                    className="rounded-xl border border-[#e8d4cd] px-4 py-2.5 text-sm font-semibold text-[#9f5f56] transition hover:bg-[#fff4f1]"
                  >
                    Показать заказы
                  </Link>
                </div>

                <dl className="mt-5 grid gap-4 rounded-2xl bg-[#fffaf8] p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Email</dt>
                    <dd className="mt-1 text-sm">Не указан</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Дата регистрации</dt>
                    <dd className="mt-1 text-sm">{formatDate(customer.created_at)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Адрес</dt>
                    <dd className="mt-1 text-sm leading-6">{customer.address || "Не указан"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Заказов</dt>
                    <dd className="mt-1 text-sm font-semibold">{customer.order_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Выполнено</dt>
                    <dd className="mt-1 text-sm font-semibold">{customer.completed_order_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Оплаченная сумма</dt>
                    <dd className="mt-1 text-sm font-semibold text-green-700">
                      {formatMoney(customer.paid_total)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Последний заказ</dt>
                    <dd className="mt-1 text-sm">{formatDate(customer.last_order_at)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>
        )}

        <nav
          aria-label="Пагинация покупателей"
          className="mt-8 flex items-center justify-center gap-4"
        >
          {currentPage > 1 ? (
            <Link
              href={buildPageHref(currentPage - 1, query, filter, sort)}
              className="rounded-2xl border border-[#ead8d1] bg-white px-5 py-3 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]"
            >
              Назад
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-2xl border border-[#ead8d1] bg-white px-5 py-3 text-sm font-semibold text-[#b9aaa5] opacity-60">
              Назад
            </span>
          )}

          <span className="text-sm font-semibold text-[#4d3934]">
            {currentPage} / {totalPages}
          </span>

          {currentPage < totalPages ? (
            <Link
              href={buildPageHref(currentPage + 1, query, filter, sort)}
              className="rounded-2xl bg-[#342622] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#4b3731]"
            >
              Далее
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded-2xl bg-[#342622] px-5 py-3 text-sm font-semibold text-white opacity-35">
              Далее
            </span>
          )}
        </nav>
      </div>
    </main>
  );
}
