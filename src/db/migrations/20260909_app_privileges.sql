BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'lotus_app'
    ) THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO lotus_app';

        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
            public.purchases,
            public.purchase_items,
            public.order_stock_reservations
            TO lotus_app';

        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE
            public.purchases_id_seq,
            public.purchase_items_id_seq,
            public.order_stock_reservations_id_seq
            TO lotus_app';
    ELSE
        RAISE NOTICE 'Role lotus_app does not exist; privileges were not granted';
    END IF;
END
$$;

COMMIT;
