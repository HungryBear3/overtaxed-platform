-- OT T2 delivery-evidence Phase 2 Slice 2 — exact artifact provenance binding.
--
-- ADDITIVE ONLY. This migration adds three nullable columns and one index to the
-- already-deployed `ot_fulfillment_artifact` table. It does not alter or replace
-- any previously deployed migration, does not touch settlement/payment state,
-- and does not backfill any row.
--
-- Constraint decision: the invariants this slice needs for idempotency and
-- concurrency are ALREADY enforced by the Phase 1 unique indexes
--   ot_fulfillment_artifact_fulfillment_id_version_key
--   ot_fulfillment_artifact_fulfillment_id_artifact_sha256_key
-- so no new unique index is introduced. Shape validation (lowercase-hex digest,
-- bounded byte size, private non-bearer locator) is enforced in one place, the
-- application validators in lib/fulfillment/validation.ts; duplicating those as
-- SQL CHECKs would create a second source of truth that can silently drift.

ALTER TABLE "ot_fulfillment_artifact"
  ADD COLUMN "generated_at" TIMESTAMP(3),
  ADD COLUMN "source_order_id" TEXT,
  ADD COLUMN "property_binding_fingerprint" TEXT;

-- Provenance is all-or-nothing: a row either carries the complete Slice 2
-- provenance triple or none of it. This prevents a half-populated binding from
-- ever looking like verified provenance.
ALTER TABLE "ot_fulfillment_artifact"
  ADD CONSTRAINT "ot_fulfillment_artifact_provenance_complete" CHECK (
    (
      "generated_at" IS NULL
      AND "source_order_id" IS NULL
      AND "property_binding_fingerprint" IS NULL
    )
    OR (
      "generated_at" IS NOT NULL
      AND "source_order_id" IS NOT NULL
      AND "property_binding_fingerprint" IS NOT NULL
    )
  );

CREATE INDEX "ot_fulfillment_artifact_source_order_id_idx"
  ON "ot_fulfillment_artifact"("source_order_id");
