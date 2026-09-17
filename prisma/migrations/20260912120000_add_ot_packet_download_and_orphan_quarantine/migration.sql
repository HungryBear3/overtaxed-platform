-- OT T2 delivery-evidence — secure packet download capability + durable orphan
-- quarantine.
--
-- ADDITIVE ONLY. Two new tables. No previously deployed migration is altered or
-- replaced, no settlement/payment state is touched, no existing table is
-- modified, and no row anywhere is backfilled, updated or deleted.
--
-- Both tables stay default-off at the application boundary
-- (OT_T2_PACKET_DOWNLOAD_ENABLED, and quarantine writes only occur on a path
-- that already requires OT_T2_ARTIFACT_BINDING_ENABLED), so deploying this
-- migration activates nothing on its own.

-- ---------------------------------------------------------------------------
-- 1. ot_packet_download_capability
--
-- Stores ONLY a persistent SHA-256 hash of a high-entropy capability value. The
-- value itself is never a column, never a URL segment, and never logged. The
-- CHECKs below are structural invariants that the application validators cannot
-- be bypassed on: a 64-char lowercase-hex hash and digest, a strictly positive
-- bounded use budget, a use count that can never exceed it, and an expiry that
-- is strictly after issuance.
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_packet_download_capability" (
    "id" TEXT NOT NULL,
    "capability_hash" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "artifact_version" INTEGER NOT NULL,
    "artifact_sha256" TEXT NOT NULL,
    "source_order_id" TEXT NOT NULL,
    "property_binding_fingerprint" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_packet_download_capability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_packet_download_capability_hash_shape" CHECK ("capability_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_digest_shape" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_fingerprint_shape" CHECK ("property_binding_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_packet_download_capability_version_positive" CHECK ("artifact_version" >= 1),
    CONSTRAINT "ot_packet_download_capability_uses_bounded" CHECK ("max_uses" BETWEEN 1 AND 1000),
    CONSTRAINT "ot_packet_download_capability_use_count_bounded" CHECK ("use_count" >= 0 AND "use_count" <= "max_uses"),
    CONSTRAINT "ot_packet_download_capability_expiry_after_issue" CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "ot_packet_download_capability_revocation_complete" CHECK (
      ("revoked_at" IS NULL AND "revoked_reason_code" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_reason_code" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "ot_packet_download_capability_capability_hash_key"
  ON "ot_packet_download_capability"("capability_hash");
CREATE INDEX "ot_packet_download_capability_fulfillment_id_idx"
  ON "ot_packet_download_capability"("fulfillment_id");
CREATE INDEX "ot_packet_download_capability_expires_at_idx"
  ON "ot_packet_download_capability"("expires_at");

-- Parent teardown removes capabilities with the fulfillment.
ALTER TABLE "ot_packet_download_capability"
  ADD CONSTRAINT "ot_packet_download_capability_fulfillment_id_fkey"
  FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Intra-evidence identity FK, matching ot_delivery_attempt: a capability can
-- only ever name an immutable artifact version of its OWN fulfillment, and is
-- non-destructive in both directions.
ALTER TABLE "ot_packet_download_capability"
  ADD CONSTRAINT "ot_packet_download_capability_artifact_fkey"
  FOREIGN KEY ("fulfillment_id", "artifact_version")
  REFERENCES "ot_fulfillment_artifact"("fulfillment_id", "version")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- 2. ot_artifact_orphan_quarantine
--
-- One durable row per (fulfillment, storage locator, expected content digest)
-- whose bind outcome was unknown or refused after bytes may have reached private
-- storage. The unique key makes recording idempotent: a repeat observation
-- increments a counter instead of inserting a second row. The locator is part of
-- the key because a provider that returns an unexpected locator has placed bytes
-- somewhere else, and that second location must not be folded away.
--
-- There is deliberately NO foreign key to ot_fulfillment. A cascade would delete
-- the exact record stating that bytes may exist in private storage — which is
-- the fact an operator needs most after the parent row is gone.
-- ---------------------------------------------------------------------------
CREATE TABLE "ot_artifact_orphan_quarantine" (
    "id" TEXT NOT NULL,
    "storage_locator" TEXT NOT NULL,
    "artifact_sha256" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "source_order_id" TEXT NOT NULL,
    "upload_outcome" TEXT NOT NULL,
    "first_reason_code" TEXT NOT NULL,
    "last_reason_code" TEXT NOT NULL,
    "observation_count" INTEGER NOT NULL DEFAULT 1,
    "first_observed_at" TIMESTAMP(3) NOT NULL,
    "last_observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_artifact_orphan_quarantine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ot_artifact_orphan_quarantine_digest_shape" CHECK ("artifact_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ot_artifact_orphan_quarantine_upload_outcome" CHECK ("upload_outcome" IN ('CONFIRMED', 'UNKNOWN')),
    CONSTRAINT "ot_artifact_orphan_quarantine_observation_count" CHECK ("observation_count" >= 1),
    CONSTRAINT "ot_artifact_orphan_quarantine_observed_order" CHECK ("last_observed_at" >= "first_observed_at"),
    -- Private internal locator only: no scheme, no absolute path, no query or
    -- fragment. A public bearer URL cannot be stored here.
    CONSTRAINT "ot_artifact_orphan_quarantine_locator_private" CHECK (
      "storage_locator" ~ '^[A-Za-z0-9._/-]+$'
      AND "storage_locator" NOT LIKE '/%'
      AND char_length("storage_locator") BETWEEN 1 AND 512
    )
);

CREATE UNIQUE INDEX "ot_artifact_orphan_quarantine_fulfillment_locator_digest_key"
  ON "ot_artifact_orphan_quarantine"("fulfillment_id", "storage_locator", "artifact_sha256");
CREATE INDEX "ot_artifact_orphan_quarantine_artifact_sha256_idx"
  ON "ot_artifact_orphan_quarantine"("artifact_sha256");
CREATE INDEX "ot_artifact_orphan_quarantine_last_observed_at_idx"
  ON "ot_artifact_orphan_quarantine"("last_observed_at");
