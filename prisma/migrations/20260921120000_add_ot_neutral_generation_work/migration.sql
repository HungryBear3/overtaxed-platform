-- Additive, old-binary-safe durable scheduling for neutral report production.
-- This relation is internal work state only: it has no customer artifact,
-- delivery, capability, QA, provider payload, or PII columns.
CREATE TYPE "OTNeutralGenerationStatus" AS ENUM (
  'PENDING','CLAIMED','PRODUCING','COMPLETE','RETRY_REQUIRED',
  'RECONCILIATION_REQUIRED','FAILED'
);

CREATE TABLE "ot_neutral_generation_work" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "status" "OTNeutralGenerationStatus" NOT NULL DEFAULT 'PENDING',
  "status_revision" INTEGER NOT NULL DEFAULT 0,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" TEXT,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMPTZ(3),
  "reason_code" TEXT,
  "claimed_at" TIMESTAMPTZ(3),
  "production_started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_neutral_generation_order_key" UNIQUE ("order_id"),
  CONSTRAINT "ot_neutral_generation_reservation_key" UNIQUE ("reservation_id"),
  CONSTRAINT "ot_neutral_generation_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_generation_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_generation_counters_shape" CHECK ("status_revision" >= 0 AND "attempt_count" >= 0),
  CONSTRAINT "ot_neutral_generation_reason_shape" CHECK ("reason_code" IS NULL OR "reason_code" IN (
    'SOURCE_UNAVAILABLE','RUNTIME_UNAVAILABLE','WORKER_EXCEPTION',
    'STAGE_OUTCOME_AMBIGUOUS','PROMOTE_OUTCOME_AMBIGUOUS',
    'WRITE_OR_VERIFY_AMBIGUOUS','PRODUCTION_OUTCOME_UNKNOWN',
    'AUTHORITY_OR_INPUT_REFUSED'
  )),
  CONSTRAINT "ot_neutral_generation_state_shape" CHECK (
    ("status"='PENDING' AND "status_revision"=0 AND "attempt_count"=0 AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "reason_code" IS NULL AND "claimed_at" IS NULL AND "production_started_at" IS NULL AND "completed_at" IS NULL)
    OR ("status"='CLAIMED' AND "status_revision">0 AND "attempt_count">0 AND length("lease_owner") BETWEEN 1 AND 96 AND "lease_token" ~ '^[0-9a-f-]{36}$' AND "lease_expires_at" IS NOT NULL AND "reason_code" IS NULL AND "claimed_at" IS NOT NULL AND "production_started_at" IS NULL AND "completed_at" IS NULL)
    OR ("status"='PRODUCING' AND "status_revision">0 AND "attempt_count">0 AND length("lease_owner") BETWEEN 1 AND 96 AND "lease_token" ~ '^[0-9a-f-]{36}$' AND "lease_expires_at" IS NOT NULL AND "reason_code" IS NULL AND "claimed_at" IS NOT NULL AND "production_started_at" IS NOT NULL AND "completed_at" IS NULL)
    OR ("status"='COMPLETE' AND "status_revision">0 AND "attempt_count">0 AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "reason_code" IS NULL AND "production_started_at" IS NOT NULL AND "completed_at" IS NOT NULL)
    OR ("status" IN ('RETRY_REQUIRED','RECONCILIATION_REQUIRED','FAILED') AND "status_revision">0 AND "attempt_count">0 AND "lease_owner" IS NULL AND "lease_token" IS NULL AND "lease_expires_at" IS NULL AND "reason_code" IS NOT NULL AND "production_started_at" IS NOT NULL AND "completed_at" IS NULL)
  )
);

CREATE INDEX "ot_neutral_generation_status_updated_idx" ON "ot_neutral_generation_work"("status","updated_at");
CREATE INDEX "ot_neutral_generation_lease_expiry_idx" ON "ot_neutral_generation_work"("lease_expires_at");

ALTER TABLE "ot_neutral_generation_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_generation_work" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_neutral_generation_work" FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE ot_neutral_generation_work FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE "ot_neutral_generation_work" FROM ot_neutral_runtime;
GRANT SELECT,INSERT,UPDATE ON TABLE "ot_neutral_generation_work" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_runtime_generation_work" ON "ot_neutral_generation_work"
  FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);

DO $$
DECLARE
  role_name TEXT;
  privilege TEXT;
  required TEXT[] := ARRAY['SELECT','INSERT','UPDATE'];
  forbidden TEXT[] := ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER'];
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='ot_neutral_generation_work'::regclass)
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename='ot_neutral_generation_work'
        AND policyname='ot_neutral_runtime_generation_work'
        AND cmd='ALL' AND 'ot_neutral_runtime'=ANY(roles)
        AND qual IS NOT NULL AND with_check IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'neutral generation runtime security verification failed';
  END IF;
  -- has_table_privilege has ANY semantics over a comma-separated list: it is
  -- true when the role holds any one of the listed privileges. A single list
  -- check therefore passes on a silently degraded GRANT. Every required
  -- privilege is proved on its own, and every forbidden privilege is refused
  -- on its own, for the runtime role and for each API role.
  FOREACH privilege IN ARRAY required LOOP
    IF NOT has_table_privilege('ot_neutral_runtime','ot_neutral_generation_work',privilege) THEN
      RAISE EXCEPTION 'neutral generation runtime security verification failed: runtime role lacks %', privilege;
    END IF;
  END LOOP;
  FOREACH privilege IN ARRAY forbidden LOOP
    IF has_table_privilege('ot_neutral_runtime','ot_neutral_generation_work',privilege) THEN
      RAISE EXCEPTION 'neutral generation runtime security verification failed: runtime role retains %', privilege;
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH privilege IN ARRAY required || forbidden LOOP
        IF has_table_privilege(role_name,'ot_neutral_generation_work',privilege) THEN
          RAISE EXCEPTION 'neutral generation API role % retains table privilege %', role_name, privilege;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
