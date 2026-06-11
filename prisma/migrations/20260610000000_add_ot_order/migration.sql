-- CreateTable
CREATE TABLE "OTOrder" (
    "id" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "propertyAddress" TEXT,
    "propertyPin" TEXT,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OTOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OTOrder_stripeSessionId_key" ON "OTOrder"("stripeSessionId");

-- CreateIndex
CREATE INDEX "OTOrder_email_idx" ON "OTOrder"("email");

-- CreateIndex
CREATE INDEX "OTOrder_stripeSessionId_idx" ON "OTOrder"("stripeSessionId");

-- CreateIndex
CREATE INDEX "OTOrder_createdAt_idx" ON "OTOrder"("createdAt");
