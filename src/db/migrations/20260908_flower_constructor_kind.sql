BEGIN;

ALTER TABLE public.flowers
    ADD COLUMN IF NOT EXISTS constructor_kind varchar(16);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.flowers'::regclass
          AND conname = 'flowers_constructor_kind_check'
    ) THEN
        ALTER TABLE public.flowers
            ADD CONSTRAINT flowers_constructor_kind_check
            CHECK (
                constructor_kind IS NULL
                OR constructor_kind IN ('rose', 'peony', 'tulip')
            );
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS flowers_constructor_kind_unique_idx
    ON public.flowers (constructor_kind)
    WHERE constructor_kind IS NOT NULL;

COMMIT;
