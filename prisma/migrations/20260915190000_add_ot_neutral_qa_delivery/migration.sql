ALTER TYPE "OTFulfillmentKind" ADD VALUE IF NOT EXISTS 'NEUTRAL_RECORDS_REPORT';

ALTER TABLE "ot_neutral_report_reservation"
  ADD COLUMN "customer_zip_sha256" TEXT,
  ADD COLUMN "customer_zip_byte_size" INTEGER,
  ADD COLUMN "customer_zip_locator" TEXT,
  ADD COLUMN "customer_zip_media_type" TEXT,
  ADD COLUMN "customer_zip_filename" TEXT,
  ADD CONSTRAINT "ot_neutral_customer_zip_complete" CHECK (
    ("customer_zip_sha256" IS NULL AND "customer_zip_byte_size" IS NULL AND "customer_zip_locator" IS NULL AND "customer_zip_media_type" IS NULL AND "customer_zip_filename" IS NULL)
    OR ("customer_zip_sha256" ~ '^[0-9a-f]{64}$' AND "customer_zip_byte_size" BETWEEN 1 AND 52428800 AND "customer_zip_locator" = 'ot-neutral-customer/sha256/' || "customer_zip_sha256" || '.zip' AND "customer_zip_media_type"='application/zip' AND "customer_zip_filename"='overtaxed-records-report.zip')
  );
CREATE UNIQUE INDEX "ot_neutral_report_reservation_customer_zip_sha256_key" ON "ot_neutral_report_reservation"("customer_zip_sha256");
CREATE UNIQUE INDEX "ot_neutral_report_reservation_customer_zip_locator_key" ON "ot_neutral_report_reservation"("customer_zip_locator");
CREATE TABLE "ot_neutral_customer_zip_attempt" (
 "id" TEXT PRIMARY KEY,"reservation_id" TEXT NOT NULL,"zip_sha256" TEXT NOT NULL,"byte_size" INTEGER NOT NULL,
 "storage_locator" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'INTENDED',"reason_code" TEXT,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"observed_at" TIMESTAMPTZ(3),
 CONSTRAINT "ot_neutral_customer_zip_attempt_reservation_fkey" FOREIGN KEY("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
 CONSTRAINT "ot_neutral_customer_zip_attempt_identity" CHECK("zip_sha256" ~ '^[0-9a-f]{64}$' AND "byte_size" BETWEEN 1 AND 52428800 AND "storage_locator"='ot-neutral-customer/sha256/'||"zip_sha256"||'.zip'),
 CONSTRAINT "ot_neutral_customer_zip_attempt_status" CHECK("status" IN ('INTENDED','WRITE_CONFIRMED','WRITE_UNKNOWN','READ_CONFIRMED','PROMOTED','QUARANTINED')),
 UNIQUE("reservation_id","zip_sha256")
);
CREATE INDEX "ot_neutral_customer_zip_attempt_status_created_idx" ON "ot_neutral_customer_zip_attempt"("status","created_at");
ALTER TABLE "ot_neutral_customer_zip_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_customer_zip_attempt" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_neutral_customer_zip_attempt" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_runtime') THEN
    EXECUTE 'GRANT SELECT ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime';
    EXECUTE 'GRANT INSERT ("id","reservation_id","zip_sha256","byte_size","storage_locator","status") ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime';
    EXECUTE 'GRANT UPDATE ("status","reason_code","observed_at") ON TABLE "ot_neutral_customer_zip_attempt" TO ot_neutral_runtime';
    EXECUTE 'CREATE POLICY "ot_neutral_customer_zip_attempt_runtime" ON "ot_neutral_customer_zip_attempt" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true)';
  END IF;
END $$;

CREATE TYPE "OTNeutralQaStatus" AS ENUM (
  'PENDING','IN_REVIEW','APPROVED','REJECTED','HARD_STOP','REFUND_REQUIRED','HELD'
);

CREATE TABLE "ot_neutral_qa_review" (
  "id" TEXT PRIMARY KEY,
  "reservation_id" TEXT NOT NULL UNIQUE,
  "order_id" TEXT NOT NULL UNIQUE,
  "status" "OTNeutralQaStatus" NOT NULL DEFAULT 'PENDING',
  "reviewer_key" TEXT NOT NULL,
  "reviewer_week_start" DATE NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "decided_at" TIMESTAMPTZ(3),
  "minutes_spent" INTEGER,
  "reason_code" TEXT,
  "policy_version" TEXT NOT NULL,
  "artifact_sha256" TEXT NOT NULL,
  "customer_artifact_sha256" TEXT,
  "evidence_digest_sha256" TEXT NOT NULL,
  "payment_binding_sha256" TEXT NOT NULL,
  "property_binding_fingerprint" TEXT NOT NULL,
  "fulfillment_id" TEXT UNIQUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ot_neutral_qa_review_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_fulfillment_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_qa_review_minutes" CHECK ("minutes_spent" IS NULL OR "minutes_spent" BETWEEN 0 AND 20),
  CONSTRAINT "ot_neutral_qa_review_digests" CHECK (
    "artifact_sha256" ~ '^[0-9a-f]{64}$' AND
    ("customer_artifact_sha256" IS NULL OR "customer_artifact_sha256" ~ '^[0-9a-f]{64}$') AND
    "evidence_digest_sha256" ~ '^[0-9a-f]{64}$' AND
    "payment_binding_sha256" ~ '^[0-9a-f]{64}$' AND
    "property_binding_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ot_neutral_qa_review_decision_complete" CHECK (
    ("status" IN ('PENDING','IN_REVIEW') AND "decided_at" IS NULL)
    OR ("status" NOT IN ('PENDING','IN_REVIEW') AND "decided_at" IS NOT NULL AND "reason_code" IS NOT NULL)
  ),
  CONSTRAINT "ot_neutral_qa_review_approval_minutes" CHECK (
    "status" IN ('PENDING','IN_REVIEW') OR ("minutes_spent" IS NOT NULL AND "minutes_spent" BETWEEN 1 AND 20)
  ),
  CONSTRAINT "ot_neutral_qa_review_reason_semantics" CHECK (
    ("status" IN ('PENDING','IN_REVIEW') AND "reason_code" IS NULL)
    OR ("status"='APPROVED' AND "reason_code"='QA_PASSED')
    OR ("status"='REJECTED' AND "reason_code"='ARTIFACT_DEFECT')
    OR ("status"='REFUND_REQUIRED' AND "reason_code" IN ('REPORT_INCOMPLETE','SOURCE_EVIDENCE_UNAVAILABLE','HARD_STOP_EXCEEDED'))
    OR ("status"='HARD_STOP' AND "reason_code"='HARD_STOP_EXCEEDED')
    OR ("status"='HELD' AND "reason_code" IN ('PAYMENT_REVERSED','SUPERSEDED','DISPUTED','OPERATOR_HOLD'))
  )
);

CREATE INDEX "ot_neutral_qa_review_reviewer_week_status_idx" ON "ot_neutral_qa_review"("reviewer_key","reviewer_week_start","status");
CREATE INDEX "ot_neutral_qa_review_status_updated_idx" ON "ot_neutral_qa_review"("status","updated_at");

ALTER TABLE "ot_neutral_qa_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_qa_review" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_neutral_qa_review" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_runtime') THEN
    EXECUTE 'GRANT SELECT ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime';
    EXECUTE 'GRANT INSERT ("id","reservation_id","order_id","status","reviewer_key","reviewer_week_start","started_at","policy_version","artifact_sha256","evidence_digest_sha256","payment_binding_sha256","property_binding_fingerprint","updated_at") ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime';
    EXECUTE 'GRANT UPDATE ("status","minutes_spent","reason_code","decided_at","fulfillment_id","customer_artifact_sha256","updated_at") ON TABLE "ot_neutral_qa_review" TO ot_neutral_runtime';
    EXECUTE 'CREATE POLICY "ot_neutral_qa_review_runtime" ON "ot_neutral_qa_review" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true)';
    EXECUTE 'GRANT SELECT ("id","order_id","kind","status","attempt_count") ON TABLE "ot_fulfillment" TO ot_neutral_runtime';
    EXECUTE 'GRANT INSERT ("id","order_id","kind","status","updated_at") ON TABLE "ot_fulfillment" TO ot_neutral_runtime';
    EXECUTE 'GRANT SELECT ("fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","source_order_id","property_binding_fingerprint") ON TABLE "ot_fulfillment_artifact" TO ot_neutral_runtime';
    EXECUTE 'GRANT INSERT ("id","fulfillment_id","version","artifact_sha256","byte_size","storage_locator","generator_version","template_version","generated_at","source_order_id","property_binding_fingerprint") ON TABLE "ot_fulfillment_artifact" TO ot_neutral_runtime';
  END IF;
END $$;

-- Read-only application authority for delivery/capability/callback checks.
-- The deployment binds its login to this NOLOGIN group; preflight proves it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_app_reader') THEN
    CREATE ROLE ot_neutral_app_reader NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT SELECT ("id","order_id","status","bundle_sha256","policy_version","property_fingerprint","superseded_by_sha256","customer_zip_sha256","customer_zip_byte_size","customer_zip_locator","customer_zip_media_type","customer_zip_filename") ON TABLE "ot_neutral_report_reservation" TO ot_neutral_app_reader;
GRANT SELECT ("reservation_id","order_id","status","policy_version","artifact_sha256","customer_artifact_sha256","property_binding_fingerprint","fulfillment_id") ON TABLE "ot_neutral_qa_review" TO ot_neutral_app_reader;
CREATE POLICY "ot_neutral_report_reservation_app_read" ON "ot_neutral_report_reservation" FOR SELECT TO ot_neutral_app_reader USING (true);
CREATE POLICY "ot_neutral_qa_review_app_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_app_reader USING (true);

CREATE TYPE "OTNeutralRefundStatus" AS ENUM ('REFUND_REQUIRED','REFUND_CLAIMED','RECEIPT_RECORDED_PENDING_VERIFICATION','RECEIPT_VERIFICATION_HELD','REFUND_CONFIRMED');
CREATE TABLE "ot_neutral_refund_work" (
  "id" TEXT PRIMARY KEY,
  "qa_review_id" TEXT NOT NULL UNIQUE REFERENCES "ot_neutral_qa_review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "order_id" TEXT NOT NULL UNIQUE REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  "status" "OTNeutralRefundStatus" NOT NULL DEFAULT 'REFUND_REQUIRED',
  "reason_code" TEXT NOT NULL CHECK ("reason_code" IN ('REPORT_INCOMPLETE','SOURCE_EVIDENCE_UNAVAILABLE','HARD_STOP_EXCEEDED')),
  "payment_binding_sha256" TEXT NOT NULL CHECK ("payment_binding_sha256" ~ '^[0-9a-f]{64}$'),
  "artifact_sha256" TEXT NOT NULL CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
  "claimed_by" TEXT,"claimed_at" TIMESTAMPTZ(3),"provider_attempt_key" TEXT UNIQUE,
  "provider_receipt_id" TEXT UNIQUE,"provider_receipt_sha256" TEXT UNIQUE,
  "verification_reason" TEXT,"verified_at" TIMESTAMPTZ(3),
  "confirmed_by" TEXT,"confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ot_neutral_refund_work_state" CHECK (
    ("status"='REFUND_REQUIRED' AND "claimed_by" IS NULL AND "claimed_at" IS NULL AND "provider_receipt_id" IS NULL AND "provider_receipt_sha256" IS NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "verification_reason" IS NULL AND "verified_at" IS NULL)
    OR ("status"='REFUND_CLAIMED' AND "claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "provider_attempt_key" ~ '^[0-9a-f-]{36}$' AND "provider_receipt_id" IS NULL AND "provider_receipt_sha256" IS NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "verification_reason" IS NULL AND "verified_at" IS NULL)
    OR ("status" IN ('RECEIPT_RECORDED_PENDING_VERIFICATION','RECEIPT_VERIFICATION_HELD') AND "claimed_by" IS NOT NULL AND "provider_receipt_id" ~ '^re_[A-Za-z0-9]{8,64}$' AND "provider_receipt_sha256" ~ '^[0-9a-f]{64}$' AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND (("status"='RECEIPT_RECORDED_PENDING_VERIFICATION' AND "verification_reason" IS NULL) OR ("status"='RECEIPT_VERIFICATION_HELD' AND "verification_reason" IS NOT NULL)))
    OR ("status"='REFUND_CONFIRMED' AND "claimed_by" IS NOT NULL AND "claimed_at" IS NOT NULL AND "provider_attempt_key" ~ '^[0-9a-f-]{36}$' AND "provider_receipt_id" ~ '^re_[A-Za-z0-9]{8,64}$' AND "provider_receipt_sha256" ~ '^[0-9a-f]{64}$' AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "verification_reason" IS NULL AND "verified_at" IS NOT NULL)
  )
);
CREATE INDEX "ot_neutral_refund_work_status_created_idx" ON "ot_neutral_refund_work"("status","created_at");
ALTER TABLE "ot_neutral_refund_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_refund_work" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_neutral_refund_work" FROM PUBLIC;
GRANT SELECT ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
GRANT INSERT ("id","qa_review_id","order_id","status","reason_code","payment_binding_sha256","artifact_sha256","updated_at") ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
GRANT UPDATE ("status","claimed_by","claimed_at","provider_attempt_key","provider_receipt_id","provider_receipt_sha256","verification_reason","verified_at","confirmed_by","confirmed_at","updated_at") ON TABLE "ot_neutral_refund_work" TO ot_neutral_runtime;
CREATE POLICY "ot_neutral_refund_work_runtime" ON "ot_neutral_refund_work" FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);

-- A reversal and the neutral hold are one atomic database fact. This trigger is
-- SECURITY DEFINER because reversal writers deliberately do not hold QA or
-- capability privileges. Its owner is a narrow NOLOGIN role and PUBLIC cannot
-- invoke it directly.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ot_neutral_reversal_guard_owner') THEN
   CREATE ROLE ot_neutral_reversal_guard_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("order_id","payment_intent") ON "ot_payment_binding" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("id","order_id","kind") ON "ot_fulfillment" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("payment_intent") ON "ot_settlement_reversal" TO ot_neutral_reversal_guard_owner;
GRANT SELECT,UPDATE ("status","minutes_spent","reason_code","decided_at","updated_at") ON "ot_neutral_qa_review" TO ot_neutral_reversal_guard_owner;
GRANT SELECT ("fulfillment_id","revoked_at") ON "ot_packet_download_capability" TO ot_neutral_reversal_guard_owner;
GRANT UPDATE ("revoked_at","revoked_reason_code") ON "ot_packet_download_capability" TO ot_neutral_reversal_guard_owner;
CREATE POLICY "ot_neutral_reversal_guard_qa" ON "ot_neutral_qa_review" FOR UPDATE TO ot_neutral_reversal_guard_owner USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_reversal_guard_qa_read" ON "ot_neutral_qa_review" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_payment_read" ON "ot_payment_binding" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_reversal_read" ON "ot_settlement_reversal" FOR SELECT TO ot_neutral_reversal_guard_owner USING (true);
CREATE POLICY "ot_neutral_reversal_guard_capability_read" ON "ot_packet_download_capability" FOR SELECT TO ot_neutral_reversal_guard_owner
USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE POLICY "ot_neutral_reversal_guard_capability_update" ON "ot_packet_download_capability" FOR UPDATE TO ot_neutral_reversal_guard_owner
USING (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'))
WITH CHECK (EXISTS (SELECT 1 FROM "ot_fulfillment" f JOIN "ot_payment_binding" b ON b."order_id"=f."order_id" JOIN "ot_settlement_reversal" x ON x."payment_intent"=b."payment_intent" WHERE f."id"="ot_packet_download_capability"."fulfillment_id" AND f."kind"::text='NEUTRAL_RECORDS_REPORT'));
CREATE OR REPLACE FUNCTION ot_neutral_hold_on_settlement_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.ot_neutral_qa_review q
 SET status='HELD',minutes_spent=COALESCE(q.minutes_spent,1),reason_code='PAYMENT_REVERSED',decided_at=clock_timestamp(),updated_at=clock_timestamp()
 FROM public.ot_payment_binding b
 WHERE b.payment_intent=NEW.payment_intent AND b.order_id=q.order_id
   AND q.status IN ('PENDING','IN_REVIEW','APPROVED');
 UPDATE public.ot_packet_download_capability c
 SET revoked_at=clock_timestamp(),revoked_reason_code='REFUNDED'
 FROM public.ot_fulfillment f, public.ot_payment_binding b
 WHERE b.payment_intent=NEW.payment_intent AND f.order_id=b.order_id
   AND f.kind='NEUTRAL_RECORDS_REPORT' AND c.fulfillment_id=f.id AND c.revoked_at IS NULL;
 RETURN NEW;
END $$;
ALTER FUNCTION ot_neutral_hold_on_settlement_reversal() OWNER TO ot_neutral_reversal_guard_owner;
REVOKE ALL ON FUNCTION ot_neutral_hold_on_settlement_reversal() FROM PUBLIC;
CREATE TRIGGER ot_neutral_hold_on_reversal AFTER INSERT ON "ot_settlement_reversal"
FOR EACH ROW EXECUTE FUNCTION ot_neutral_hold_on_settlement_reversal();
