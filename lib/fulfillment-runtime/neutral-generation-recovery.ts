import "server-only";

import { prismaNeutralGenerationStore } from "@/lib/fulfillment-runtime/neutral-generation-store";
import {
  NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
  NEUTRAL_GENERATION_ITEM_RESERVE_MS,
  runNeutralReportGeneration,
  type NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";

/**
 * Authenticated recovery sweep.
 *
 * The candidate query keeps its full limit: selecting a row is what reconciles
 * an expired `PRODUCING` lease, and that must still happen for every row the
 * sweep sees. What is bounded is how many complete productions one invocation
 * *starts*. Running ten sequentially under an undeclared route duration was the
 * routine way to be killed mid-production and strand a row in terminal
 * `RECONCILIATION_REQUIRED`; items that do not fit the remaining budget are
 * left untouched for the next run instead.
 */
export async function sweepNeutralReportGeneration(
  deps: {
    env?: Readonly<Record<string, string | undefined>>;
    store?: Pick<NeutralGenerationStore, "candidates">;
    run?: typeof runNeutralReportGeneration;
    now?: () => number;
  } = {},
): Promise<{
  reviewed: number;
  completed: number;
  failed: number;
  deferred: number;
}> {
  const env = deps.env ?? process.env;
  if (
    env.OT_NEUTRAL_REPORT_RECOVERY_ENABLED !== "true" ||
    env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED !== "true"
  )
    return { reviewed: 0, completed: 0, failed: 0, deferred: 0 };
  const now = deps.now ?? Date.now;
  const deadline = now() + NEUTRAL_GENERATION_INVOCATION_BUDGET_MS;
  const store = deps.store ?? prismaNeutralGenerationStore;
  const ids = await store.candidates({ limit: 10 });
  let completed = 0;
  let failed = 0;
  let deferred = 0;
  for (const workId of ids) {
    if (deadline - now() < NEUTRAL_GENERATION_ITEM_RESERVE_MS) {
      deferred++;
      continue;
    }
    try {
      const result = await (deps.run ?? runNeutralReportGeneration)(
        { workId },
        { env, deadline },
      );
      if (result.outcome === "COMPLETE") completed++;
      else if (result.outcome === "DEFERRED") deferred++;
      else failed++;
    } catch {
      failed++;
      console.error("[ot-neutral-generation-recovery] item=THREW");
    }
  }
  return { reviewed: ids.length, completed, failed, deferred };
}
