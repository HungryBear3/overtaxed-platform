CREATE TYPE "OTNeutralReservationStatus" AS ENUM ('RESERVED','STAGED','PROMOTED','RECONCILIATION_REQUIRED','QUARANTINED','COMPROMISED','SUPERSEDED','ABANDONED');
CREATE TYPE "OTNeutralBlobAttemptStatus" AS ENUM ('INTENDED','WRITE_CONFIRMED','WRITE_UNKNOWN','QUARANTINED');
CREATE TABLE "ot_neutral_report_reservation" (
 "id" TEXT PRIMARY KEY, "order_id" TEXT NOT NULL, "policy_version" TEXT NOT NULL, "property_fingerprint" TEXT NOT NULL, "reservation_key" TEXT NOT NULL, "checkout_price_id" TEXT NOT NULL, "checkout_product_id" TEXT NOT NULL,
 "admission_sha256" TEXT NOT NULL, "data_evidence_sha256" TEXT NOT NULL, "deadline_evidence_sha256" TEXT NOT NULL, "source_content_sha256" TEXT NOT NULL, "deadline_identity_sha256" TEXT NOT NULL,
 "official_retrieved_at" TIMESTAMPTZ(3) NOT NULL, "official_oldest_retrieved_at" TIMESTAMPTZ(3) NOT NULL, "official_max_age_seconds" INTEGER NOT NULL, "deadline_retrieved_at" TIMESTAMPTZ(3) NOT NULL,
 "cohort_position" INTEGER NOT NULL, "precheckout_lease_expires_at" TIMESTAMPTZ(3) NOT NULL, "paid_cohort_position" INTEGER, "paid_admitted_at" TIMESTAMPTZ(3), "reviewer_key" TEXT NOT NULL, "reviewer_week_start" DATE NOT NULL,
 "qa_target_minutes" INTEGER NOT NULL DEFAULT 12, "qa_hard_stop_minutes" INTEGER NOT NULL DEFAULT 20,
 "qa_started_at" TIMESTAMPTZ(3), "qa_completed_at" TIMESTAMPTZ(3), "qa_minutes" INTEGER,
 "status" "OTNeutralReservationStatus" NOT NULL DEFAULT 'RESERVED', "bundle_sha256" TEXT, "manifest_sha256" TEXT, "pdf_sha256" TEXT, "csv_sha256" TEXT,
 "private_references" JSONB, "staged_at" TIMESTAMPTZ(3), "promoted_at" TIMESTAMPTZ(3), "reconciliation_code" TEXT, "incident_code" TEXT, "superseded_by_sha256" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ot_neutral_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_digest_shape" CHECK ("property_fingerprint" ~ '^[0-9a-f]{64}$' AND "admission_sha256" ~ '^[0-9a-f]{64}$' AND "data_evidence_sha256" ~ '^[0-9a-f]{64}$' AND "deadline_evidence_sha256" ~ '^[0-9a-f]{64}$' AND "source_content_sha256" ~ '^[0-9a-f]{64}$' AND "deadline_identity_sha256" ~ '^[0-9a-f]{64}$' AND ("bundle_sha256" IS NULL OR "bundle_sha256" ~ '^[0-9a-f]{64}$') AND ("manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[0-9a-f]{64}$') AND ("pdf_sha256" IS NULL OR "pdf_sha256" ~ '^[0-9a-f]{64}$') AND ("csv_sha256" IS NULL OR "csv_sha256" ~ '^[0-9a-f]{64}$')),
 CONSTRAINT "ot_neutral_capacity_shape" CHECK ("cohort_position" BETWEEN 1 AND 10 AND ("paid_cohort_position" IS NULL OR "paid_cohort_position" BETWEEN 1 AND 10) AND (("paid_cohort_position" IS NULL)=("paid_admitted_at" IS NULL)) AND "official_max_age_seconds" BETWEEN 0 AND 86400 AND length("reviewer_key") BETWEEN 1 AND 64 AND "qa_target_minutes"=12 AND "qa_hard_stop_minutes"=20 AND ("qa_minutes" IS NULL OR "qa_minutes" BETWEEN 0 AND 20)),
 CONSTRAINT "ot_neutral_time_shape" CHECK ("official_oldest_retrieved_at" <= "official_retrieved_at" AND "official_retrieved_at" <= "created_at" AND "deadline_retrieved_at" <= "created_at" AND "precheckout_lease_expires_at">"created_at" AND ("qa_completed_at" IS NULL OR ("qa_started_at" IS NOT NULL AND "qa_completed_at">="qa_started_at"))),
 CONSTRAINT "ot_neutral_state_shape" CHECK (("status"='RESERVED' AND "bundle_sha256" IS NULL AND "private_references" IS NULL) OR ("status" IN ('STAGED','PROMOTED') AND "bundle_sha256" IS NOT NULL AND "manifest_sha256" IS NOT NULL AND "pdf_sha256" IS NOT NULL AND "csv_sha256" IS NOT NULL AND "private_references" IS NOT NULL) OR ("status" IN ('RECONCILIATION_REQUIRED','QUARANTINED','COMPROMISED','SUPERSEDED','ABANDONED')))
);
CREATE UNIQUE INDEX "ot_neutral_order_key" ON "ot_neutral_report_reservation"("order_id");
CREATE UNIQUE INDEX "ot_neutral_reservation_key" ON "ot_neutral_report_reservation"("reservation_key");
CREATE UNIQUE INDEX "ot_neutral_cohort_position_key" ON "ot_neutral_report_reservation"("cohort_position") WHERE "status" <> 'ABANDONED';
CREATE UNIQUE INDEX "ot_neutral_paid_cohort_position_key" ON "ot_neutral_report_reservation"("paid_cohort_position") WHERE "paid_cohort_position" IS NOT NULL;
CREATE INDEX "ot_neutral_reviewer_capacity_idx" ON "ot_neutral_report_reservation"("reviewer_key","reviewer_week_start","status");
CREATE INDEX "ot_neutral_status_updated_idx" ON "ot_neutral_report_reservation"("status","updated_at");
CREATE INDEX "ot_neutral_bundle_idx" ON "ot_neutral_report_reservation"("bundle_sha256");
CREATE TABLE "ot_neutral_blob_attempt" (
 "id" TEXT PRIMARY KEY, "reservation_id" TEXT NOT NULL, "attempt_number" INTEGER NOT NULL, "status" "OTNeutralBlobAttemptStatus" NOT NULL DEFAULT 'INTENDED',
 "storage_locator" TEXT NOT NULL, "bundle_sha256" TEXT NOT NULL, "byte_size" INTEGER NOT NULL, "reason_code" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "observed_at" TIMESTAMPTZ(3),
 CONSTRAINT "ot_neutral_blob_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_blob_digest_shape" CHECK ("bundle_sha256" ~ '^[0-9a-f]{64}$' AND "storage_locator" = 'ot-neutral-reports/sha256/' || "bundle_sha256" || '.json' AND "byte_size" BETWEEN 1 AND 64000000)
);
CREATE UNIQUE INDEX "ot_neutral_blob_attempt_number_key" ON "ot_neutral_blob_attempt"("reservation_id","attempt_number");
CREATE UNIQUE INDEX "ot_neutral_blob_identity_key" ON "ot_neutral_blob_attempt"("reservation_id","storage_locator","bundle_sha256");
CREATE INDEX "ot_neutral_blob_status_idx" ON "ot_neutral_blob_attempt"("status","created_at");
CREATE TABLE "ot_neutral_checkout_attempt" ("id" TEXT PRIMARY KEY,"reservation_id" TEXT NOT NULL,"order_id" TEXT NOT NULL,"checkout_key" TEXT NOT NULL,"idempotency_key" TEXT NOT NULL,"contract_sha256" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'INTENDED',"stripe_session_id" TEXT,"stripe_status" TEXT,"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"observed_at" TIMESTAMPTZ(3),CONSTRAINT "ot_neutral_checkout_attempt_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION,CONSTRAINT "ot_neutral_checkout_attempt_hash" CHECK ("contract_sha256" ~ '^[0-9a-f]{64}$'));
CREATE UNIQUE INDEX "ot_neutral_checkout_attempt_idempotency" ON "ot_neutral_checkout_attempt"("idempotency_key");
CREATE INDEX "ot_neutral_checkout_attempt_status" ON "ot_neutral_checkout_attempt"("status","created_at");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_runtime') THEN CREATE ROLE ot_neutral_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF; END $$;
ALTER TABLE "ot_neutral_report_reservation" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_report_reservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_blob_attempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_blob_attempt" FORCE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_checkout_attempt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "ot_neutral_checkout_attempt" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "ot_neutral_report_reservation","ot_neutral_blob_attempt" FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON ot_neutral_report_reservation, ot_neutral_blob_attempt FROM %I',r); END IF; END LOOP; END $$;
GRANT SELECT,INSERT,UPDATE ON "ot_neutral_report_reservation","ot_neutral_blob_attempt","ot_neutral_checkout_attempt" TO ot_neutral_runtime;
GRANT SELECT ("id","tier","propertyPin","status","stripeSessionId","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency","settledAmountCents","settledCurrency","amountPaid","eligibilitySnapshot") ON "ot_order" TO ot_neutral_runtime;
GRANT SELECT ("order_id","session_id","payment_intent") ON "ot_payment_binding" TO ot_neutral_runtime;
GRANT SELECT ("payment_intent") ON "ot_settlement_reversal" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_runtime_payment_binding_read" ON "ot_payment_binding" FOR SELECT TO ot_neutral_runtime USING (true);
CREATE POLICY "ot_neutral_runtime_reversal_read" ON "ot_settlement_reversal" FOR SELECT TO ot_neutral_runtime USING (true);
CREATE POLICY "ot_neutral_runtime_reservations" ON "ot_neutral_report_reservation" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_attempts" ON "ot_neutral_blob_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_checkout_attempts" ON "ot_neutral_checkout_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
