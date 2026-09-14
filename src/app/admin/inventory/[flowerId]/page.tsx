import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminInventoryControls } from "@/components/admin-inventory-controls";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const MAX_BIGINT = "9223372036854775807";

type Flower = {
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
  constructor_kind: string | null;
  reserved_quantity: number;
  available_quantity: number;
};

type StockMovement = {
  id: string;
  movement_type: string;
  quantity_change: number;
  unit_cost: string | null;
  note: string | null;
  created_at: Date;
  supplier_name: string | null;
  purchase_id: string | null;
  document_number: string | null;
  order_id: string | null;
};

type MovementCount = { total: number };

type ActiveReservation = {
  id: string;
  order_id: string;
  order_number: string;
  quantity: number;
  reserved_at: Date;
};

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

function parsePage(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : 1;
}

function money(value: string | number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function getStockStatus(stock: number, minimum: number) {
  if (stock <= 0) {
    return { label: "Нет в наличии", className: "bg-red-50 text-red-700" };
  }
  if (stock <= minimum) {
    return { label: "Мало", className: "bg-orange-50 text-orange-700" };
  }
  return { label: "Достаточно", className: "bg-green-50 text-green-700" };
}

const movementLabels: Record<string, string> = {
  purchase: "Поступление",
  sale: "Продажа",
  return: "Возврат",
  write_off: "Списание",
  correction: "Корректировка",
  reservation: "Резервирование",
  reservation_release: "Снятие резерва",
};

function MissingFlower() {
  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <BrandLogo />
        <AdminNavigation />
        <section className="mt-8 rounded-[28px] border border-[#f0dfd9] bg-white px-6 py-16 text-center">
          <h1 className="font-serif text-4xl">Цветок не найден</h1>
          <Link href="/admin/inventory" className="mt-7 inline-flex h-12 items-center rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white">
            Вернуться на склад
          </Link>
        </section>
      </div>
    </main>
  );
}

export default async function InventoryFlowerPage({
  params,
  searchParams,
}: {
  params: Promise<{ flowerId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const { flowerId } = await params;
  if (!isDatabaseId(flowerId)) {
    return <MissingFlower />;
  }
  const requestedPage = parsePage((await searchParams).page);

  const [flowerResult, countResult, reservationsResult] = await Promise.all([
    db.query<Flower>(
      `
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
               f.constructor_kind,
               COALESCE(active_reservations.reserved_quantity, 0)::int AS reserved_quantity,
               GREATEST(f.stock_quantity - COALESCE(active_reservations.reserved_quantity, 0), 0)::int AS available_quantity
        FROM public.flowers f
        LEFT JOIN public.categories c ON c.id = f.category_id
        LEFT JOIN LATERAL (
          SELECT sum(quantity)::int AS reserved_quantity
          FROM public.order_stock_reservations
          WHERE flower_id = f.id
            AND status = 'active'
        ) active_reservations ON TRUE
        WHERE f.id = $1::bigint
        LIMIT 1
      `,
      [flowerId],
    ),
    db.query<MovementCount>(
      `
        SELECT count(*)::int AS total
        FROM public.stock_movements
        WHERE flower_id = $1::bigint
      `,
      [flowerId],
    ),
    db.query<ActiveReservation>(
      `
        SELECT r.id::text,
               r.order_id::text,
               o.order_number,
               r.quantity,
               r.reserved_at
        FROM public.order_stock_reservations r
        JOIN public.orders o ON o.id = r.order_id
        WHERE r.flower_id = $1::bigint
          AND r.status = 'active'
        ORDER BY r.reserved_at, r.id
      `,
      [flowerId],
    ),
  ]);

  const flower = flowerResult.rows[0];
  if (!flower) {
    return <MissingFlower />;
  }

  const movementCount = countResult.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(movementCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const movementsResult = await db.query<StockMovement>(
    `
      SELECT sm.id::text,
             sm.movement_type,
             sm.quantity_change,
             sm.unit_cost::text,
             sm.note,
             sm.created_at,
             s.name AS supplier_name,
             sm.purchase_id::text,
             p.document_number,
             sm.order_id::text
      FROM public.stock_movements sm
      LEFT JOIN public.suppliers s ON s.id = sm.supplier_id
      LEFT JOIN public.purchases p ON p.id = sm.purchase_id
      WHERE sm.flower_id = $1::bigint
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT $2 OFFSET $3
    `,
    [flowerId, PAGE_SIZE, (currentPage - 1) * PAGE_SIZE],
  );

  const status = getStockStatus(
    flower.available_quantity,
    flower.min_stock_quantity,
  );

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Складской учёт
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-serif text-4xl md:text-5xl">{flower.name}</h1>
            <Link href="/admin/inventory" className="inline-flex h-12 items-center rounded-2xl border border-[#ead8d1] bg-white px-5 text-sm font-semibold text-[#806e68] transition hover:bg-[#fff4f1]">
              ← Назад на склад
            </Link>
          </div>
          <AdminNavigation />
        </header>

        <section className="mt-8 grid gap-6 rounded-[28px] border border-[#f0dfd9] bg-white p-6 md:grid-cols-[180px_1fr] md:p-8">
          {flower.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flower.image_url} alt={flower.name} className="h-44 w-full rounded-[24px] object-cover" />
          ) : (
            <div className="flex h-44 items-center justify-center rounded-[24px] bg-[#fff0ec] text-6xl" aria-hidden="true">🌸</div>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status.className}`}>
                {status.label}
              </span>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${flower.is_active ? "bg-green-50 text-green-700" : "bg-[#f5ece9] text-[#9a746c]"}`}>
                {flower.is_active ? "Активен" : "Неактивен"}
              </span>
              {flower.constructor_kind && (
                <span className="rounded-full bg-[#fbe5e8] px-3 py-1.5 text-xs font-semibold text-[#9d4255]">
                  Старый конструктор: {{ rose: "Роза", peony: "Пион", tulip: "Тюльпан" }[flower.constructor_kind] ?? flower.constructor_kind}
                </span>
              )}
            </div>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Категория</dt>
                <dd className="mt-1.5">{flower.category_name ?? "Без категории"}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Текущий остаток</dt>
                <dd className="mt-1.5 text-xl font-bold">{flower.stock_quantity} {flower.unit}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Зарезервировано</dt>
                <dd className="mt-1.5 text-xl font-bold text-blue-700">{flower.reserved_quantity} {flower.unit}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Доступно</dt>
                <dd className="mt-1.5 text-xl font-bold text-green-700">{flower.available_quantity} {flower.unit}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Минимум</dt>
                <dd className="mt-1.5">{flower.min_stock_quantity} {flower.unit}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Цена закупки</dt>
                <dd className="mt-1.5">{money(flower.purchase_price)} сом</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Цена продажи</dt>
                <dd className="mt-1.5">{money(flower.sale_price)} сом</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Стоимость запаса</dt>
                <dd className="mt-1.5 font-semibold">{money(flower.stock_quantity * Number(flower.purchase_price))} сом</dd>
              </div>
            </dl>
          </div>
        </section>

        <AdminInventoryControls
          flowerId={flower.id}
          stockQuantity={flower.stock_quantity}
        minimumStock={flower.min_stock_quantity}
        constructorKind={flower.constructor_kind}
        />

        <section className="mt-6 overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white">
          <div className="border-b border-[#f3e6e1] px-6 py-5">
            <h2 className="font-serif text-2xl">Активные резервы</h2>
            <p className="mt-1 text-sm text-[#806e68]">
              Эти цветы уже обещаны подтверждённым заказам и не входят в доступный остаток.
            </p>
          </div>
          {reservationsResult.rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-[#806e68]">Активных резервов нет.</p>
          ) : (
            <div className="divide-y divide-[#f3e6e1]">
              {reservationsResult.rows.map((reservation) => (
                <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                  <div>
                    <Link href={`/admin?q=${encodeURIComponent(reservation.order_number)}`} className="font-semibold text-[#9a5f56] underline decoration-[#dcb4aa] underline-offset-2">
                      Заказ {reservation.order_number}
                    </Link>
                    <p className="mt-1 text-xs text-[#806e68]">{formatDateTime(reservation.reserved_at)}</p>
                  </div>
                  <strong className="text-blue-700">{reservation.quantity} {flower.unit}</strong>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6 overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white">
          <div className="border-b border-[#f3e6e1] px-6 py-5">
            <h2 className="font-serif text-2xl">История движений</h2>
            <p className="mt-1 text-sm text-[#806e68]">
              Всего записей: {movementCount}. Остаток после движения не показывается, поскольку он не хранится в журнале.
            </p>
          </div>

          {movementsResult.rows.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-[#806e68]">
              Движений по этому цветку пока нет.
            </div>
          ) : (
            <div className="divide-y divide-[#f3e6e1]">
              {movementsResult.rows.map((movement) => (
                <article key={movement.id} className="grid gap-4 px-6 py-5 lg:grid-cols-[190px_170px_120px_1fr]">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Дата</p>
                    <p className="mt-1.5 text-sm">{formatDateTime(movement.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Тип</p>
                    <p className="mt-1.5 text-sm font-semibold">
                      {movementLabels[movement.movement_type] ?? movement.movement_type}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Изменение</p>
                    <p className={`mt-1.5 text-lg font-bold ${movement.quantity_change > 0 ? "text-green-700" : "text-red-700"}`}>
                      {movement.quantity_change > 0 ? "+" : ""}{movement.quantity_change}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Связанные данные</p>
                      <div className="mt-1.5 space-y-1 text-sm">
                        {movement.supplier_name && <p>Поставщик: {movement.supplier_name}</p>}
                        {movement.purchase_id && (
                          <p>
                            <Link href={`/admin/purchases/${movement.purchase_id}`} className="font-semibold text-[#9a5f56] underline decoration-[#dcb4aa] underline-offset-2">
                              Поступление {movement.document_number || `№${movement.purchase_id}`}
                            </Link>
                          </p>
                        )}
                        {movement.order_id && <p>Заказ: {movement.order_id}</p>}
                        {!movement.supplier_name && !movement.purchase_id && !movement.order_id && <p className="text-[#99817a]">Нет</p>}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#99817a]">Стоимость и примечание</p>
                      <p className="mt-1.5 text-sm">
                        {movement.unit_cost ? `${money(movement.unit_cost)} сом за единицу` : "Стоимость не указана"}
                      </p>
                      {movement.note && <p className="mt-1 whitespace-pre-line text-sm text-[#806e68]">{movement.note}</p>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav aria-label="Пагинация истории" className="flex items-center justify-between border-t border-[#f3e6e1] px-6 py-5">
              {currentPage > 1 ? (
                <Link href={`?page=${currentPage - 1}`} className="inline-flex min-h-11 items-center rounded-xl border border-[#ead8d1] px-4 text-sm font-semibold text-[#806e68]">
                  ← Назад
                </Link>
              ) : <span />}
              <span className="text-sm text-[#806e68]">Страница {currentPage} из {totalPages}</span>
              {currentPage < totalPages ? (
                <Link href={`?page=${currentPage + 1}`} className="inline-flex min-h-11 items-center rounded-xl bg-[#342622] px-4 text-sm font-semibold text-white">
                  Далее →
                </Link>
              ) : <span />}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}
