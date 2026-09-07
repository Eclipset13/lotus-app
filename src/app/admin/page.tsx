import { AdminOrderActions } from "@/components/admin-order-actions";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { AdminPaymentActions } from "@/components/admin-payment-actions";
import { AdminFilterSelect } from "@/components/admin-filter-select";
import { AdminNavigation } from "@/components/admin-navigation";
import {
  AdminBouquetViewerProvider,
  AdminBouquetViewButton,
} from "@/components/admin-bouquet-viewer";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import {
  createCustomBouquetSummary,
  formatCustomBouquetComposition,
  sanitizeCustomBouquetConfig,
  sanitizeCustomBouquetSummary,
  type CustomBouquetConfig,
  type CustomBouquetSummary,
} from "@/lib/bouquet";

export const dynamic = "force-dynamic";

type OrderItem = {
  item_type: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  custom_configuration: CustomBouquetConfig | null;
  custom_summary: CustomBouquetSummary | null;
};

type RawOrderItem = Omit<
  OrderItem,
  "custom_configuration" | "custom_summary"
> & {
  custom_configuration: unknown;
  custom_summary: unknown;
};

type AdminOrder = {
  id: string;
  order_number: string;
  status: string;
  fulfillment_type: string;
  total_amount: string;
  customer_comment: string | null;
  created_at: Date;
  customer_name: string;
  customer_phone: string;
  payment_method: string | null;
  payment_status: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  city: string | null;
  street_address: string | null;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  requested_at: Date | null;
  items: RawOrderItem[];
};

const statusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  preparing: "Собирается",
  ready: "Готов",
  delivering: "Доставляется",
  completed: "Выполнен",
  cancelled: "Отменён",
};

const paymentLabels: Record<string, string> = {
  cash: "Наличными",
  transfer: "Переводом",
};

function formatMoney(value: string) {
  return `${Number(value).toLocaleString("ru-RU")} сом`;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Dushanbe",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

type AdminPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    payment?: string;
    sort?: string;
  }>;
};

export default async function AdminPage({
  searchParams,
}: AdminPageProps) {
  const params = await searchParams;

  const searchQuery = (params.q || "").trim().toLowerCase();
  const statusFilter = params.status || "all";
  const paymentFilter = params.payment || "all";
  const sortOrder = params.sort || "newest";
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const result = await db.query<AdminOrder>(`
    SELECT
      o.id::text,
      o.order_number,
      o.status,
      o.fulfillment_type,
      o.total_amount::text,
      o.customer_comment,
      o.created_at,
      u.name AS customer_name,
      u.phone AS customer_phone,
      payment.method AS payment_method,
      payment.status AS payment_status,
      delivery.recipient_name,
      delivery.recipient_phone,
      delivery.city,
      delivery.street_address,
      delivery.apartment,
      delivery.entrance,
      delivery.floor,
      delivery.requested_at,
      COALESCE(order_products.items, '[]'::json) AS items
    FROM orders o
    JOIN users u
      ON u.id = o.customer_id

    LEFT JOIN LATERAL (
      SELECT
        p.method,
        p.status
      FROM payments p
      WHERE p.order_id = o.id
      ORDER BY p.created_at DESC
      LIMIT 1
    ) payment ON true

    LEFT JOIN LATERAL (
      SELECT
        d.recipient_name,
        d.recipient_phone,
        d.city,
        d.street_address,
        d.apartment,
        d.entrance,
        d.floor,
        d.requested_at
      FROM deliveries d
      WHERE d.order_id = o.id
      ORDER BY d.created_at DESC
      LIMIT 1
    ) delivery ON true

    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'item_type', oi.item_type,
          'product_name', oi.product_name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price::text,
          'custom_configuration', to_jsonb(oi) -> 'custom_configuration',
          'custom_summary', to_jsonb(oi) -> 'custom_summary',
          'line_total',
            COALESCE(
              oi.line_total,
              oi.unit_price * oi.quantity
            )::text
        )
        ORDER BY oi.id
      ) AS items
      FROM order_items oi
      WHERE oi.order_id = o.id
    ) order_products ON true

    ORDER BY o.created_at DESC
  `);

  const allOrders = result.rows.map((order) => ({
    ...order,
    items: order.items.map((item, itemIndex): OrderItem => {
      if (item.item_type !== "custom_bouquet") {
        return {
          ...item,
          custom_configuration: null,
          custom_summary: null,
        };
      }

      const configuration = sanitizeCustomBouquetConfig(
        item.custom_configuration,
      );
      const storedSummary = sanitizeCustomBouquetSummary(item.custom_summary);

      if (!configuration) {
        console.error("Invalid custom bouquet configuration in admin order:", {
          orderId: order.id,
          orderNumber: order.order_number,
          itemIndex,
        });
      }

      return {
        ...item,
        custom_configuration: configuration,
        custom_summary:
          storedSummary ??
          (configuration ? createCustomBouquetSummary(configuration) : null),
      };
    }),
  }));

  const filteredOrders = allOrders.filter((order) => {
    const matchesSearch =
      !searchQuery ||
      [
        order.order_number,
        order.customer_name,
        order.customer_phone,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(searchQuery)
      );

    const matchesStatus =
      statusFilter === "all" ||
      order.status === statusFilter;

    const currentPaymentStatus =
      order.payment_status || "pending";

    const matchesPayment =
      paymentFilter === "all" ||
      currentPaymentStatus === paymentFilter;

    return matchesSearch && matchesStatus && matchesPayment;
  });

  const orders = [...filteredOrders].sort((firstOrder, secondOrder) => {
    switch (sortOrder) {
      case "oldest":
        return (
          new Date(firstOrder.created_at).getTime() -
          new Date(secondOrder.created_at).getTime()
        );

      case "expensive":
        return (
          Number(secondOrder.total_amount) -
          Number(firstOrder.total_amount)
        );

      case "cheap":
        return (
          Number(firstOrder.total_amount) -
          Number(secondOrder.total_amount)
        );

      case "newest":
      default:
        return (
          new Date(secondOrder.created_at).getTime() -
          new Date(firstOrder.created_at).getTime()
        );
    }
  });

  const activeStatuses = [
    "confirmed",
    "preparing",
    "ready",
    "delivering",
  ];

  const statistics = {
    newOrders: allOrders.filter(
      (order) => order.status === "new"
    ).length,

    activeOrders: allOrders.filter((order) =>
      activeStatuses.includes(order.status)
    ).length,

    paidRevenue: allOrders
      .filter(
        (order) =>
          order.payment_status === "paid" &&
          order.status !== "cancelled"
      )
      .reduce(
        (total, order) => total + Number(order.total_amount),
        0
      ),

    completedOrders: allOrders.filter(
      (order) => order.status === "completed"
    ).length,
  };

  return (
    <AdminBouquetViewerProvider>
      <main className="min-h-screen bg-[#fff7f4] px-5 py-8 text-[#342622]">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <BrandLogo />

            <p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-[#b85d70]">
              Панель управления
            </p>

            <h1 className="mt-2 font-serif text-4xl md:text-5xl">
              Заказы
            </h1>

            <p className="mt-2 text-[#806e68]">
              Всего заказов: {orders.length}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-[#ead8d2] bg-white px-5 py-3 text-sm"
            >
              Открыть магазин
            </Link>

            <form action="/api/admin/logout" method="post">
              <button
                type="submit"
                className="rounded-full bg-[#342622] px-5 py-3 text-sm text-white"
              >
                Выйти
              </button>
            </form>
          </div>
          <AdminNavigation />
        </header>

        <section className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="relative overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white p-6">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[#fff0f2]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  Новые заказы
                </p>

                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff0f2] text-xl">
                  🌷
                </span>
              </div>

              <strong className="mt-6 block font-serif text-4xl">
                {statistics.newOrders}
              </strong>

              <p className="mt-2 text-sm text-[#806e68]">
                Ожидают подтверждения
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white p-6">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[#fff6df]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  В работе
                </p>

                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff6df] text-xl">
                  ✨
                </span>
              </div>

              <strong className="mt-6 block font-serif text-4xl">
                {statistics.activeOrders}
              </strong>

              <p className="mt-2 text-sm text-[#806e68]">
                Собираются или доставляются
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white p-6">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[#eaf8ee]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  Оплачено
                </p>

                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eaf8ee] text-xl">
                  💳
                </span>
              </div>

              <strong className="mt-6 block font-serif text-3xl">
                {formatMoney(statistics.paidRevenue.toString())}
              </strong>

              <p className="mt-2 text-sm text-[#806e68]">
                Сумма оплаченных заказов
              </p>
            </div>
          </article>

          <article className="relative overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white p-6">
            <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-[#f3edff]" />

            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  Выполнено
                </p>

                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f3edff] text-xl">
                  ✓
                </span>
              </div>

              <strong className="mt-6 block font-serif text-4xl">
                {statistics.completedOrders}
              </strong>

              <p className="mt-2 text-sm text-[#806e68]">
                Успешно завершённых заказов
              </p>
            </div>
          </article>
        </section>

        <section className="mt-6 rounded-[28px] border border-[#f0dfd9] bg-white p-5 md:p-6">
          <form
            method="GET"
            action="/admin"
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_200px_200px_210px_auto]"
          >
            <label>
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                Найти заказ
              </span>

              <input
                type="search"
                name="q"
                defaultValue={params.q || ""}
                placeholder="Номер, имя или телефон"
                className="h-12 w-full rounded-2xl border border-[#ead8d1] bg-[#fffaf8] px-4 text-sm outline-none transition placeholder:text-[#b5a09a] focus:border-[#d89b91] focus:ring-4 focus:ring-[#d89b91]/10"
              />
            </label>

            <label>
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  Статус заказа
                </span>

                <AdminFilterSelect
                  key={`status-${statusFilter}`}
                  name="status"
                  value={statusFilter}
                  ariaLabel="Выбрать статус заказа"
                  options={[
                    { value: "all", label: "Все статусы" },
                    { value: "new", label: "Новый" },
                    { value: "confirmed", label: "Подтверждён" },
                    { value: "preparing", label: "Собирается" },
                    { value: "ready", label: "Готов" },
                    { value: "delivering", label: "Доставляется" },
                    { value: "completed", label: "Выполнен" },
                    { value: "cancelled", label: "Отменён" },
                  ]}
                />
              </div>
            </label>

            <label>
              <div>
                <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                  Оплата
                </span>

                <AdminFilterSelect
                  key={`payment-${paymentFilter}`}
                  name="payment"
                  value={paymentFilter}
                  ariaLabel="Выбрать статус оплаты"
                  options={[
                    { value: "all", label: "Любая оплата" },
                    { value: "pending", label: "Ожидает оплаты" },
                    { value: "paid", label: "Оплачен" },
                  ]}
                />
              </div>
            </label>

            <div>
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#99817a]">
                Сортировка
              </span>

              <AdminFilterSelect
                key={`sort-${sortOrder}`}
                name="sort"
                value={sortOrder}
                ariaLabel="Выбрать сортировку заказов"
                options={[
                  { value: "newest", label: "Сначала новые" },
                  { value: "oldest", label: "Сначала старые" },
                  { value: "expensive", label: "Сначала дорогие" },
                  { value: "cheap", label: "Сначала дешёвые" },
                ]}
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="h-12 rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white transition hover:bg-[#4b3731]"
              >
                Показать
              </button>

              <a
                href="/admin"
                className="flex h-12 items-center justify-center rounded-2xl border border-[#ead8d1] px-5 text-sm font-medium text-[#806e68] transition hover:bg-[#fff5f2]"
              >
                Сбросить
              </a>
            </div>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#f3e6e1] pt-4">
            <p className="text-sm text-[#806e68]">
              Найдено заказов:{" "}
              <strong className="text-[#342622]">{orders.length}</strong>
            </p>

            {(searchQuery ||
              statusFilter !== "all" ||
              paymentFilter !== "all") && (
                <p className="text-xs font-medium text-[#b07b72]">
                  Применены фильтры
                </p>
              )}
          </div>
        </section>

        {orders.length === 0 ? (
          <section className="mt-10 rounded-[32px] border border-[#f0dfd9] bg-white p-12 text-center">
            <div className="text-6xl">🌷</div>

            <h2 className="font-serif text-2xl">
              {allOrders.length === 0
                ? "Заказов пока нет"
                : "Ничего не найдено"}
            </h2>

            <p className="mt-2 text-sm text-[#806e68]">
              {allOrders.length === 0
                ? "Новые заказы появятся здесь автоматически."
                : "Попробуйте изменить запрос или сбросить фильтры."}
            </p>

            <p className="mt-2 text-[#806e68]">
              Новые заказы покупателей появятся здесь автоматически.
            </p>
          </section>
        ) : (
          <div className="mt-10 space-y-6">
            {orders.map((order) => (
              <article
                key={order.id}
                className="overflow-hidden rounded-[30px] border border-[#f0dfd9] bg-white"
              >
                <div className="flex flex-wrap items-start justify-between gap-5 border-b border-[#f0dfd9] p-6 md:p-8">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#b85d70]">
                      {formatDate(order.created_at)}
                    </p>

                    <h2 className="mt-2 font-serif text-3xl">
                      {order.order_number}
                    </h2>
                  </div>

                  <div className="text-right">
                    <span className="inline-block rounded-full bg-[#fbe5e8] px-4 py-2 text-sm text-[#9d4255]">
                      {statusLabels[order.status] || order.status}
                    </span>

                    <strong className="mt-3 block text-2xl">
                      {formatMoney(order.total_amount)}
                    </strong>
                  </div>
                </div>

                <div className="grid gap-8 p-6 md:grid-cols-3 md:p-8">
                  <section>
                    <h3 className="font-serif text-xl">Покупатель</h3>

                    <p className="mt-4 font-medium">
                      {order.customer_name}
                    </p>

                    <a
                      href={`tel:${order.customer_phone}`}
                      className="mt-1 block text-[#b85d70]"
                    >
                      {order.customer_phone}
                    </a>

                    <p className="mt-4 text-sm text-[#806e68]">
                      Оплата:{" "}
                      {paymentLabels[order.payment_method || ""] ||
                        order.payment_method ||
                        "Не указана"}
                    </p>

                    <p className="mt-1 text-sm text-[#806e68]">
                      Статус оплаты:{" "}
                      {order.payment_status === "paid"
                        ? "Оплачен"
                        : "Ожидает оплаты"}
                    </p>
                  </section>

                  <section>
                    <h3 className="font-serif text-xl">Получение</h3>

                    {order.fulfillment_type === "pickup" ? (
                      <p className="mt-4 text-[#806e68]">
                        Самовывоз
                      </p>
                    ) : (
                      <div className="mt-4 space-y-1 text-sm text-[#806e68]">
                        <p>
                          Получатель:{" "}
                          {order.recipient_name ||
                            order.customer_name}
                        </p>

                        <p>
                          Телефон:{" "}
                          {order.recipient_phone ||
                            order.customer_phone}
                        </p>

                        <p>
                          {order.city}, {order.street_address}
                        </p>

                        {(order.apartment ||
                          order.entrance ||
                          order.floor) && (
                            <p>
                              Кв. {order.apartment || "—"},{" "}
                              подъезд {order.entrance || "—"},{" "}
                              этаж {order.floor || "—"}
                            </p>
                          )}

                        {order.requested_at && (
                          <p className="pt-2">
                            Желаемое время:{" "}
                            {formatDate(order.requested_at)}
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="font-serif text-xl">Состав заказа</h3>

                    <div className="mt-4 space-y-3">
                      {order.items.map((item, index) => (
                        <div
                          key={`${item.product_name}-${index}`}
                          className="rounded-2xl border border-[#f0dfd9] bg-[#fffaf8] p-3 text-sm"
                        >
                          <div className="flex justify-between gap-4">
                            <span>
                              {item.product_name} × {item.quantity}
                            </span>

                            <strong>
                              {formatMoney(item.line_total)}
                            </strong>
                          </div>

                          {item.item_type === "custom_bouquet" && (
                            <div className="mt-2 text-xs leading-5 text-[#806e68]">
                              {item.custom_summary ? (
                                <>
                                  <p>
                                    {formatCustomBouquetComposition(item.custom_summary)}
                                  </p>
                                  <p>
                                    Упаковка: {item.custom_summary.wrappingName}
                                  </p>
                                  <p>
                                    Цена за один: {formatMoney(item.unit_price)}
                                  </p>
                                </>
                              ) : (
                                <p className="text-[#a45d69]">
                                  Данные о составе недоступны
                                </p>
                              )}

                              <AdminBouquetViewButton
                                configuration={item.custom_configuration}
                                summary={item.custom_summary}
                                itemLabel={`Заказ ${order.order_number} · позиция ${index + 1}`}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="border-t border-[#f0dfd9] bg-[#fffdfc] px-6 py-5 md:px-8">
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                    <AdminPaymentActions
                      orderId={order.id}
                      currentStatus={order.payment_status || "pending"}
                    />

                    <AdminOrderActions
                      orderId={order.id}
                      currentStatus={order.status}
                    />
                  </div>
                </div>

                {order.customer_comment && (
                  <div className="border-t border-[#f0dfd9] bg-[#fffaf8] px-6 py-4 text-sm md:px-8">
                    <strong>Пожелание клиента: </strong>
                    {order.customer_comment}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
      </main>
    </AdminBouquetViewerProvider>
  );
}
