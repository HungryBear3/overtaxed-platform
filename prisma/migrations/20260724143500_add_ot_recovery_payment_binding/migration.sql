-- Persist the incoming settled Stripe payment independently when it does not
-- match the OTOrder's original durable Checkout Session binding.
ALTER TABLE "ot_order"
  ADD COLUMN "recoveryStripeSessionId" TEXT,
  ADD COLUMN "recoveryStripeEventId" TEXT;

CREATE INDEX "ot_order_recoveryStripeSessionId_idx"
  ON "ot_order"("recoveryStripeSessionId");
