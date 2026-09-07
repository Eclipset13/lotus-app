BEGIN;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS custom_configuration JSONB,
  ADD COLUMN IF NOT EXISTS custom_summary JSONB;

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_type_check,
  DROP CONSTRAINT IF EXISTS order_items_product_check;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_type_check
    CHECK (item_type IN ('flower', 'bouquet', 'custom_bouquet')),
  ADD CONSTRAINT order_items_product_check
    CHECK (
      (
        item_type = 'flower'
        AND flower_id IS NOT NULL
        AND bouquet_id IS NULL
        AND custom_configuration IS NULL
        AND custom_summary IS NULL
      )
      OR
      (
        item_type = 'bouquet'
        AND bouquet_id IS NOT NULL
        AND flower_id IS NULL
        AND custom_configuration IS NULL
        AND custom_summary IS NULL
      )
      OR
      (
        item_type = 'custom_bouquet'
        AND bouquet_id IS NULL
        AND flower_id IS NULL
        AND custom_configuration IS NOT NULL
        AND custom_summary IS NOT NULL
      )
    );

COMMIT;
