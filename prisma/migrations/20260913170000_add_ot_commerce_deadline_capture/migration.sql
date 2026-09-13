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

DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "ot_commerce_deadline_capture" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
