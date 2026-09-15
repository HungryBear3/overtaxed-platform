-- OT confirmation-email delivery evidence — Phase 1.
--
-- ADDITIVE ONLY and old-writer compatible: five nullable columns on the
-- already-deployed "ot_order" table. The currently deployed writer never
-- references these columns, so its INSERTs and UPDATEs are unaffected. No
-- historical financial state is rewritten and no backfill is performed:
-- NULL across all five columns is the truthful "never attempted" state for
-- every existing row. No index is added — the columns are evidence read via
-- the order row itself, not a query surface, in this slice.

ALTER TABLE "ot_order"
  ADD COLUMN "confirmationEmailStatus" TEXT,
  ADD COLUMN "confirmationEmailAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "confirmationEmailSentAt" TIMESTAMP(3),
  ADD COLUMN "confirmationEmailMessageId" TEXT,
  ADD COLUMN "confirmationEmailErrorClass" TEXT;
