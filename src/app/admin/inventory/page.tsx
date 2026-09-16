import Link from "next/link";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminSelect } from "@/components/admin-filter-select";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { hasPermission } from "@/lib/permissions";
import { AdminStockReadonly } from "@/components/admin-stock-readonly";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InventoryStats = {
  active_types: number;
  total_stock: number;
  reserved_stock: number;
  available_stock: number;
  out_of_stock: number;
  low_stock: number;
  purchase_value: string;
  sale_value: string;
};

type InventoryFlower = {
  id: string;
  name: string;
  category_name: string | null;
  unit: string;
  purchase_price: string;
  sale_price: string;
  stock_quantity: number;
  min_stock_quantity: number;
  image_url: string | null;
  is_active: boolean;
  last_movement_at: Date | null;
  reserved_quantity: number;
  available_quantity: number;
};

type Category = { id: string; name: string };
type StockStatus = "available" | "low" | "out";

const MAX_BIGINT = "9223372036854775807";

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

function getStockStatus(stock: number, minimum: number): StockStatus {
  if (stock <= 0) return "out";
  if (stock <= minimum) return "low";
  return "available";
}

const stockStatusLabels: Record<StockStatus, string> = {
  available: "Достаточно",
  low: "Мало",
  out: "Нет в наличии",
};

const stockStatusClasses: Record<StockStatus, string> = {
  available: "bg-green-50 text-green-700",
  low: "bg-orange-50 text-orange-700",
  out: "bg-red-50 text-red-700",
};

function money(value: string | number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDate(value: Date | null) {
  if (!value) return "Движений ещё нет";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    activity?: string;
    category?: string;
    sort?: string;
    message?: string;
  }>;
}) {
  const session = await requirePermission("inventory.read");
  if (!hasPermission(session.roles, "inventory.manage")) return <AdminStockReadonly  />;

  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 120);
  const status = ["available", "low", "out"].includes(params.status ?? "")
    ? params.status!
    : "all";
  const activity = ["active", "inactive"].includes(params.activity ?? "")
    ? params.activity!
    : "all";
  const category = isDatabaseId(params.category ?? "") ? params.category! : "all";
  const sort = ["name", "stock", "movement"].includes(params.sort ?? "")
    ? params.sort!
    : "name";

  const values: Array<string | boolean> = [];
  const conditions: string[] = [];

  if (query) {
    values.push(`%${query}%`);
    conditions.push(`f.name ILIKE $${values.length}`);
  }
  if (status === "available") {
    conditions.push("GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) > f.min_stock_quantity");
  } else if (status === "low") {
    conditions.push(
      "GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) > 0 AND GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) <= f.min_stock_quantity",
    );
  } else if (status === "out") {
    conditions.push("GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) = 0");
  }
  if (activity !== "all") {
    values.push(activity === "active");
    conditions.push(`f.is_active = $${values.length}`);
  }
  if (category !== "all") {
    values.push(category);
    conditions.push(`f.category_id = $${values.length}::bigint`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const orderBy =
    sort === "stock"
      ? "GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) ASC, f.name ASC"
      : sort === "movement"
        ? "lm.last_movement_at DESC NULLS LAST, f.name ASC"
        : "f.name ASC";

  const [statsResult, flowersResult, categoriesResult] = await Promise.all([
    db.query<InventoryStats>(`
      WITH active_reservations AS (
        SELECT flower_id, sum(quantity)::int AS reserved_quantity
        FROM public.order_stock_reservations
        WHERE status = 'active'
        GROUP BY flower_id
      )
      SELECT count(*)::int AS active_types,
             COALESCE(sum(f.stock_quantity), 0)::int AS total_stock,
             COALESCE(sum(COALESCE(ar.reserved_quantity, 0)), 0)::int AS reserved_stock,
             COALESCE(sum(GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0)), 0)::int AS available_stock,
             count(*) FILTER (WHERE GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) = 0)::int AS out_of_stock,
             count(*) FILTER (
               WHERE GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) > 0
                 AND GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0) <= f.min_stock_quantity
             )::int AS low_stock,
             COALESCE(sum(f.stock_quantity * f.purchase_price), 0)::text AS purchase_value,
             COALESCE(sum(f.stock_quantity * f.sale_price), 0)::text AS sale_value
      FROM public.flowers f
      LEFT JOIN active_reservations ar ON ar.flower_id = f.id
      WHERE f.is_active = TRUE
    `),
    db.query<InventoryFlower>(
      `
        WITH last_movements AS (
          SELECT flower_id, max(created_at) AS last_movement_at
          FROM public.stock_movements
          GROUP BY flower_id
        ), active_reservations AS (
          SELECT flower_id, sum(quantity)::int AS reserved_quantity
          FROM public.order_stock_reservations
          WHERE status = 'active'
          GROUP BY flower_id
        )
        SELECT f.id::text,
               f.name,
               c.name AS category_name,
               f.unit,
               f.purchase_price::text,
               f.sale_price::text,
               f.stock_quantity,
               f.min_stock_quantity,
               f.image_url,
               f.is_active,
               COALESCE(ar.reserved_quantity, 0)::int AS reserved_quantity,
               GREATEST(f.stock_quantity - COALESCE(ar.reserved_quantity, 0), 0)::int AS available_quantity,
               lm.last_movement_at
        FROM public.flowers f
        LEFT JOIN public.categories c ON c.id = f.category_id
        LEFT JOIN last_movements lm ON lm.flower_id = f.id
        LEFT JOIN active_reservations ar ON ar.flower_id = f.id
        ${whereClause}
        ORDER BY ${orderBy}
      `,
      values,
    ),
    db.query<Category>(`
      SELECT id::text, name
      FROM public.categories
      ORDER BY sort_order, name
    `),
  ]);

  const stats = statsResult.rows[0] ?? {
    active_types: 0,
    total_stock: 0,
    reserved_stock: 0,
    available_stock: 0,
    out_of_stock: 0,
    low_stock: 0,
    purchase_value: "0",
    sale_value: "0",
  };
  const flowers = flowersResult.rows;

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Склад</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">
            Остатки цветов, дефицит и история складских операций Lotus.
          </p>
          <AdminNavigation />
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/admin/inventory/new" className="inline-flex h-12 items-center rounded-2xl bg-[#342622] px-5 text-sm font-semibold text-white transition hover:bg-[#4b3731]">
              Добавить цветок
            </Link>
            <Link href="/admin/inventory/categories" className="inline-flex h-12 items-center rounded-2xl border border-[#ead8d1] bg-white px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]">
              Категории
            </Link>
          </div>
        </header>

        {params.message === "flower-deleted" && (
          <p role="status" className="mt-6 rounded-2xl bg-green-50 px-5 py-4 text-sm font-semibold text-green-700">
            Цветок удалён
          </p>
        )}

        <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Активных видов", stats.active_types, ""],
            ["Цветов на складе", stats.total_stock, ""],
            ["Зарезервировано", stats.reserved_stock, "text-blue-700"],
            ["Доступно", stats.available_stock, "text-green-700"],
            ["Закончились", stats.out_of_stock, "text-red-700"],
            ["Ниже минимума", stats.low_stock, "text-orange-700"],
            ["Закупочная стоимость", `${money(stats.purchase_value)} сом`, ""],
            ["Потенциальная стоимость", `${money(stats.sale_value)} сом`, ""],
          ].map(([label, value, color]) => (
            <article
              key={String(label)}
              className="rounded-[24px] border border-[#f0dfd9] bg-white p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-[#99817a]">
                {label}
              </p>
              <strong className={`mt-4 block font-serif text-3xl ${color}`}>
                {value}
              </strong>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-[24px] border border-[#f0dfd9] bg-white p-5">
          <form method="GET" className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.3fr_repeat(4,minmax(150px,0.75fr))_auto_auto]">
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Поиск
              <input
                name="q"
                type="search"
                maxLength={120}
                defaultValue={query}
                placeholder="Название цветка"
                className="mt-2 h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#d89b91] focus:ring-4 focus:ring-[#f4cbc4]/25"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Остаток
              <AdminSelect className="mt-2" name="status" defaultValue={status} ariaLabel="Выбрать остаток" options={[
                { value: "all", label: "Все" },
                { value: "available", label: "Достаточно" },
                { value: "low", label: "Мало" },
                { value: "out", label: "Нет в наличии" },
              ]} />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Активность
              <AdminSelect className="mt-2" name="activity" defaultValue={activity} ariaLabel="Выбрать активность" options={[
                { value: "all", label: "Все" },
                { value: "active", label: "Активные" },
                { value: "inactive", label: "Неактивные" },
              ]} />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Категория
              <AdminSelect className="mt-2" name="category" defaultValue={category} ariaLabel="Выбрать категорию" options={[
                { value: "all", label: "Все" },
                ...categoriesResult.rows.map((item) => ({ value: item.id, label: item.name })),
              ]} />
            </label>
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-[#99817a]">
              Сортировка
              <AdminSelect className="mt-2" name="sort" defaultValue={sort} ariaLabel="Выбрать сортировку" options={[
                { value: "name", label: "По названию" },
                { value: "stock", label: "По остатку" },
                { value: "movement", label: "По движению" },
              ]} />
            </label>
            <button type="submit" className="h-12 self-end rounded-2xl bg-[#342622] px-5 text-sm font-semibold text-white transition hover:bg-[#4b3731]">
              Применить
            </button>
            <Link href="/admin/inventory" className="flex h-12 items-center justify-center self-end rounded-2xl border border-[#ead8d1] px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]">
              Сбросить
            </Link>
          </form>
        </section>

        {flowers.length === 0 ? (
          <section className="mt-8 rounded-[28px] border border-dashed border-[#e5cbc3] bg-white px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden="true">🌿</span>
            <h2 className="mt-4 font-serif text-2xl">Цветы не найдены</h2>
            <p className="mt-2 text-sm text-[#806e68]">
              Измените параметры поиска или сбросьте фильтры.
            </p>
          </section>
        ) : (
          <section className="mt-8 overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1380px] text-left text-sm">
                <thead className="bg-[#fff4f1] text-xs uppercase tracking-[0.12em] text-[#99817a]">
                  <tr>
                    <th className="px-5 py-4">Цветок</th>
                    <th className="px-5 py-4">Категория</th>
                    <th className="px-5 py-4">Физический остаток</th>
                    <th className="px-5 py-4">Зарезервировано</th>
                    <th className="px-5 py-4">Доступно</th>
                    <th className="px-5 py-4">Минимум</th>
                    <th className="px-5 py-4">Закупка</th>
                    <th className="px-5 py-4">Продажа</th>
                    <th className="px-5 py-4">Стоимость запаса</th>
                    <th className="px-5 py-4">Статус</th>
                    <th className="px-5 py-4">Последнее движение</th>
                    <th className="px-5 py-4" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3e6e1]">
                  {flowers.map((flower) => {
                    const stockStatus = getStockStatus(
                      flower.available_quantity,
                      flower.min_stock_quantity,
                    );
                    return (
                      <tr key={flower.id} className="hover:bg-[#fffdfc]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            {flower.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={flower.image_url} alt={flower.name} className="h-12 w-12 rounded-xl object-cover" />
                            ) : (
                              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#fff0ec] text-xl" aria-hidden="true">🌸</span>
                            )}
                            <div>
                              <p className="font-semibold">{flower.name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#99817a]">
                                <span>{flower.is_active ? "Активен" : "Неактивен"}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">{flower.category_name ?? "Без категории"}</td>
                        <td className="px-5 py-4 text-lg font-bold">
                          {flower.stock_quantity} <span className="text-xs font-normal text-[#99817a]">{flower.unit}</span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-blue-700">
                          {flower.reserved_quantity} <span className="text-xs font-normal text-[#99817a]">{flower.unit}</span>
                        </td>
                        <td className="px-5 py-4 text-lg font-bold text-green-700">
                          {flower.available_quantity} <span className="text-xs font-normal text-[#99817a]">{flower.unit}</span>
                        </td>
                        <td className="px-5 py-4">{flower.min_stock_quantity}</td>
                        <td className="px-5 py-4">{money(flower.purchase_price)} сом</td>
                        <td className="px-5 py-4">{money(flower.sale_price)} сом</td>
                        <td className="px-5 py-4 font-semibold">
                          {money(flower.stock_quantity * Number(flower.purchase_price))} сом
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${stockStatusClasses[stockStatus]}`}>
                            {stockStatusLabels[stockStatus]}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs leading-5 text-[#806e68]">
                          {formatDate(flower.last_movement_at)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link href={`/admin/inventory/${flower.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-[#342622] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4b3731]">
                            Открыть
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
