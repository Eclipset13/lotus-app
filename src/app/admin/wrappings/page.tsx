import { AdminNavigation } from "@/components/admin-navigation";
import { AdminWrappingManager, type AdminWrapping } from "@/components/admin-wrapping-manager";
import { BrandLogo } from "@/components/brand-logo";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WrappingsPage() {
  await requirePermission("products.manage");
  const result = await db.query<AdminWrapping>(`SELECT id::text,slug,name,subtitle,color,ribbon_color,
    sale_price::text,opacity::text,sort_order,is_active,has_been_active
    FROM public.constructor_wrappings ORDER BY sort_order,id`);
  return <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622] md:px-10 md:py-12"><div className="mx-auto max-w-7xl"><header><BrandLogo /><p className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-[#b07b72]">Конструктор</p><h1 className="mt-3 font-serif text-4xl md:text-5xl">Упаковки</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#806e68]">Цены и оформление активных вариантов загружаются в конструктор из PostgreSQL.</p><AdminNavigation /></header><AdminWrappingManager wrappings={result.rows} /></div></main>;
}
