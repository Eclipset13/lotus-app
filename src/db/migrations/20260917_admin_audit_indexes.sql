-- Run manually as the table owner. Audit records and staff data are not rewritten.
BEGIN;

CREATE INDEX IF NOT EXISTS admin_audit_time_id_idx
  ON public.admin_audit_log(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_action_time_idx
  ON public.admin_audit_log(action, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_entity_type_time_idx
  ON public.admin_audit_log((split_part(action, '.', 1)), created_at DESC, id DESC);

-- Use SET lotus.app_role = 'your_application_role' before this script if different.
DO $$ DECLARE app_role text := COALESCE(NULLIF(current_setting('lotus.app_role', true), ''), 'lotus_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'Application role % does not exist; set lotus.app_role', app_role;
  END IF;
  EXECUTE format('GRANT SELECT ON public.admin_audit_log TO %I', app_role);
END $$;

COMMIT;
