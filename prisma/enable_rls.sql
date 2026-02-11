-- ============================================
-- Row Level Security (RLS) - Supabase Linter Fix
-- ============================================
-- Run this in Supabase SQL Editor to resolve:
-- 1. rls_disabled_in_public - Enable RLS on all public tables
-- 2. sensitive_columns_exposed - CountyConfig.apiKey protected by RLS
--
-- Your app uses Prisma with DATABASE_URL (postgres role), which bypasses RLS.
-- Enabling RLS blocks direct PostgREST/Data API access (anon/authenticated)
-- while Prisma continues to work normally.
--
-- With RLS enabled and no permissive policies = implicit DENY for API clients.
-- ============================================

-- Enable RLS on all public tables
ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TermsAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AssessmentHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Appeal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ComparableProperty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AppealDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MonitoringJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CountyConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RealieEnrichmentCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."_AppealToComparableProperty" ENABLE ROW LEVEL SECURITY;

-- No policies are added intentionally.
-- With RLS enabled and zero permissive policies:
-- - PostgREST/Data API (anon, authenticated) = DENY (no rows)
-- - Prisma (postgres role via DATABASE_URL) = bypasses RLS, full access
