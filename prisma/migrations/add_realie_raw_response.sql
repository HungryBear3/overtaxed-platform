-- Add full API response storage so we get rich subject data from 1 call.
-- Paste into Supabase SQL Editor → New query → Run (after RealieEnrichmentCache table exists).

ALTER TABLE "RealieEnrichmentCache"
ADD COLUMN IF NOT EXISTS "rawResponse" JSONB;
