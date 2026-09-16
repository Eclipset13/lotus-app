import { requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { AdminNavigation } from "@/components/admin-navigation";
import { BrandLogo } from "@/components/brand-logo";
import { CourierDeliveryActions } from "@/components/courier-delivery-actions";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@/lib/delivery";
export async function CourierDeliveries() {
  const session = await requirePermission("deliveries.read");
  const result = await db.query<{ id: string; order_number: string; recipient_name: string; recipient_phone: string;
    address: string; delivery_comment: string | null; scheduled_at: Date | null; status: DeliveryStatus }>(`
    SELECT d.id::text, o.order_number, d.recipient_name, d.recipient_phone,
      concat_ws(', ', d.city, d.street_address, NULLIF(d.apartment,''), NULLIF(d.entrance,''), NULLIF(d.floor,'')) AS address,
      d.delivery_comment, COALESCE(d.scheduled_at,d.requested_at) AS scheduled_at, d.status
    FROM public.deliveries d JOIN public.orders o ON o.id=d.order_id
    WHERE d.courier_user_id=$1::uuid AND o.fulfillment_type='delivery' AND o.status<>'cancelled'
    ORDER BY COALESCE(d.scheduled_at,d.requested_at) DESC NULLS LAST, d.id`, [session.userId]);
  return <main className="min-h-screen bg-[#fff9f7] px-5 py-8 text-[#342622]"><div className="mx-auto max-w-4xl">
    <BrandLogo /><h1 className="mt-6 font-serif text-4xl">Мои доставки</h1><AdminNavigation />
    {!result.rows.length && <p className="mt-8">Назначенных доставок пока нет.</p>}
    {result.rows.map((delivery) => <article key={delivery.id} className="mt-5 rounded-[28px] border border-[#f0dfd9] bg-white p-6">
      <p className="text-sm text-[#b07b72]">Заказ {delivery.order_number} · {DELIVERY_STATUS_LABELS[delivery.status]}</p>
      <h2 className="mt-2 font-serif text-2xl">{delivery.recipient_name}</h2>
      <a href={`tel:${delivery.recipient_phone}`} className="text-[#b85d70]">{delivery.recipient_phone}</a>
      <p className="mt-3">{delivery.address}</p>
      <p className="mt-2 text-sm">Время: {delivery.scheduled_at ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dushanbe" }).format(delivery.scheduled_at) : "не указано"}</p>
      {delivery.delivery_comment && <p className="mt-2 text-sm">{delivery.delivery_comment}</p>}
      <CourierDeliveryActions deliveryId={delivery.id} status={delivery.status} />
    </article>)}
  </div></main>;
}
