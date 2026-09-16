-- Run manually as the table owner. No historical orders/users are rewritten.
BEGIN;

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_code_check;
ALTER TABLE public.roles ADD CONSTRAINT roles_code_check CHECK
  (code IN ('customer', 'admin', 'super_admin', 'florist', 'inventory_manager', 'courier'));
INSERT INTO public.roles (code, name) VALUES
  ('super_admin', 'Главный администратор'), ('florist', 'Флорист'),
  ('inventory_manager', 'Менеджер склада'), ('courier', 'Курьер')
ON CONFLICT (code) DO NOTHING;

-- Inspected existing schema: no credentials, sessions or audit tables exist.
CREATE TABLE IF NOT EXISTS public.staff_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
  must_change_password boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS staff_sessions_user_idx ON public.staff_sessions(user_id);
CREATE INDEX IF NOT EXISTS staff_sessions_expiry_idx ON public.staff_sessions(expires_at);
CREATE TABLE IF NOT EXISTS public.staff_login_limits (
  bucket_hash text PRIMARY KEY CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_login_limits_expiry_idx ON public.staff_login_limits(expires_at);
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_actor_time_idx ON public.admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_entity_idx ON public.admin_audit_log(entity_id, created_at DESC);

ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS courier_user_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.deliveries'::regclass
    AND conname = 'deliveries_courier_user_fkey') THEN
    ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_courier_user_fkey
      FOREIGN KEY (courier_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS deliveries_courier_status_idx ON public.deliveries(courier_user_id, status);
CREATE INDEX IF NOT EXISTS user_roles_role_user_idx ON public.user_roles(role_id, user_id);

-- Existing flowers_prices_check already checks both numeric(12,2) prices >= 0.
-- Preserve courier_name/phone snapshots and existing deliveries, including legacy anomalies.
-- Use SET lotus.app_role = 'your_application_role' before this script if different.
DO $$ DECLARE app_role text := COALESCE(NULLIF(current_setting('lotus.app_role', true), ''), 'lotus_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'Application role % does not exist; set lotus.app_role', app_role;
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.staff_credentials TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.staff_sessions TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_login_limits TO %I', app_role);
  EXECUTE format('GRANT INSERT ON public.admin_audit_log TO %I', app_role);
  EXECUTE format('GRANT USAGE ON SEQUENCE public.admin_audit_log_id_seq TO %I', app_role);
  EXECUTE format('GRANT SELECT ON public.roles TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.user_roles TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT ON public.users TO %I', app_role);
  EXECUTE format('GRANT UPDATE (name, phone, status, updated_at, last_login_at) ON public.users TO %I', app_role);
  EXECUTE format('GRANT UPDATE (courier_user_id) ON public.deliveries TO %I', app_role);
END $$;
COMMIT;
