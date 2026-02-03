-- Add subscription quantity and Stripe IDs to User (for slot capping and billing).
-- Run this in your database (e.g. Supabase SQL Editor) if you get P2022 "column does not exist".
-- Safe to run multiple times: columns are added only if missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'subscriptionQuantity'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "subscriptionQuantity" INTEGER;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'stripeCustomerId'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'stripeSubscriptionId'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "stripeSubscriptionId" TEXT;
  END IF;
END $$;
