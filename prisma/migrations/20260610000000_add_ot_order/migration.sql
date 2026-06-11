-- CreateTable (uses lowercase name to avoid Supabase RLS trigger bug with quoted identifiers)
CREATE TABLE "ot_order" (
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

    CONSTRAINT "ot_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ot_order_stripe_session_id_key" ON "ot_order"("stripeSessionId");

-- CreateIndex
CREATE INDEX "ot_order_email_idx" ON "ot_order"("email");

-- CreateIndex
CREATE INDEX "ot_order_stripe_session_id_idx" ON "ot_order"("stripeSessionId");

-- CreateIndex
CREATE INDEX "ot_order_created_at_idx" ON "ot_order"("createdAt");
