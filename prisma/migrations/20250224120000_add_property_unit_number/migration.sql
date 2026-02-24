-- Add unitNumber to Property for condos when Cook County doesn't include it
-- Idempotent: safe to run even if column already exists (e.g. added manually)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "unitNumber" TEXT;
