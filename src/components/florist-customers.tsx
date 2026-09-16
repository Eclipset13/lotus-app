import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { nonAdminUserSql } from "@/lib/customers";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
export async function FloristCustomers({ query }: { query: string }) {
  await requirePermission("customers.read");
  const result = await db.query<{ id: string; name: string; phone: string }>(`
    SELECT u.id::text,u.name,u.phone FROM public.users u WHERE ${nonAdminUserSql}
      AND EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id=u.id)
      AND (u.name ILIKE $1 OR u.phone ILIKE $1) ORDER BY u.name LIMIT 200`, [`%${query.slice(0,120)}%`]);
  return <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622]"><div className="mx-auto max-w-5xl">
    <BrandLogo /><h1 className="mt-6 font-serif text-4xl">Покупатели заказов</h1><AdminNavigation />
    <form className="mt-6 flex flex-wrap gap-3"><input name="q" defaultValue={query} placeholder="Имя или телефон" aria-label="Поиск покупателей" maxLength={120} className="rounded-2xl border border-[#ead8d1] bg-white px-4 py-3" /><button type="submit" className="rounded-full bg-[#342622] px-5 py-3 text-white">Найти</button></form>
    <section className="mt-6 divide-y divide-[#f0dfd9] rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      {result.rows.map((customer) => <article key={customer.id} className="flex flex-wrap justify-between gap-3 py-3"><strong>{customer.name}</strong><a href={`tel:${customer.phone}`} className="text-[#b85d70]">{customer.phone}</a></article>)}
      {!result.rows.length && <p>Покупатели не найдены.</p>}
    </section>
  </div></main>;
}
