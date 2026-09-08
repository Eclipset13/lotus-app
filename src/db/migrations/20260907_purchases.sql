BEGIN;

CREATE TABLE IF NOT EXISTS public.purchases (
    id BIGSERIAL PRIMARY KEY,
    supplier_id BIGINT NOT NULL REFERENCES public.suppliers(id),
    document_number VARCHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    received_at TIMESTAMPTZ,
    note TEXT,
    created_by UUID REFERENCES public.users(id),
    confirmed_by UUID REFERENCES public.users(id),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT purchases_status_check
        CHECK (status IN ('draft', 'posted', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    flower_id BIGINT NOT NULL REFERENCES public.flowers(id),
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT purchase_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT purchase_items_cost_check CHECK (unit_cost > 0),
    CONSTRAINT purchase_items_purchase_flower_key UNIQUE (purchase_id, flower_id)
);

ALTER TABLE public.stock_movements
    ADD COLUMN IF NOT EXISTS purchase_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.stock_movements'::regclass
          AND conname = 'stock_movements_purchase_id_fkey'
    ) THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movements_purchase_id_fkey
            FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS purchases_status_date_idx
    ON public.purchases (status, received_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx
    ON public.purchases (supplier_id);

CREATE INDEX IF NOT EXISTS purchase_items_purchase_id_idx
    ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS purchase_items_flower_id_idx
    ON public.purchase_items (flower_id);

CREATE INDEX IF NOT EXISTS stock_movements_purchase_id_idx
    ON public.stock_movements (purchase_id);

COMMIT;
