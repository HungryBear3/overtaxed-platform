CREATE TABLE "free_check_followup_subscriber" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "emailConsentAt" TIMESTAMP(3) NOT NULL,
  "emailConsentSource" TEXT NOT NULL,
  "emailConsentVersion" TEXT NOT NULL,
  "phoneE164" TEXT,
  "smsConsentAt" TIMESTAMP(3),
  "smsConsentSource" TEXT,
  "smsConsentVersion" TEXT,
  "township" TEXT,
  "propertyAddress" TEXT,
  "potentialSavings" DOUBLE PRECISION,
  "resultUrl" TEXT NOT NULL DEFAULT '/',
  "unsubscribeToken" TEXT NOT NULL,
  "emailSuppressedAt" TIMESTAMP(3),
  "smsSuppressedAt" TIMESTAMP(3),
  "smsSuppressionReason" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "free_check_followup_subscriber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "free_check_followup_message" (
  "id" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "free_check_followup_message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "free_check_followup_subscriber_unsubscribeToken_key" ON "free_check_followup_subscriber"("unsubscribeToken");
CREATE UNIQUE INDEX "free_check_followup_subscriber_emailNormalized_emailConsentVersion_key" ON "free_check_followup_subscriber"("emailNormalized", "emailConsentVersion");
CREATE INDEX "free_check_followup_subscriber_emailNormalized_idx" ON "free_check_followup_subscriber"("emailNormalized");
CREATE INDEX "free_check_followup_subscriber_phoneE164_idx" ON "free_check_followup_subscriber"("phoneE164");
CREATE INDEX "free_check_followup_subscriber_createdAt_idx" ON "free_check_followup_subscriber"("createdAt");
CREATE UNIQUE INDEX "free_check_followup_message_idempotencyKey_key" ON "free_check_followup_message"("idempotencyKey");
CREATE UNIQUE INDEX "free_check_followup_message_subscriberId_step_channel_key" ON "free_check_followup_message"("subscriberId", "step", "channel");
CREATE INDEX "free_check_followup_message_status_scheduledFor_idx" ON "free_check_followup_message"("status", "scheduledFor");
CREATE INDEX "free_check_followup_message_leaseUntil_idx" ON "free_check_followup_message"("leaseUntil");
ALTER TABLE "free_check_followup_message" ADD CONSTRAINT "free_check_followup_message_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "free_check_followup_subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
