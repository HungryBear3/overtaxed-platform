-- Additive actor-attributed audit evidence for the one-way manual-review hold.
CREATE TABLE "ot_fulfillment_admin_event" (
    "id" TEXT NOT NULL,
    "fulfillment_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "OTFulfillmentStatus" NOT NULL,
    "to_status" "OTFulfillmentStatus" NOT NULL,
    "from_revision" INTEGER NOT NULL,
    "to_revision" INTEGER NOT NULL,
    "reason_code" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ot_fulfillment_admin_event_pkey" PRIMARY KEY ("id"),
    CHECK ("action" = 'ENTER_MANUAL_REVIEW'),
    CHECK ("to_status" = 'MANUAL_REVIEW'),
    CHECK ("reason_code" = 'MANUAL_REVIEW'),
    CHECK ("from_status" IN ('NOT_STARTED', 'NEEDS_RECONCILIATION', 'INCOMPLETE_INPUT', 'ARTIFACT_PENDING', 'ARTIFACT_READY')),
    CHECK ("from_revision" >= 0),
    CHECK ("to_revision" = "from_revision" + 1),
    CHECK (char_length("actor_user_id") BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX "ot_fulfillment_admin_event_fulfillment_id_to_revision_key"
ON "ot_fulfillment_admin_event"("fulfillment_id", "to_revision");

CREATE INDEX "ot_fulfillment_admin_event_fulfillment_id_created_at_idx"
ON "ot_fulfillment_admin_event"("fulfillment_id", "created_at");

ALTER TABLE "ot_fulfillment_admin_event"
ADD CONSTRAINT "ot_fulfillment_admin_event_fulfillment_id_fkey"
FOREIGN KEY ("fulfillment_id") REFERENCES "ot_fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;