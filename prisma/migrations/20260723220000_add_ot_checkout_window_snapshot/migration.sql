-- Narrow OT checkout/window-gate release only.
-- Additive except for allowing a durable OTOrder before Stripe Session creation.
ALTER TABLE "ot_order"
  ALTER COLUMN "stripeSessionId" DROP NOT NULL,
  ADD COLUMN "checkoutKey" TEXT,
  ADD COLUMN "township" TEXT,
  ADD COLUMN "windowStatus" TEXT,
  ADD COLUMN "windowOpenDate" TIMESTAMP(3),
  ADD COLUMN "windowCloseDate" TIMESTAMP(3),
  ADD COLUMN "windowSourceUpdated" TEXT,
  ADD COLUMN "windowVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "eligibilitySnapshot" JSONB,
  ADD COLUMN "analysisAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgmentVersion" TEXT,
  ADD COLUMN "acknowledgmentEvidence" JSONB,
  ADD COLUMN "reassessmentNoticeDate" TIMESTAMP(3),
  ADD COLUMN "reassessmentNoticeAddress" TEXT,
  ADD COLUMN "noticeEvidence" JSONB,
  ADD COLUMN "noticeReviewStatus" TEXT,
  ADD COLUMN "noticeReviewActionAt" TIMESTAMP(3),
  ADD COLUMN "noticeReviewActionBy" TEXT,
  ADD COLUMN "contractKey" TEXT,
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkoutSessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "checkoutPriceId" TEXT,
  ADD COLUMN "checkoutProductId" TEXT,
  ADD COLUMN "checkoutAmountCents" INTEGER,
  ADD COLUMN "checkoutCurrency" TEXT,
  ADD COLUMN "settledAmountCents" INTEGER,
  ADD COLUMN "settledCurrency" TEXT,
  ADD COLUMN "recoveryReason" TEXT;

CREATE UNIQUE INDEX "ot_order_checkoutKey_key" ON "ot_order"("checkoutKey");
CREATE UNIQUE INDEX "ot_order_contractKey_key" ON "ot_order"("contractKey");
