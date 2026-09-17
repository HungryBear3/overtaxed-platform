import {
  reportProductionBaselineFailure,
  runProductionBaselineEntrypoint,
} from "./neutral-production-baseline-entrypoint";

/**
 * The Production baseline APPLY entrypoint. Phase 5 only. It requires an
 * ABSENT/APPLY catalog and deletes any inherited resolve token.
 *
 * This command MUTATES PRODUCTION. It refuses to start without
 * OT_NEUTRAL_PRODUCTION_APPLY_CONFIRMATION set to the exact apply token for the
 * approved marker instance, and it does not fall back to a rehearsal if the
 * token is absent or wrong — rehearsing is what
 * `scripts/rehearse-neutral-production-baseline.ts` is for, and an apply command
 * that sometimes rehearses produces receipts nobody can tell apart.
 *
 * Phase 6 uses resume-neutral-production-ledger.ts, which requires a
 * COMPLETE/REPLAY catalog and can never execute the baseline body.
 */
runProductionBaselineEntrypoint("apply").catch(reportProductionBaselineFailure);
