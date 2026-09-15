BEGIN;
-- Display metadata only; order JSON snapshots retain their own immutable reference.
ALTER TABLE public.flowers ADD COLUMN IF NOT EXISTS model_3d jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.flowers'::regclass AND conname = 'flowers_model_3d_object') THEN
    ALTER TABLE public.flowers ADD CONSTRAINT flowers_model_3d_object
      CHECK (model_3d IS NULL OR jsonb_typeof(model_3d) = 'object');
  END IF;
END $$;
COMMIT;
