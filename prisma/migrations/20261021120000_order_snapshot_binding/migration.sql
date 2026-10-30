-- Additive: immutable order -> acquisition snapshot binding, written at paid
-- checkout from a server-issued single-use browser transfer. A transfer nonce
-- binds at most one order; an order binds exactly one snapshot forever.
-- Writer is a dedicated INSERT/SELECT-only binder role; the existing paid
-- snapshot reader may SELECT. Browser/API roles receive nothing. Deployment
-- must grant LOGIN/credentials to ot_paid_snapshot_binder out of band.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_paid_snapshot_reader') THEN
    RAISE EXCEPTION 'MISSING_SNAPSHOT_READER_ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_paid_snapshot_binder') THEN
    CREATE ROLE ot_paid_snapshot_binder NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_paid_snapshot_binder'
      AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'UNSAFE_SNAPSHOT_BINDER_ROLE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','ot_factual_app')
      AND pg_has_role(oid, 'ot_paid_snapshot_binder', 'MEMBER')) THEN
    RAISE EXCEPTION 'UNSAFE_SNAPSHOT_BINDER_MEMBERSHIP';
  END IF;
END $$;

-- Lets the binding reference (snapshot, subject) as one key.
ALTER TABLE public.ot_acquisition_snapshot ADD CONSTRAINT ot_acquisition_snapshot_id_subject_key UNIQUE (id, subject_pin);

CREATE TABLE public.ot_order_snapshot_binding (
  order_id text PRIMARY KEY CHECK (order_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  snapshot_id text NOT NULL,
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  subject_pin text NOT NULL CHECK (subject_pin ~ '^[0-9]{14}$'),
  transfer_nonce text NOT NULL UNIQUE CHECK (transfer_nonce ~ '^[a-f0-9]{32}$'),
  bound_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (snapshot_id = 'acq_' || snapshot_sha256),
  FOREIGN KEY (snapshot_id, subject_pin) REFERENCES public.ot_acquisition_snapshot(id, subject_pin)
);

CREATE FUNCTION public.ot_order_snapshot_binding_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ORDER_SNAPSHOT_BINDING_IMMUTABLE';
END $$;
REVOKE ALL ON FUNCTION public.ot_order_snapshot_binding_reject_mutation() FROM PUBLIC;
CREATE TRIGGER ot_order_snapshot_binding_immutable BEFORE UPDATE OR DELETE ON public.ot_order_snapshot_binding
  FOR EACH ROW EXECUTE FUNCTION public.ot_order_snapshot_binding_reject_mutation();
CREATE TRIGGER ot_order_snapshot_binding_no_truncate BEFORE TRUNCATE ON public.ot_order_snapshot_binding
  FOR EACH STATEMENT EXECUTE FUNCTION public.ot_order_snapshot_binding_reject_mutation();

REVOKE ALL PRIVILEGES ON TABLE public.ot_order_snapshot_binding FROM PUBLIC;
DO $$
DECLARE g record;
BEGIN
  FOR g IN
    SELECT DISTINCT roles.rolname
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    JOIN pg_roles roles ON roles.oid=a.grantee
    WHERE c.oid='public.ot_order_snapshot_binding'::regclass AND a.grantee<>c.relowner
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.ot_order_snapshot_binding FROM %I CASCADE', g.rolname);
  END LOOP;
END $$;
GRANT INSERT, SELECT ON TABLE public.ot_order_snapshot_binding TO ot_paid_snapshot_binder;
GRANT SELECT ON TABLE public.ot_order_snapshot_binding TO ot_paid_snapshot_reader;

ALTER TABLE public.ot_order_snapshot_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ot_order_snapshot_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY ot_order_snapshot_binding_insert ON public.ot_order_snapshot_binding FOR INSERT TO ot_paid_snapshot_binder WITH CHECK (true);
CREATE POLICY ot_order_snapshot_binding_select ON public.ot_order_snapshot_binding FOR SELECT TO ot_paid_snapshot_binder, ot_paid_snapshot_reader USING (true);
COMMIT;
