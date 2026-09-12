import "server-only";
import { after } from "next/server";
import { t2ArtifactOrchestrationEnabled } from "@/lib/fulfillment/flag";
import type {
  T2FulfillmentKickoffOrder,
  T2FulfillmentKickoffResult,
} from "./kickoff";

type SchedulingDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  after?: (callback: () => Promise<void>) => void;
  run?: (input: { orderId: string; fulfillmentId: string }) => Promise<unknown>;
};

// Registration errors propagate so the webhook can release its event claim.
export function scheduleT2ArtifactOrchestration(
  order: T2FulfillmentKickoffOrder,
  result: T2FulfillmentKickoffResult,
  deps: SchedulingDeps = {},
): boolean {
  const env = deps.env ?? process.env;
  if (
    !t2ArtifactOrchestrationEnabled(env) ||
    order.tier !== "T2" ||
    order.status !== "PAID" ||
    order.refunded ||
    order.disputed ||
    result.outcome !== "PERSISTED" ||
    result.status !== "ARTIFACT_PENDING"
  )
    return false;
  const input = { orderId: order.id, fulfillmentId: result.fulfillmentId };
  (deps.after ?? after)(async () => {
    if (!t2ArtifactOrchestrationEnabled(env)) return;
    try {
      const run =
        deps.run ??
        (await import("./t2-artifact-orchestrator")).runT2ArtifactOrchestration;
      await run(input);
    } catch {
      // No raw provider/DB exception or customer identifier enters logs.
      console.error("[ot-artifact-orchestration] outcome=THREW");
    }
  });
  return true;
}
