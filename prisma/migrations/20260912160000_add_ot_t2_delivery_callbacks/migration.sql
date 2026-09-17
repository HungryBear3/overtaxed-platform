-- OT T2 delivery-evidence — provider callback ingestion + attempt/capability
-- association.
--
-- ADDITIVE ONLY. One new table, one new nullable column, one new unique index
-- and two new foreign keys. No previously deployed migration is altered or
-- replaced, no settlement/payment state is touched, no column is dropped or
-- retyped, and no row anywhere is backfilled, updated or deleted.
--
-- Everything this migration enables stays default-off at the application
-- boundary (OT_T2_DELIVERY_ADAPTER_ENABLED, OT_T2_DELIVERY_CALLBACK_ENABLED,
-- OT_T2_DELIVERY_RECOVERY_ENABLED — each a strict exact-"true" switch, and the
-- callback endpoint additionally fails closed without
-- OT_T2_RESEND_WEBHOOK_SECRET in every environment). Deploying this migration
-- activates nothing on its own.

-- ---------------------------------------------------------------------------
-- 1. ot_delivery_attempt.download_capability_id
--
-- The capability an attempt minted, so a revocation or an operator recovery can
-- identify the exact credential that attempt handed out instead of revoking by
-- fulfillment and hoping. Nullable: every attempt written before this slice has
-- none, and an attempt is durable BEFORE its capability exists.
--
-- UNIQUE, so one capability can never be claimed by two attempts. The FK is
-- non-destructive in both directions, matching the intra-evidence posture used
-- everywhere else here: losing a capability row must never erase the attempt
-- that records a send happened.
-- ---------------------------------------------------------------------------
ALTER TABLE "ot_delivery_attempt"
  ADD COLUMN "download_capability_id" TEXT;

CREATE UNIQUE INDEX "ot_delivery_attempt_download_capability_id_key"
  ON "ot_delivery_attempt"("download_capability_id");

ALTER TABLE "ot_delivery_attempt"
  ADD CONSTRAINT "ot_delivery_attempt_download_capability_id_fkey"
  FOREIGN KEY ("download_capability_id")
  REFERENCES "ot_packet_download_capability"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- 2. ot_delivery_provider_callback
--
-- One durable, sanitized row per authenticated provider callback.
--
-- The unique (provider, provider_event_id) is the replay identity and comes
-- from the SIGNED envelope, never from the body, so a forged payload cannot
-- choose its own dedup key.
--
-- The table also carries the send/callback race. A provider can report
-- `delivered` before the send call has returned the message id that would let us
-- correlate it, and no correlation tag is assumed — so such an event is stored
-- with disposition = 'UNMATCHED' and reconciled once the message id is bound,
-- rather than guessed onto an order or silently dropped.
--
-- CHECK constraints are structural invariants the application validators cannot
-- be bypassed on: bounded dispositions, bounded identifier lengths, an attempt
-- number that is a real positive attempt, and a callback that can never claim an
-- attempt without also naming its fulfillment.
--
-- There is deliberately NO foreign key to ot_fulfillment. A cascade would delete
-- the record of what a provider said about an order at the moment that order row
-- goes away, which is exactly the evidence a dispute needs.
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_delivery_provider_callback" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "event_type" "OTDeliveryEventType" NOT NULL,
    "reason_code" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disposition" TEXT NOT NULL,
    "disposition_code" TEXT,
    "fulfillment_id" TEXT,
    "attempt_number" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "replay_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_delivery_provider_callback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_delivery_provider_callback_disposition" CHECK ("disposition" IN ('APPLIED', 'UNMATCHED', 'REFUSED')),
    CONSTRAINT "ot_delivery_provider_callback_provider_bounded" CHECK ("provider" ~ '^[A-Za-z0-9._-]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_event_id_bounded" CHECK (char_length("provider_event_id") BETWEEN 1 AND 255),
    CONSTRAINT "ot_delivery_provider_callback_message_id_bounded" CHECK (char_length("provider_message_id") BETWEEN 1 AND 255),
    CONSTRAINT "ot_delivery_provider_callback_reason_bounded" CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[A-Z_]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_disposition_code_bounded" CHECK ("disposition_code" IS NULL OR "disposition_code" ~ '^[A-Z_]{1,64}$'),
    CONSTRAINT "ot_delivery_provider_callback_attempt_positive" CHECK ("attempt_number" IS NULL OR "attempt_number" >= 1),
    -- A callback can never name an attempt without naming the fulfillment it
    -- belongs to, so a half-bound row cannot exist.
    CONSTRAINT "ot_delivery_provider_callback_binding_complete" CHECK (
      "attempt_number" IS NULL OR "fulfillment_id" IS NOT NULL
    ),
    -- APPLIED means bound. An applied row with nothing to point at is a lie.
    CONSTRAINT "ot_delivery_provider_callback_applied_is_bound" CHECK (
      "disposition" <> 'APPLIED'
      OR ("fulfillment_id" IS NOT NULL AND "attempt_number" IS NOT NULL AND "resolved_at" IS NOT NULL)
    ),
    CONSTRAINT "ot_delivery_provider_callback_replay_bounded" CHECK ("replay_count" >= 0 AND "replay_count" <= 1000),
    CONSTRAINT "ot_delivery_provider_callback_received_order" CHECK ("resolved_at" IS NULL OR "resolved_at" >= "received_at")
);

CREATE UNIQUE INDEX "ot_delivery_provider_callback_provider_event_key"
  ON "ot_delivery_provider_callback"("provider", "provider_event_id");
CREATE INDEX "ot_delivery_provider_callback_message_id_idx"
  ON "ot_delivery_provider_callback"("provider_message_id");
CREATE INDEX "ot_delivery_provider_callback_disposition_idx"
  ON "ot_delivery_provider_callback"("disposition", "received_at");
CREATE INDEX "ot_delivery_provider_callback_fulfillment_id_idx"
  ON "ot_delivery_provider_callback"("fulfillment_id");

-- ---------------------------------------------------------------------------
-- 3. Access control, matching the posture the previous migration established
--    for the capability and quarantine tables. The callback log holds no PII,
--    but it is paid-order evidence and no API role has any business reading it.
-- ---------------------------------------------------------------------------
ALTER TABLE "ot_delivery_provider_callback" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ot_delivery_provider_callback" FROM PUBLIC;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "ot_delivery_provider_callback" FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
