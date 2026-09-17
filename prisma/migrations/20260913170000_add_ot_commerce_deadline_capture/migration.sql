CREATE TABLE "ot_commerce_deadline_capture" (
  "id" TEXT PRIMARY KEY,
  "retrieved_at" TIMESTAMPTZ NOT NULL,
  "content_sha256" TEXT NOT NULL CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
  "capture_json" TEXT NOT NULL,
  "source_body" BYTEA NOT NULL CHECK (octet_length("source_body") > 0),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_commerce_deadline_capture_identity_key" UNIQUE ("retrieved_at", "content_sha256")
);

CREATE INDEX "ot_commerce_deadline_capture_latest_idx"
  ON "ot_commerce_deadline_capture" ("retrieved_at" DESC, "id" DESC);

CREATE FUNCTION "ot_commerce_deadline_capture_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commerce deadline captures are append-only';
END;
$$;

CREATE TRIGGER "ot_commerce_deadline_capture_append_only"
  BEFORE UPDATE OR DELETE ON "ot_commerce_deadline_capture"
  FOR EACH ROW EXECUTE FUNCTION "ot_commerce_deadline_capture_append_only"();

ALTER TABLE "ot_commerce_deadline_capture" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_commerce_deadline_capture" FROM PUBLIC;

CREATE FUNCTION "ot_publish_commerce_deadline_capture"(
  capture_id TEXT,
  capture_retrieved_at TIMESTAMPTZ,
  capture_content_sha256 TEXT,
  capture_json TEXT,
  capture_source_body BYTEA
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE embedded JSONB;
BEGIN
  IF capture_id IS NULL
    OR capture_retrieved_at IS NULL
    OR capture_content_sha256 IS NULL
    OR capture_json IS NULL
    OR capture_source_body IS NULL
  THEN
    RAISE EXCEPTION 'commerce deadline capture binding is invalid';
  END IF;

  embedded := capture_json::jsonb;
  IF (embedded #>> '{snapshot,sources,assessor,retrievedAt}') IS NULL
    OR (embedded #>> '{snapshot,sources,assessor,contentSha256}') IS NULL
    OR (embedded #>> '{sourceBodyBase64}') IS NULL
    OR capture_retrieved_at IS DISTINCT FROM ((embedded #>> '{snapshot,sources,assessor,retrievedAt}')::timestamptz)
    OR capture_content_sha256 IS DISTINCT FROM (embedded #>> '{snapshot,sources,assessor,contentSha256}')
    OR capture_source_body IS DISTINCT FROM decode(embedded #>> '{sourceBodyBase64}', 'base64')
    OR capture_content_sha256 IS DISTINCT FROM encode(sha256(capture_source_body), 'hex')
  THEN
    RAISE EXCEPTION 'commerce deadline capture binding is invalid';
  END IF;

  INSERT INTO public."ot_commerce_deadline_capture"
    ("id", "retrieved_at", "content_sha256", "capture_json", "source_body")
  VALUES
    (capture_id, capture_retrieved_at, capture_content_sha256, capture_json, capture_source_body);
END;
$$;

REVOKE ALL ON FUNCTION "ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) FROM PUBLIC;

DO $$
DECLARE
  api_role TEXT;
  migration_role TEXT := current_user;
  owner_role_oid OID;
  migration_role_is_superuser BOOLEAN;
  owner_role_attributes_valid BOOLEAN;
BEGIN
  -- The connection role must not own the authority table: PostgreSQL owners
  -- retain implicit DML authority even after ordinary grants are revoked.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ot_commerce_capture_owner') THEN
    CREATE ROLE ot_commerce_capture_owner NOLOGIN NOINHERIT;
  END IF;

  SELECT oid,
    rolcanlogin = false
      AND rolinherit = false
      AND rolsuper = false
      AND rolcreaterole = false
      AND rolcreatedb = false
      AND rolreplication = false
      AND rolbypassrls = false
  INTO STRICT owner_role_oid, owner_role_attributes_valid
  FROM pg_roles
  WHERE rolname = 'ot_commerce_capture_owner';
  IF NOT owner_role_attributes_valid THEN
    RAISE EXCEPTION 'pre-existing ot_commerce_capture_owner role has unsafe attributes';
  END IF;

  -- A pre-existing global role name is accepted only when its attributes and
  -- complete membership graph are pristine. PostgreSQL 16+ records an
  -- unrevokable-by-the-creator ADMIN grant when a non-superuser CREATEROLE
  -- role creates another role, so that case must fail rather than leave an
  -- application-accessible privilege-escalation path.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE roleid = owner_role_oid OR member = owner_role_oid
  ) THEN
    RAISE EXCEPTION 'pre-existing ot_commerce_capture_owner role is not isolated';
  END IF;

  SELECT rolsuper INTO STRICT migration_role_is_superuser
  FROM pg_roles
  WHERE rolname = migration_role;
  IF NOT migration_role_is_superuser THEN
    RAISE EXCEPTION 'commerce capture owner transfer requires an isolated privileged migration connection';
  END IF;

  GRANT USAGE, CREATE ON SCHEMA public TO ot_commerce_capture_owner;
  ALTER TABLE public."ot_commerce_deadline_capture" OWNER TO ot_commerce_capture_owner;
  ALTER FUNCTION public."ot_commerce_deadline_capture_append_only"() OWNER TO ot_commerce_capture_owner;
  ALTER FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) OWNER TO ot_commerce_capture_owner;
  EXECUTE format('GRANT SELECT ON TABLE public."ot_commerce_deadline_capture" TO %I', migration_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public."ot_publish_commerce_deadline_capture"(TEXT, TIMESTAMPTZ, TEXT, TEXT, BYTEA) TO %I', migration_role);
  EXECUTE format('CREATE POLICY "ot_commerce_deadline_capture_reader" ON public."ot_commerce_deadline_capture" FOR SELECT TO %I USING (true)', migration_role);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."ot_commerce_deadline_capture" FROM %I', migration_role);
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE roleid = owner_role_oid OR member = owner_role_oid
  ) THEN
    RAISE EXCEPTION 'ot_commerce_capture_owner role membership was not fully removed';
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "ot_commerce_deadline_capture" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
