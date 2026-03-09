-- Add Cook County form fields: relationship type, purchase/refinance (Q3)
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "relationshipType" TEXT DEFAULT 'OWNER';
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "purchasedInPast3Years" BOOLEAN;
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "purchasePrice" TEXT;
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "dateOfPurchase" TIMESTAMP(3);
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "rateType" TEXT;
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "interestRate" TEXT;
