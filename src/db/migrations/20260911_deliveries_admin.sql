BEGIN;

ALTER TABLE public.deliveries
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS internal_note TEXT;

CREATE INDEX IF NOT EXISTS deliveries_status_idx
    ON public.deliveries (status);

CREATE INDEX IF NOT EXISTS deliveries_schedule_idx
    ON public.deliveries ((COALESCE(scheduled_at, requested_at)));

CREATE INDEX IF NOT EXISTS deliveries_created_at_idx
    ON public.deliveries (created_at DESC);

COMMIT;
