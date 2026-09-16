import Link from "next/link";
import { AdminCategoryManager } from "@/components/admin-category-manager";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Category = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
  flower_count: number;
};

export default async function FlowerCategoriesPage() {
  await requirePermission("inventory.manage");
  const categories = await db.query<Category>(`
    SELECT c.id::text, c.name, c.slug, c.sort_order, c.is_active,
           count(f.id)::int AS flower_count
    FROM public.categories c
    LEFT JOIN public.flowers f ON f.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `);
  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Склад</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Категории цветов</h1>
          <p className="mt-3 text-sm leading-6 text-[#806e68]">Категорию, к которой привязаны цветы, удалить нельзя.</p>
          <AdminNavigation />
          <Link href="/admin/inventory" className="mt-6 inline-flex text-sm font-semibold text-[#9f5f56] hover:underline">← Вернуться на склад</Link>
        </header>
        <AdminCategoryManager categories={categories.rows} />
      </div>
    </main>
  );
}
