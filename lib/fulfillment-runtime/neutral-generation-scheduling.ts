import "server-only";

import { after } from "next/server";
import { prismaNeutralGenerationStore } from "@/lib/fulfillment-runtime/neutral-generation-store";
import {
  NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
  runNeutralReportGeneration,
  type NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";

export async function enqueueAndScheduleNeutralReportProduction(
  orderId: string,
  deps: {
    env?: Readonly<Record<string, string | undefined>>;
    store?: Pick<NeutralGenerationStore, "ensure">;
    after?: (callback: () => Promise<void>) => void;
    run?: typeof runNeutralReportGeneration;
    now?: () => number;
    /** Absolute route deadline measured from request entry when available. */
    deadline?: number;
  } = {},
): Promise<
  { outcome: "DISABLED" | "REFUSED" } | { outcome: "SCHEDULED"; workId: string }
> {
  const env = deps.env ?? process.env;
  if (env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED !== "true")
    return { outcome: "DISABLED" };
  // Measured from enqueue. The `after()` callback runs once the webhook has
  // responded, and the headroom the budget leaves under the declared route
  // duration absorbs the part of the invocation already spent verifying and
  // settling the event.
  const deadline = deps.deadline ??
    (deps.now?.() ?? Date.now()) + NEUTRAL_GENERATION_INVOCATION_BUDGET_MS;
  const work = await (deps.store ?? prismaNeutralGenerationStore).ensure(
    orderId,
  );
  if (!work)
    return { outcome: "REFUSED" };

    // Registration is deliberately synchronous and after durable enqueue. If
    // Next rejects it, the exception reaches the webhook claim-release path.
  (deps.after ?? after)(async () => {
    if (env.OT_NEUTRAL_REPORT_PRODUCTION_ENABLED !== "true") return;
    try {
      await (deps.run ?? runNeutralReportGeneration)(
        { workId: work.workId },
        { env, deadline },
      );
    } catch {
      console.error("[ot-neutral-generation] outcome=THREW");
    }
  });
  return { outcome: "SCHEDULED", workId: work.workId };
}
