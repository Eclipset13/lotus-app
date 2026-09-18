-- Run manually as the owner of the public schema. Existing rows are never overwritten.
BEGIN;

CREATE TABLE IF NOT EXISTS public.constructor_wrappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  subtitle varchar(180) NOT NULL DEFAULT '',
  color varchar(7) NOT NULL,
  ribbon_color varchar(7) NOT NULL,
  sale_price numeric(12,2) NOT NULL,
  opacity numeric(4,3) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  has_been_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT constructor_wrappings_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT constructor_wrappings_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT constructor_wrappings_price_range CHECK (sale_price >= 0),
  CONSTRAINT constructor_wrappings_opacity_range CHECK (opacity >= 0 AND opacity <= 1),
  CONSTRAINT constructor_wrappings_sort_range CHECK (sort_order >= 0 AND sort_order <= 1000000),
  CONSTRAINT constructor_wrappings_color_format CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT constructor_wrappings_ribbon_color_format CHECK (ribbon_color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE INDEX IF NOT EXISTS constructor_wrappings_active_sort_idx
  ON public.constructor_wrappings(is_active, sort_order, id);

INSERT INTO public.constructor_wrappings
  (slug, name, subtitle, color, ribbon_color, sale_price, opacity, sort_order, is_active, has_been_active)
VALUES
  ('blush', 'Пудровая', 'Нежно-розовая', '#f4cfc8', '#b85d70', 25.00, 0.500, 10, true, true),
  ('kraft', 'Крафтовая', 'Тёплая натуральная', '#c99b72', '#744b3d', 20.00, 0.720, 20, true, true),
  ('ivory', 'Молочная', 'Светлая премиальная', '#f6eee4', '#c49a72', 35.00, 0.580, 30, true, true)
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE app_role text := COALESCE(NULLIF(current_setting('lotus.app_role', true), ''), 'lotus_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE EXCEPTION 'Application role % does not exist; set lotus.app_role', app_role;
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.constructor_wrappings TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.constructor_wrappings_id_seq TO %I', app_role);
END $$;

COMMIT;
