import { redirect } from "next/navigation";
import { createPurchase } from "../actions";
import { AdminNavigation } from "@/components/admin-navigation";
import {
  AdminPurchaseForm,
  type PurchaseFlowerOption,
  type PurchaseSupplierOption,
} from "@/components/admin-purchase-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupplierRow = { id: string; name: string; is_active: boolean };
type FlowerRow = {
  id: string;
  name: string;
  stock_quantity: number;
  purchase_price: string;
  is_active: boolean;
};

export default async function NewPurchasePage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const [suppliersResult, flowersResult] = await Promise.all([
    db.query<SupplierRow>(`
      SELECT id::text, name, is_active
      FROM public.suppliers
      WHERE is_active = TRUE
      ORDER BY name
    `),
    db.query<FlowerRow>(`
      SELECT id::text, name, stock_quantity, purchase_price::text, is_active
      FROM public.flowers
      WHERE is_active = TRUE
      ORDER BY name
    `),
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

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-7xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">
            Панель управления
          </p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">
            Новое поступление
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">
            Сохраните документ как черновик, затем проведите его после проверки.
          </p>
          <AdminNavigation />
        </header>

        <AdminPurchaseForm
          action={createPurchase}
          suppliers={suppliers}
          flowers={flowers}
          submitLabel="Сохранить черновик"
        />
      </div>
    </main>
  );
}
