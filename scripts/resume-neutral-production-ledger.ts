import {
  reportProductionBaselineFailure,
  runProductionBaselineEntrypoint,
} from "./neutral-production-baseline-entrypoint";

runProductionBaselineEntrypoint("apply", "ledger-resume").catch(
  reportProductionBaselineFailure,
);
