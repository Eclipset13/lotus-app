import Link from "next/link";
import { AdminFlowerDetailsForm } from "@/components/admin-flower-details-form";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Category = { id: string; name: string; is_active: boolean };

export default async function NewFlowerPage() {
  await requirePermission("inventory.manage");
  const categories = await db.query<Category>(`
    SELECT id::text, name, is_active
    FROM public.categories
    ORDER BY sort_order, name
  `);
  return (
    <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12">
      <div className="mx-auto max-w-5xl">
        <header>
          <BrandLogo />
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Склад</p>
          <h1 className="mt-3 font-serif text-4xl md:text-5xl">Добавить цветок</h1>
          <AdminNavigation />
          <Link href="/admin/inventory" className="mt-6 inline-flex text-sm font-semibold text-[#9f5f56] hover:underline">← Вернуться на склад</Link>
        </header>
        <div className="mt-8"><AdminFlowerDetailsForm categories={categories.rows} /></div>
      </div>
    </main>
  );
}
