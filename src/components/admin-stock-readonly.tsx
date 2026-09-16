import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
export async function AdminStockReadonly({ flowerId }: { flowerId?: string }) {
  await requirePermission("inventory.read");
  if (flowerId && (!/^[1-9]\d{0,18}$/.test(flowerId) || BigInt(flowerId) > BigInt("9223372036854775807"))) notFound();
  // Purchase costs, suppliers, movements and order data never enter the client payload.
  const flowers = await db.query<{ id: string; name: string; available: number; sale_price: string; unit: string }>(`
    SELECT f.id::text, f.name, f.sale_price::text, f.unit,
      GREATEST(f.stock_quantity - COALESCE((SELECT sum(r.quantity) FROM public.order_stock_reservations r
        WHERE r.flower_id=f.id AND r.status='active'),0),0)::int AS available
    FROM public.flowers f WHERE f.is_active=true AND ($1::bigint IS NULL OR f.id=$1::bigint) ORDER BY f.name`, [flowerId ?? null]);
  if (flowerId && !flowers.rows.length) notFound();
  return <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622]"><div className="mx-auto max-w-5xl">
    <BrandLogo /><h1 className="mt-6 font-serif text-4xl">Доступные остатки</h1><AdminNavigation />
    <section className="mt-6 divide-y divide-[#f0dfd9] rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      {flowers.rows.map((flower) => <article key={flower.id} className="flex flex-wrap justify-between gap-4 py-4">
        <Link href={`/admin/inventory/${flower.id}`} className="font-semibold">{flower.name}</Link>
        <p>Доступно: {flower.available} {flower.unit} · Продажа: {flower.sale_price} сом</p>
      </article>)}
      {!flowers.rows.length && <p>Доступных цветов пока нет.</p>}
    </section>
  </div></main>;
}
