-- Run manually as the table owner. Existing payment rows are preserved.
BEGIN;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check CHECK
    (method IN ('cash', 'card', 'bank_transfer', 'wallet', 'transfer'));

COMMIT;