import Link from "next/link";
import { redirect } from "next/navigation";
import { updatePurchase } from "../actions";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminPurchaseActions } from "@/components/admin-purchase-actions";
import {
  AdminPurchaseForm,
  type PurchaseFlowerOption,
  type PurchaseFormValues,
  type PurchaseSupplierOption,
} from "@/components/admin-purchase-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Purchase = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  document_number: string | null;
  status: "draft" | "posted" | "cancelled";
  received_at: Date | null;
  note: string | null;
  confirmed_at: Date | null;
  created_at: Date;
};

type PurchaseItem = {
  flower_id: string;
  flower_name: string;
  quantity: number;
  unit_cost: string;
};

type SupplierRow = { id: string; name: string; is_active: boolean };
type FlowerRow = {
  id: string;
  name: string;
  stock_quantity: number;
  purchase_price: string;
  is_active: boolean;
};

const MAX_BIGINT = "9223372036854775807";

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

function formatDate(value: Date, includeTime = false) {
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
  };
  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }
  return new Intl.DateTimeFormat("ru-RU", options).format(value);
}

function dateInputValue(value: Date | null) {
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function MissingPurchase() {
  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <BrandLogo />
        <AdminNavigation />
        <section className="mt-8 rounded-[28px] border border-[#f0dfd9] bg-white px-6 py-16 text-center">
          <h1 className="font-serif text-4xl">Поступление не найдено</h1>
          <Link
            href="/admin/purchases"
            className="mt-7 inline-flex h-12 items-center rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white"
          >
            К поступлениям
          </Link>
        </section>
      </div>
    </main>
  );
}

export default async function PurchasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const { id } = await params;
  if (!isDatabaseId(id)) {
    return <MissingPurchase />;
  }

  const [purchaseResult, itemsResult] = await Promise.all([
    db.query<Purchase>(
      `
        SELECT p.id::text,
               p.supplier_id::text,
               s.name AS supplier_name,
               p.document_number,
               p.status,
               p.received_at,
               p.note,
               p.confirmed_at,
               p.created_at
        FROM public.purchases p
        JOIN public.suppliers s ON s.id = p.supplier_id
        WHERE p.id = $1::bigint
        LIMIT 1
      `,
      [id],
    ),
    db.query<PurchaseItem>(
      `
        SELECT pi.flower_id::text,
               f.name AS flower_name,
               pi.quantity,
               pi.unit_cost::text
        FROM public.purchase_items pi
        JOIN public.flowers f ON f.id = pi.flower_id
        WHERE pi.purchase_id = $1::bigint
        ORDER BY pi.id
      `,
      [id],
    ),
  ]);

  const purchase = purchaseResult.rows[0];
  if (!purchase) {
    return <MissingPurchase />;
  }
  const items = itemsResult.rows;

  if (purchase.status === "draft") {
    const itemIds = items.map((item) => item.flower_id);
    const [suppliersResult, flowersResult] = await Promise.all([
      db.query<SupplierRow>(
        `
          SELECT id::text, name, is_active
          FROM public.suppliers
          WHERE is_active = TRUE OR id = $1::bigint
          ORDER BY is_active DESC, name
        `,
        [purchase.supplier_id],
      ),
      db.query<FlowerRow>(
        `
          SELECT id::text, name, stock_quantity, purchase_price::text, is_active
          FROM public.flowers
          WHERE is_active = TRUE OR id = ANY($1::bigint[])
          ORDER BY is_active DESC, name
        `,
        [itemIds],
      ),
    ]);

    const suppliers: PurchaseSupplierOption[] = suppliersResult.rows.map(
      (supplier) => ({
        id: supplier.id,
        name: supplier.name,
        isActive: supplier.is_active,
      }),
    );
    const flowers: PurchaseFlowerOption[] = flowersResult.rows.map((flower) => ({
      id: flower.id,
      name: flower.name,
      stockQuantity: flower.stock_quantity,
      purchasePrice: Number(flower.purchase_price),
      isActive: flower.is_active,
    }));
    const values: PurchaseFormValues = {
      supplierId: purchase.supplier_id,
      documentNumber: purchase.document_number ?? "",
      receivedAt: dateInputValue(purchase.received_at),
      note: purchase.note ?? "",
      items: items.map((item) => ({
        flowerId: item.flower_id,
        quantity: String(item.quantity),
        unitCost: Number(item.unit_cost).toFixed(2),
      })),
    };
    const updateCurrentPurchase = updatePurchase.bind(null, purchase.id);

    return (
      <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
        <div className="mx-auto max-w-7xl">
          <header>
            <BrandLogo />
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
              Черновик поступления
            </p>
            <h1 className="mt-3 font-serif text-4xl md:text-5xl">
              {purchase.document_number || `Поступление №${purchase.id}`}
            </h1>
            <AdminNavigation />
          </header>
          <AdminPurchaseForm
            action={updateCurrentPurchase}
            suppliers={suppliers}
            flowers={flowers}
            values={values}
            submitLabel="Сохранить черновик"
          />
          <AdminPurchaseActions purchaseId={purchase.id} />
        </div>
      </main>
    );
  }

  const total = items.reduce(
    (sum, item) => sum + item.quantity * Number(item.unit_cost),
    0,
  );
  const isPosted = purchase.status === "posted";

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header>
          <BrandLogo />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${isPosted ? "bg-green-50 text-green-700" : "bg-[#f5ece9] text-[#9a746c]"}`}>
              {isPosted ? "Проведено" : "Отменено"}
            </span>
            <span className="text-sm text-[#806e68]">Только для чтения</span>
          </div>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">
            {purchase.document_number || `Поступление №${purchase.id}`}
          </h1>
          <AdminNavigation />
        </header>

        <section className="mt-8 rounded-[28px] border border-[#f0dfd9] bg-white p-6 md:p-8">
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Поставщик</dt>
              <dd className="mt-2 font-semibold">{purchase.supplier_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Дата поступления</dt>
              <dd className="mt-2">{formatDate(purchase.received_at ?? purchase.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Дата проведения</dt>
              <dd className="mt-2">{purchase.confirmed_at ? formatDate(purchase.confirmed_at, true) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Итого</dt>
              <dd className="mt-2 text-xl font-bold">{money(total)} ₽</dd>
            </div>
          </dl>
          {purchase.note && (
            <div className="mt-6 border-t border-[#f3e6e1] pt-5">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-[#99817a]">Примечание</p>
              <p className="mt-2 whitespace-pre-line text-sm leading-6">{purchase.note}</p>
            </div>
          )}
        </section>

        <section className="mt-5 overflow-hidden rounded-[28px] border border-[#f0dfd9] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-[#fff4f1] text-xs uppercase tracking-[0.13em] text-[#99817a]">
                <tr>
                  <th className="px-6 py-4">Цветок</th>
                  <th className="px-6 py-4">Количество</th>
                  <th className="px-6 py-4">Цена закупки</th>
                  <th className="px-6 py-4">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3e6e1]">
                {items.map((item) => (
                  <tr key={item.flower_id}>
                    <td className="px-6 py-4 font-semibold">{item.flower_name}</td>
                    <td className="px-6 py-4">{item.quantity}</td>
                    <td className="px-6 py-4">{money(Number(item.unit_cost))} ₽</td>
                    <td className="px-6 py-4 font-semibold">
                      {money(item.quantity * Number(item.unit_cost))} ₽
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-5 flex justify-end">
          <Link
            href="/admin/purchases"
            className="inline-flex h-12 items-center rounded-2xl bg-[#342622] px-6 text-sm font-semibold text-white"
          >
            К поступлениям
          </Link>
        </div>
      </div>
    </main>
  );
}
