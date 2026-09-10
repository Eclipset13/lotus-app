BEGIN;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS bouquet_composition_snapshot JSONB;

UPDATE public.order_items AS order_item
SET bouquet_composition_snapshot = jsonb_build_object(
    'version', 1,
    'flowers', (
        SELECT jsonb_agg(
            jsonb_build_object(
                'flowerId', flower.id::text,
                'name', btrim(flower.name),
                'quantity', bouquet_item.quantity
            )
            ORDER BY bouquet_item.flower_id
        )
        FROM public.bouquet_items AS bouquet_item
        INNER JOIN public.flowers AS flower
            ON flower.id = bouquet_item.flower_id
        WHERE bouquet_item.bouquet_id = order_item.bouquet_id
    )
)
WHERE order_item.item_type = 'bouquet'
  AND order_item.bouquet_id IS NOT NULL
  AND order_item.bouquet_composition_snapshot IS NULL
  AND EXISTS (
      SELECT 1
      FROM public.bouquet_items AS bouquet_item
      INNER JOIN public.flowers AS flower
          ON flower.id = bouquet_item.flower_id
      WHERE bouquet_item.bouquet_id = order_item.bouquet_id
        AND bouquet_item.quantity > 0
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.bouquet_items AS bouquet_item
      LEFT JOIN public.flowers AS flower
          ON flower.id = bouquet_item.flower_id
      WHERE bouquet_item.bouquet_id = order_item.bouquet_id
        AND (
            flower.id IS NULL
            OR flower.name IS NULL
            OR btrim(flower.name) = ''
            OR bouquet_item.quantity <= 0
        )
  );

COMMIT;
