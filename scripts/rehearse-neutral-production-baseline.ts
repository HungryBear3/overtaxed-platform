import {
  reportProductionBaselineFailure,
  runProductionBaselineEntrypoint,
} from "./neutral-production-baseline-entrypoint";

/**
 * The Production baseline REHEARSAL entrypoint. Phase 3.
 *
 * It connects on DIRECT_URL, opens a transaction, runs the real preflight
 * against the real catalog, applies the entire baseline, proves every
 * postcondition — the SQL checks, the role inventory and the login-to-functional
 * role binding graph, the same set the durable verification proves — and then
 * ROLLS THE TRANSACTION BACK. Production is unchanged when it finishes, whether
 * it passed or failed.
 *
 * It cannot apply. The first thing it does is delete both confirmation tokens
 * from `process.env`, so a token still exported from an earlier shell is not
 * merely ignored by a branch somewhere — it is not present for any branch to
 * read, and no child process can inherit it either.
 */
runProductionBaselineEntrypoint("rehearsal").catch(
  reportProductionBaselineFailure,
);
