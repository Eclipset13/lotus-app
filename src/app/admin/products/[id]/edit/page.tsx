import { notFound, redirect } from "next/navigation";
import { AdminNavigation } from "@/components/admin-navigation";
import {
  AdminProductForm,
  type ProductCompositionItem,
  type ProductFlowerOption,
} from "@/components/admin-product-form";
import { BrandLogo } from "@/components/brand-logo";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { updateProduct } from "../../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BIGINT = "9223372036854775807";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  is_active: boolean;
};

type FlowerRow = {
  id: string;
  name: string;
  unit: string;
  stock_quantity: number;
  is_active: boolean;
};

type CompositionRow = { flower_id: string; quantity: number };

function isDatabaseId(value: string) {
  return (
    /^[1-9]\d{0,18}$/.test(value) &&
    (value.length < MAX_BIGINT.length || value <= MAX_BIGINT)
  );
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  const { id } = await params;
  if (!isDatabaseId(id)) notFound();

  const [productResult, flowersResult, compositionResult] = await Promise.all([
    db.query<Product>(
      `
        SELECT id::text, name, description, sale_price::text AS price,
               image_url, is_active
        FROM public.bouquets
        WHERE id = $1::bigint
        LIMIT 1
      `,
      [id],
    ),
    db.query<FlowerRow>(`
      SELECT id::text, name, unit, stock_quantity, is_active
      FROM public.flowers
      ORDER BY is_active DESC, name
    `),
    db.query<CompositionRow>(
      `
        SELECT flower_id::text, quantity
        FROM public.bouquet_items
        WHERE bouquet_id = $1::bigint
        ORDER BY flower_id
      `,
      [id],
    ),
  ]);
  const product = productResult.rows[0];
  if (!product) notFound();

  const flowers: ProductFlowerOption[] = flowersResult.rows.map((flower) => ({
    id: flower.id,
    name: flower.name,
    unit: flower.unit,
    stockQuantity: flower.stock_quantity,
    isActive: flower.is_active,
  }));
  const composition: ProductCompositionItem[] = compositionResult.rows.map(
    (item) => ({ flowerId: item.flower_id, quantity: item.quantity }),
  );
  const updateCurrentProduct = updateProduct.bind(null, product.id);

  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Панель управления</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Редактирование букета</h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">Измените данные и складской состав букета.</p>
          <AdminNavigation />
        </header>

        <AdminProductForm
          action={updateCurrentProduct}
          flowers={flowers}
          initialValues={{
            name: product.name,
            description: product.description ?? "",
            price: product.price,
            imageUrl: product.image_url ?? "",
            isActive: product.is_active,
            composition,
          }}
          submitLabel="Сохранить изменения"
        />
      </div>
    </main>
  );
}
