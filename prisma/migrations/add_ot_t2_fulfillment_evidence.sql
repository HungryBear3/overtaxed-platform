-- REVIEW ONLY — DO NOT APPLY. Generated via 'prisma migrate diff' (offline, no DB, no shadow DB).
-- Additive T2 delivery-evidence foundation (Phase 1).
-- Intended migration name if adopted later: <UTCstamp>_add_ot_t2_fulfillment_evidence.
-- This loose .sql follows the repo add_*.sql convention and is NOT applied by 'prisma migrate'.
-- migration applications = 0.

-- CreateEnum
CREATE TYPE "OTFulfillmentKind" AS ENUM ('T2_APPEAL_EVIDENCE');

-- CreateEnum
CREATE TYPE "OTFulfillmentStatus" AS ENUM ('NOT_STARTED', 'NEEDS_RECONCILIATION', 'INELIGIBLE', 'INCOMPLETE_INPUT', 'MANUAL_REVIEW', 'ARTIFACT_PENDING', 'ARTIFACT_READY', 'DELIVERY_PENDING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OTDeliveryEventType" AS ENUM ('REQUESTED', 'ACCEPTED', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateTable
CREATE TABLE "ot_fulfillment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "kind" "OTFulfillmentKind" NOT NULL,
    "status" "OTFulfillmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "status_revision" INTEGER NOT NULL DEFAULT 0,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_reason_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ot_fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ot_fulfillment_artifact" (
    "id" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "artifact_sha256" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_locator" TEXT NOT NULL,
    "generator_version" TEXT NOT NULL,
    "template_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_fulfillment_artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ot_delivery_attempt" (
    "id" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "artifact_version" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_accepted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "delayed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "reason_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ot_delivery_event" (
    "id" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" "OTDeliveryEventType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reason_code" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_delivery_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ot_fulfillment_status_idx" ON "ot_fulfillment"("status");

-- CreateIndex
CREATE INDEX "ot_fulfillment_lease_expires_at_idx" ON "ot_fulfillment"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ot_fulfillment_order_id_kind_key" ON "ot_fulfillment"("order_id", "kind");

-- CreateIndex
CREATE INDEX "ot_fulfillment_artifact_artifact_sha256_idx" ON "ot_fulfillment_artifact"("artifact_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ot_fulfillment_artifact_fulfillment_id_version_key" ON "ot_fulfillment_artifact"("fulfillment_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ot_fulfillment_artifact_fulfillment_id_artifact_sha256_key" ON "ot_fulfillment_artifact"("fulfillment_id", "artifact_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ot_delivery_attempt_idempotency_key_key" ON "ot_delivery_attempt"("idempotency_key");

-- CreateIndex
CREATE INDEX "ot_delivery_attempt_fulfillment_id_idx" ON "ot_delivery_attempt"("fulfillment_id");

-- CreateIndex
CREATE INDEX "ot_delivery_attempt_fulfillment_id_artifact_version_idx" ON "ot_delivery_attempt"("fulfillment_id", "artifact_version");

-- CreateIndex
CREATE UNIQUE INDEX "ot_delivery_attempt_fulfillment_id_attempt_number_key" ON "ot_delivery_attempt"("fulfillment_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "ot_delivery_attempt_provider_provider_message_id_key" ON "ot_delivery_attempt"("provider", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ot_delivery_event_provider_provider_event_id_key" ON "ot_delivery_event"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ot_delivery_event_fulfillment_id_sequence_key" ON "ot_delivery_event"("fulfillment_id", "sequence");

-- AddForeignKey
ALTER TABLE "ot_fulfillment" ADD CONSTRAINT "ot_fulfillment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ot_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ot_fulfillment_artifact" ADD CONSTRAINT "ot_fulfillment_artifact_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ot_delivery_attempt" ADD CONSTRAINT "ot_delivery_attempt_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ot_delivery_attempt" ADD CONSTRAINT "ot_delivery_attempt_fulfillment_id_artifact_version_fkey" FOREIGN KEY ("fulfillment_id", "artifact_version") REFERENCES "ot_fulfillment_artifact"("fulfillment_id", "version") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ot_delivery_event" ADD CONSTRAINT "ot_delivery_event_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ot_delivery_event" ADD CONSTRAINT "ot_delivery_event_fulfillment_id_attempt_number_fkey" FOREIGN KEY ("fulfillment_id", "attempt_number") REFERENCES "ot_delivery_attempt"("fulfillment_id", "attempt_number") ON DELETE CASCADE ON UPDATE CASCADE;
