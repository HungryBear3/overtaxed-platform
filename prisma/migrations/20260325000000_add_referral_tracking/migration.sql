-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;

-- Seed initial referral code for John Grafft
INSERT INTO "Referral" ("id", "code", "name", "visits", "conversions", "revenue", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'john', 'John Grafft', 0, 0, 0, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
