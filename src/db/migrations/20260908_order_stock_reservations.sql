BEGIN;

CREATE TABLE IF NOT EXISTS public.order_stock_reservations (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES public.orders(id),
    flower_id BIGINT NOT NULL REFERENCES public.flowers(id),
    quantity INTEGER NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT order_stock_reservations_quantity_check CHECK (quantity > 0),
    CONSTRAINT order_stock_reservations_status_check
        CHECK (status IN ('active', 'consumed', 'released')),
    CONSTRAINT order_stock_reservations_order_flower_key
        UNIQUE (order_id, flower_id)
);

ALTER TABLE public.stock_movements
    ADD COLUMN IF NOT EXISTS reservation_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.stock_movements'::regclass
          AND conname = 'stock_movements_reservation_id_fkey'
    ) THEN
        ALTER TABLE public.stock_movements
            ADD CONSTRAINT stock_movements_reservation_id_fkey
            FOREIGN KEY (reservation_id)
            REFERENCES public.order_stock_reservations(id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS order_stock_reservations_order_id_idx
    ON public.order_stock_reservations (order_id);

CREATE INDEX IF NOT EXISTS order_stock_reservations_flower_id_idx
    ON public.order_stock_reservations (flower_id);

CREATE INDEX IF NOT EXISTS order_stock_reservations_status_idx
    ON public.order_stock_reservations (status);

CREATE INDEX IF NOT EXISTS order_stock_reservations_active_flower_idx
    ON public.order_stock_reservations (flower_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_reservation_id_unique_idx
    ON public.stock_movements (reservation_id)
    WHERE reservation_id IS NOT NULL;

COMMIT;
