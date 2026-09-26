-- Additive, old-binary-safe operator ledgers for neutral manual QA and delivery
-- evidence. Three neutral-owned relations, zero changes to existing tables.
--
-- None of these relations carries a customer identifier, an email, an address,
-- a provider payload, a capability, or any clear external reference: only ids,
-- lowercase hex digests, closed codes, `admin:<id>` actor keys, and instants.
--
-- Slice 1 scope note. This migration DEFINES "ot_neutral_manual_delivery" so
-- that Slice 2 is code-only, but Slice 1 introduces no manual-delivery write
-- path, so the runtime role is granted SELECT on it and nothing else. The
-- INSERT/UPDATE grants that the transition store will need are a separate
-- additive migration in Slice 2, reviewed with the code that uses them.
CREATE TYPE "OTNeutralManualDeliveryStatus" AS ENUM (
  'PREPARED','RECORDED','CONFIRMED','VOIDED'
);

-- ---------------------------------------------------------------------------
-- 1. Durable, insert-only order classification.
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_neutral_order_classification" (
  "order_id" TEXT PRIMARY KEY,
  "class" TEXT NOT NULL,
  "actor_key" TEXT NOT NULL,
  "note_code" TEXT,
  "classified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_neutral_classification_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_classification_class_shape" CHECK ("class" IN ('CUSTOMER','OWNER_TEST','NEGATIVE_TEST','SAMPLE')),
  CONSTRAINT "ot_neutral_classification_actor_shape" CHECK ("actor_key" ~ '^admin:[A-Za-z0-9_-]{1,128}$'),
  CONSTRAINT "ot_neutral_classification_note_shape" CHECK ("note_code" IS NULL OR "note_code" IN (
    'OWNER_FULL_PRICE_TEST','OWNER_REFUSAL_PATH_TEST','REHEARSAL','PILOT_CUSTOMER'
  ))
);

-- ---------------------------------------------------------------------------
-- 2. Append-only operator artifact-read audit.
--
-- "sha256" is the digest of the bytes ACTUALLY SERVED, verified by the storage
-- helper before the row is written. "reservation_bundle_sha256" is the
-- reservation bundle identity in force at that moment. Both are required: the
-- first is what I-8 audits, the second is what makes a QA approval refuse a
-- read of superseded bytes without comparing a component digest to a bundle
-- digest.
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_neutral_operator_artifact_read" (
  "id" TEXT PRIMARY KEY,
  "reservation_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "actor_key" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "artifact_kind" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "reservation_bundle_sha256" TEXT NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "served_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_neutral_operator_read_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_operator_read_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_operator_read_actor_shape" CHECK ("actor_key" ~ '^admin:[A-Za-z0-9_-]{1,128}$'),
  CONSTRAINT "ot_neutral_operator_read_digest_shape" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "reservation_bundle_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ot_neutral_operator_read_size_shape" CHECK ("byte_size" > 0 AND "byte_size" <= 67108864),
  CONSTRAINT "ot_neutral_operator_read_state_shape" CHECK (
    ("purpose" = 'QA_REVIEW' AND "artifact_kind" IN ('INTERNAL_PDF','INTERNAL_CSV'))
    OR ("purpose" = 'DELIVERY_PREPARE' AND "artifact_kind" = 'CUSTOMER_ZIP')
  )
);

CREATE INDEX "ot_neutral_operator_read_lookup_idx"
  ON "ot_neutral_operator_artifact_read"("reservation_id","actor_key","purpose","served_at");

-- ---------------------------------------------------------------------------
-- 3. Manual delivery ledger (defined here, driven in Slice 2).
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_neutral_manual_delivery" (
  "id" TEXT PRIMARY KEY,
  "reservation_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "qa_review_id" TEXT NOT NULL,
  "fulfillment_id" TEXT NOT NULL,
  "customer_artifact_sha256" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "property_binding_fingerprint" TEXT NOT NULL,
  "payment_binding_sha256" TEXT NOT NULL,
  "status" "OTNeutralManualDeliveryStatus" NOT NULL DEFAULT 'PREPARED',
  "status_revision" INTEGER NOT NULL DEFAULT 0,
  "prepared_by" TEXT NOT NULL,
  "prepared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prepare_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_by" TEXT,
  "recorded_at" TIMESTAMPTZ(3),
  "channel_code" TEXT,
  "external_reference_sha256" TEXT,
  "recipient_binding_sha256" TEXT,
  "confirmed_by" TEXT,
  "confirmed_at" TIMESTAMPTZ(3),
  "confirmation_code" TEXT,
  "voided_by" TEXT,
  "voided_at" TIMESTAMPTZ(3),
  "void_reason_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ot_neutral_manual_delivery_reservation_fkey" FOREIGN KEY ("reservation_id") REFERENCES "ot_neutral_report_reservation"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_manual_delivery_order_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_manual_delivery_qa_fkey" FOREIGN KEY ("qa_review_id") REFERENCES "ot_neutral_qa_review"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  -- I-1: delivery evidence cannot exist for a digest that has no durable
  -- artifact row. The composite target is the artifact table's own
  -- (fulfillment_id, artifact_sha256) unique key.
  CONSTRAINT "ot_neutral_manual_delivery_artifact_fkey" FOREIGN KEY ("fulfillment_id","customer_artifact_sha256") REFERENCES "ot_fulfillment_artifact"("fulfillment_id","artifact_sha256") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "ot_neutral_manual_delivery_digest_shape" CHECK (
    "customer_artifact_sha256" ~ '^[0-9a-f]{64}$'
    AND "payment_binding_sha256" ~ '^[0-9a-f]{64}$'
    AND ("external_reference_sha256" IS NULL OR "external_reference_sha256" ~ '^[0-9a-f]{64}$')
    AND ("recipient_binding_sha256" IS NULL OR "recipient_binding_sha256" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "ot_neutral_manual_delivery_actor_shape" CHECK (
    "prepared_by" ~ '^admin:[A-Za-z0-9_-]{1,128}$'
    AND ("recorded_by" IS NULL OR "recorded_by" ~ '^admin:[A-Za-z0-9_-]{1,128}$')
    AND ("confirmed_by" IS NULL OR "confirmed_by" ~ '^admin:[A-Za-z0-9_-]{1,128}$')
    AND ("voided_by" IS NULL OR "voided_by" ~ '^admin:[A-Za-z0-9_-]{1,128}$')
  ),
  CONSTRAINT "ot_neutral_manual_delivery_code_shape" CHECK (
    ("channel_code" IS NULL OR "channel_code" IN ('SUPPORT_MAILBOX_EMAIL','OWNER_HAND_DELIVERY'))
    AND ("confirmation_code" IS NULL OR "confirmation_code" IN ('CUSTOMER_REPLY','MAILBOX_SENT_EVIDENCE','OWNER_ATTESTATION'))
    AND ("void_reason_code" IS NULL OR "void_reason_code" IN ('PAYMENT_REVERSED','ARTIFACT_SUPERSEDED','QA_BINDING_DRIFT','PREPARE_EXPIRED','OPERATOR_VOID'))
  ),
  CONSTRAINT "ot_neutral_manual_delivery_counters_shape" CHECK ("status_revision" >= 0),
  -- Each status pins exactly which per-transition columns are set. A VOIDED row
  -- keeps whatever RECORDED facts it had (all four or none of them), because the
  -- send it attests to is evidence that outlives the void.
  CONSTRAINT "ot_neutral_manual_delivery_state_shape" CHECK (
    ("status" = 'PREPARED' AND "recorded_by" IS NULL AND "recorded_at" IS NULL AND "channel_code" IS NULL AND "external_reference_sha256" IS NULL AND "recipient_binding_sha256" IS NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "confirmation_code" IS NULL AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason_code" IS NULL)
    OR ("status" = 'RECORDED' AND "recorded_by" IS NOT NULL AND "recorded_at" IS NOT NULL AND "channel_code" IS NOT NULL AND "external_reference_sha256" IS NOT NULL AND "recipient_binding_sha256" IS NOT NULL AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "confirmation_code" IS NULL AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason_code" IS NULL AND "status_revision" > 0)
    OR ("status" = 'CONFIRMED' AND "recorded_by" IS NOT NULL AND "recorded_at" IS NOT NULL AND "channel_code" IS NOT NULL AND "external_reference_sha256" IS NOT NULL AND "recipient_binding_sha256" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "confirmation_code" IS NOT NULL AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason_code" IS NULL AND "status_revision" > 0)
    OR ("status" = 'VOIDED' AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "confirmation_code" IS NULL AND "voided_by" IS NOT NULL AND "voided_at" IS NOT NULL AND "void_reason_code" IS NOT NULL AND "status_revision" > 0
        AND (("recorded_by" IS NULL AND "recorded_at" IS NULL AND "channel_code" IS NULL AND "external_reference_sha256" IS NULL AND "recipient_binding_sha256" IS NULL)
          OR ("recorded_by" IS NOT NULL AND "recorded_at" IS NOT NULL AND "channel_code" IS NOT NULL AND "external_reference_sha256" IS NOT NULL AND "recipient_binding_sha256" IS NOT NULL)))
  )
);

-- I-2: one active delivery per reservation, and at most one confirmed one ever.
CREATE UNIQUE INDEX "ot_neutral_manual_delivery_active_key"
  ON "ot_neutral_manual_delivery"("reservation_id")
  WHERE "status" IN ('PREPARED','RECORDED','CONFIRMED');
CREATE UNIQUE INDEX "ot_neutral_manual_delivery_confirmed_key"
  ON "ot_neutral_manual_delivery"("reservation_id")
  WHERE "status" = 'CONFIRMED';
CREATE INDEX "ot_neutral_manual_delivery_status_idx"
  ON "ot_neutral_manual_delivery"("status","updated_at");

-- ---------------------------------------------------------------------------
-- Row level security, PUBLIC/API revocation, least-privilege runtime grants.
-- ---------------------------------------------------------------------------
ALTER TABLE "ot_neutral_order_classification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_order_classification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_operator_artifact_read" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_operator_artifact_read" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_manual_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ot_neutral_manual_delivery" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "ot_neutral_order_classification" FROM PUBLIC;
REVOKE ALL ON TABLE "ot_neutral_operator_artifact_read" FROM PUBLIC;
REVOKE ALL ON TABLE "ot_neutral_manual_delivery" FROM PUBLIC;

DO $$ DECLARE role_name TEXT; table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['ot_neutral_order_classification','ot_neutral_operator_artifact_read','ot_neutral_manual_delivery'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;

REVOKE ALL ON TABLE "ot_neutral_order_classification" FROM ot_neutral_runtime;
REVOKE ALL ON TABLE "ot_neutral_operator_artifact_read" FROM ot_neutral_runtime;
REVOKE ALL ON TABLE "ot_neutral_manual_delivery" FROM ot_neutral_runtime;

-- Classification is insert-only (I-11). "classified_at" is deliberately absent
-- from the INSERT column list so the instant is always the database clock.
GRANT SELECT ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime;
GRANT INSERT ("order_id","class","actor_key","note_code") ON TABLE "ot_neutral_order_classification" TO ot_neutral_runtime;

-- The read audit is append-only. "served_at" is likewise database-clock only.
GRANT SELECT ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime;
GRANT INSERT ("id","reservation_id","order_id","actor_key","purpose","artifact_kind","sha256","reservation_bundle_sha256","byte_size") ON TABLE "ot_neutral_operator_artifact_read" TO ot_neutral_runtime;

-- Slice 1 reads the manual-delivery ledger only, to derive DELIVERY_READY.
GRANT SELECT ON TABLE "ot_neutral_manual_delivery" TO ot_neutral_runtime;

CREATE POLICY "ot_neutral_runtime_order_classification" ON "ot_neutral_order_classification"
  FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_operator_artifact_read" ON "ot_neutral_operator_artifact_read"
  FOR ALL TO ot_neutral_runtime USING (true) WITH CHECK (true);
CREATE POLICY "ot_neutral_runtime_manual_delivery" ON "ot_neutral_manual_delivery"
  FOR SELECT TO ot_neutral_runtime USING (true);

-- ---------------------------------------------------------------------------
-- Migration-time verification.
--
-- `has_table_privilege(role, table, 'A,B')` has ANY semantics, so it is true
-- when the role holds either privilege. Every required privilege is therefore
-- proved on its own and every forbidden privilege refused on its own, for the
-- runtime role and for each Supabase API role. Column-level INSERT grants are
-- proved column by column for the same reason.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  role_name TEXT;
  privilege TEXT;
  table_name TEXT;
  column_name TEXT;
  policy_name TEXT;
  forbidden TEXT[] := ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  all_privileges TEXT[] := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  ledger_tables TEXT[] := ARRAY['ot_neutral_order_classification','ot_neutral_operator_artifact_read','ot_neutral_manual_delivery'];
BEGIN
  FOREACH table_name IN ARRAY ledger_tables LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = table_name::regclass) THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: % is not ENABLE+FORCE row level security', table_name;
    END IF;
    policy_name := CASE table_name
      WHEN 'ot_neutral_order_classification' THEN 'ot_neutral_runtime_order_classification'
      WHEN 'ot_neutral_operator_artifact_read' THEN 'ot_neutral_runtime_operator_artifact_read'
      ELSE 'ot_neutral_runtime_manual_delivery' END;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name
        AND policyname=policy_name AND 'ot_neutral_runtime'=ANY(roles) AND qual IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: % lacks its runtime policy', table_name;
    END IF;
    -- SELECT is required on all three; UPDATE is forbidden on all three.
    IF NOT has_table_privilege('ot_neutral_runtime', table_name, 'SELECT') THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role lacks SELECT on %', table_name;
    END IF;
    IF has_table_privilege('ot_neutral_runtime', table_name, 'UPDATE') THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role retains UPDATE on %', table_name;
    END IF;
    FOREACH privilege IN ARRAY forbidden LOOP
      IF has_table_privilege('ot_neutral_runtime', table_name, privilege) THEN
        RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role retains % on %', privilege, table_name;
      END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        FOREACH privilege IN ARRAY all_privileges LOOP
          IF has_table_privilege(role_name, table_name, privilege) THEN
            RAISE EXCEPTION 'neutral operator ledger API role % retains table privilege % on %', role_name, privilege, table_name;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Slice 1 grants no manual-delivery write path of any kind.
  IF has_table_privilege('ot_neutral_runtime','ot_neutral_manual_delivery','INSERT') THEN
    RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role retains INSERT on ot_neutral_manual_delivery';
  END IF;

  -- Column-level INSERT: exactly the intended columns, and never the clock.
  FOREACH column_name IN ARRAY ARRAY['order_id','class','actor_key','note_code'] LOOP
    IF NOT has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification',column_name,'INSERT') THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role lacks INSERT on ot_neutral_order_classification.%', column_name;
    END IF;
  END LOOP;
  IF has_column_privilege('ot_neutral_runtime','ot_neutral_order_classification','classified_at','INSERT') THEN
    RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role may set ot_neutral_order_classification.classified_at';
  END IF;
  FOREACH column_name IN ARRAY ARRAY['id','reservation_id','order_id','actor_key','purpose','artifact_kind','sha256','reservation_bundle_sha256','byte_size'] LOOP
    IF NOT has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read',column_name,'INSERT') THEN
      RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role lacks INSERT on ot_neutral_operator_artifact_read.%', column_name;
    END IF;
  END LOOP;
  IF has_column_privilege('ot_neutral_runtime','ot_neutral_operator_artifact_read','served_at','INSERT') THEN
    RAISE EXCEPTION 'neutral operator ledger runtime security verification failed: runtime role may set ot_neutral_operator_artifact_read.served_at';
  END IF;
END $$;
