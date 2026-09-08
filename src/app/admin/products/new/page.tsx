import { redirect } from "next/navigation";
import { AdminNavigation } from "@/components/admin-navigation";
import { AdminProductForm, type ProductFlowerOption } from "@/components/admin-product-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { createProduct } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FlowerRow = {
  id: string;
  name: string;
  unit: string;
  stock_quantity: number;
  is_active: boolean;
};

export default async function NewProductPage() {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");

  const flowersResult = await db.query<FlowerRow>(`
    SELECT id::text, name, unit, stock_quantity, is_active
    FROM public.flowers
    ORDER BY is_active DESC, name
  `);
  const flowers: ProductFlowerOption[] = flowersResult.rows.map((flower) => ({
    id: flower.id,
    name: flower.name,
    unit: flower.unit,
    stockQuantity: flower.stock_quantity,
    isActive: flower.is_active,
  }));

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Панель управления</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Новый букет</h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">Добавьте информацию о букете и настройте его складской состав.</p>
          <AdminNavigation />
        </header>

        <AdminProductForm
          action={createProduct}
          flowers={flowers}
          initialValues={{
            name: "",
            description: "",
            price: "",
            imageUrl: "",
            isActive: true,
            composition: [],
          }}
          submitLabel="Сохранить букет"
        />
      </div>
    </main>
  );
}
