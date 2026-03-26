-- CreateTable
CREATE TABLE IF NOT EXISTS "DripEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sequence" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DripEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DripEmail_scheduledFor_sentAt_idx" ON "DripEmail"("scheduledFor", "sentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DripEmail_email_sequence_idx" ON "DripEmail"("email", "sequence");
