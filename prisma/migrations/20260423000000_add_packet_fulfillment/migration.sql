-- Shared appeal-packet fulfillment on Invoice (no new table).
-- Extends the existing Invoice record so COMPS_ONLY ($69 DIY Pro) and future T3/T4
-- higher-touch tiers all share one fulfillment path.

-- Enum for packet status. Using IF NOT EXISTS pattern that's PG-compatible.
DO $$ BEGIN
  CREATE TYPE "PacketStatus" AS ENUM (
    'NOT_STARTED',
    'GENERATING',
    'READY',
    'DELIVERED',
    'MANUAL_REVIEW',
    'FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Invoice additions — all nullable / defaulted so this is safe on existing rows.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "packetAppealId"        TEXT,
  ADD COLUMN IF NOT EXISTS "packetStatus"          "PacketStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "packetPdfUrl"          TEXT,
  ADD COLUMN IF NOT EXISTS "packetPdfPath"         TEXT,
  ADD COLUMN IF NOT EXISTS "packetGeneratedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "packetDeliveredAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "packetLastError"       TEXT,
  ADD COLUMN IF NOT EXISTS "packetStripeSessionId" TEXT;

-- Idempotency anchor: the webhook looks up the invoice by Stripe session ID.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_packetStripeSessionId_key"
  ON "Invoice"("packetStripeSessionId");
