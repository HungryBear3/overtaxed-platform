-- Additive: immutable canonical acquisition snapshots with a dedicated
-- SELECT-only paid-server reader. Existing factual/paid tables are unchanged.
-- Writer is the existing server factual role (INSERT/SELECT only). Browser/API
-- roles receive nothing. Deployment must grant LOGIN/credentials to
-- ot_paid_snapshot_reader out of band; this migration creates it NOLOGIN.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_factual_app') THEN
    RAISE EXCEPTION 'MISSING_FACTUAL_APP_ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_paid_snapshot_reader') THEN
    CREATE ROLE ot_paid_snapshot_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('ot_paid_snapshot_reader','ot_factual_app')
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'UNSAFE_SNAPSHOT_ROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated')
      AND (pg_has_role(oid, 'ot_paid_snapshot_reader', 'MEMBER') OR pg_has_role(oid, 'ot_factual_app', 'MEMBER'))) THEN
    RAISE EXCEPTION 'UNSAFE_SNAPSHOT_API_MEMBERSHIP';
  END IF;
  IF pg_has_role('ot_paid_snapshot_reader', 'ot_factual_app', 'MEMBER') OR pg_has_role('ot_factual_app', 'ot_paid_snapshot_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'UNSAFE_SNAPSHOT_ROLE_MEMBERSHIP';
  END IF;
END $$;

CREATE TABLE public.ot_acquisition_snapshot (
  id text PRIMARY KEY CHECK (id ~ '^acq_[a-f0-9]{64}$'),
  schema text NOT NULL CHECK (schema = 'ot-acquisition-snapshot/v1'),
  subject_pin text NOT NULL CHECK (subject_pin ~ '^[0-9]{14}$'),
  sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  canonical text NOT NULL,
  pages text NOT NULL,
  pages_sha256 text NOT NULL CHECK (pages_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = 'acq_' || sha256)
);
CREATE INDEX ot_acquisition_snapshot_subject_idx ON public.ot_acquisition_snapshot(subject_pin, created_at);

CREATE FUNCTION public.ot_acquisition_snapshot_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ACQUISITION_SNAPSHOT_IMMUTABLE';
END $$;
REVOKE ALL ON FUNCTION public.ot_acquisition_snapshot_reject_mutation() FROM PUBLIC;
CREATE TRIGGER ot_acquisition_snapshot_immutable BEFORE UPDATE OR DELETE ON public.ot_acquisition_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.ot_acquisition_snapshot_reject_mutation();
CREATE TRIGGER ot_acquisition_snapshot_no_truncate BEFORE TRUNCATE ON public.ot_acquisition_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION public.ot_acquisition_snapshot_reject_mutation();

REVOKE ALL PRIVILEGES ON TABLE public.ot_acquisition_snapshot FROM PUBLIC;
-- Remove EVERY non-owner grant (including default-privilege grants to roles
-- that browser roles inherit), not merely direct anon/authenticated grants.
DO $$
DECLARE g record;
BEGIN
  FOR g IN
    SELECT DISTINCT roles.rolname
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles roles ON roles.oid=a.grantee
    WHERE c.oid='public.ot_acquisition_snapshot'::regclass AND a.grantee<>c.relowner
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.ot_acquisition_snapshot FROM %I CASCADE', g.rolname);
  END LOOP;
  FOR g IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.ot_acquisition_snapshot FROM %I', g.rolname);
  END LOOP;
END $$;
GRANT INSERT, SELECT ON TABLE public.ot_acquisition_snapshot TO ot_factual_app;
GRANT SELECT ON TABLE public.ot_acquisition_snapshot TO ot_paid_snapshot_reader;

ALTER TABLE public.ot_acquisition_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_acquisition_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY ot_acquisition_snapshot_insert ON public.ot_acquisition_snapshot FOR INSERT TO ot_factual_app WITH CHECK (true);
CREATE POLICY ot_acquisition_snapshot_select ON public.ot_acquisition_snapshot FOR SELECT TO ot_factual_app, ot_paid_snapshot_reader USING (true);
COMMIT;
