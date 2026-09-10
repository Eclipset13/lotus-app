BEGIN;

UPDATE public.deliveries AS delivery
SET status = 'cancelled',
    updated_at = NOW()
FROM public.orders AS customer_order
WHERE customer_order.id = delivery.order_id
  AND customer_order.status = 'cancelled'
  AND delivery.status IN ('planned', 'assigned', 'on_the_way');

COMMIT;
