ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS tax_id varchar(64),
    ADD COLUMN IF NOT EXISTS bank_details text,
    ADD COLUMN IF NOT EXISTS contract_details text;
