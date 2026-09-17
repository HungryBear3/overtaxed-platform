import {
  reportProductionBaselineFailure,
  runProductionBaselineEntrypoint,
} from "./neutral-production-baseline-entrypoint";

/**
 * The Production baseline APPLY entrypoint. Phase 5, and Phase 6 with the
 * resolve token added.
 *
 * This command MUTATES PRODUCTION. It refuses to start without
 * OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION set to the exact apply token for the
 * approved marker instance, and it does not fall back to a rehearsal if the
 * token is absent or wrong — rehearsing is what
 * `scripts/rehearse-neutral-production-baseline.ts` is for, and an apply command
 * that sometimes rehearses produces receipts nobody can tell apart.
 *
 * With OT_NEUTRAL_PRODUCTION_RESOLVE_CONFIRMATION also set, it records the
 * covered migrations with `prisma migrate resolve` after the schema has been
 * verified inside the transaction and again on a separate connection. That step
 * is resumable: a run interrupted part-way re-reads the ledger, skips every
 * migration already recorded, and continues from the first one that is not.
 */
runProductionBaselineEntrypoint("apply").catch(reportProductionBaselineFailure);
