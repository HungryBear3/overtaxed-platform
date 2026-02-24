-- Realie enrichment cache: one row per PIN so we only call Realie API once per property.
-- Paste this into Supabase: SQL Editor → New query → Run

CREATE TABLE IF NOT EXISTS "RealieEnrichmentCache" (
  "id" TEXT NOT NULL,
  "pin" TEXT NOT NULL,
  "livingArea" INTEGER,
  "yearBuilt" INTEGER,
  "bedrooms" INTEGER,
  "bathrooms" DECIMAL(65,30),
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RealieEnrichmentCache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RealieEnrichmentCache_pin_key" UNIQUE ("pin")
);

CREATE INDEX IF NOT EXISTS "RealieEnrichmentCache_pin_idx" ON "RealieEnrichmentCache"("pin");
