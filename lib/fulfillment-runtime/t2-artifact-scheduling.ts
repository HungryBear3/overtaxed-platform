import "server-only";
import { after } from "next/server";
import {
  t2ArtifactOrchestrationEnabled,
  t2DeliveryEnabled,
} from "@/lib/fulfillment/flag";
import type {
  T2FulfillmentKickoffOrder,
  T2FulfillmentKickoffResult,
} from "./kickoff";

type OrchestrationOutcome = {
  outcome?: unknown;
  workflowOutcome?: unknown;
  released?: unknown;
};

type SchedulingDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  after?: (callback: () => Promise<void>) => void;
  run?: (input: { orderId: string; fulfillmentId: string }) => Promise<unknown>;
  /**
   * Delivery, injected so this module keeps no provider dependency. Called ONLY
   * after the artifact workflow reports BOUND and its lease is released.
   */
  deliver?: (input: {
    orderId: string;
    fulfillmentId: string;
  }) => Promise<unknown>;
};

/**
 * Exactly the artifact-workflow outcome that means an immutable packet now
 * exists for this fulfillment, with its producing lease already given back.
 *
 * Both halves matter. BOUND without a released lease means the artifact
 * orchestrator still holds the fulfillment, and delivery's own claim would lose
 * the race and do nothing useful; waiting for the release makes the handoff an
 * ordering rather than a retry. Any other outcome — REFUSED, UNAVAILABLE,
 * RECONCILIATION_REQUIRED, DISABLED, a throw — means there is nothing to deliver,
 * and delivery is not attempted at all rather than attempted and blocked.
 */
function boundAndReleased(result: unknown): boolean {
  const value = result as OrchestrationOutcome | null | undefined;
  return (
    !!value &&
    value.outcome === "RAN" &&
    value.workflowOutcome === "BOUND" &&
    value.released === true
  );
}

/**
 * Build the real delivery caller, or nothing.
 *
 * Returning undefined rather than a partly-wired caller is deliberate: the
 * delivery orchestrator makes zero store calls and zero writes without an
 * adapter, so an unconfigured deployment cannot manufacture a delivery record
 * for a send that was never possible. The adapter itself additionally validates
 * its full configuration and returns null if any part is missing.
 */
async function realDelivery(
  env: Readonly<Record<string, string | undefined>>,
): Promise<
  ((input: { orderId: string; fulfillmentId: string }) => Promise<unknown>) | undefined
> {
  if (!t2DeliveryEnabled(env)) return undefined;
  const { createT2ResendAdapter } = await import("./t2-resend-adapter");
  const adapter = createT2ResendAdapter({ env });
  if (!adapter) return undefined;
  const { runT2Delivery } = await import("./t2-delivery-orchestrator");
  const { reconcileT2ResendCallbacks } = await import("./t2-resend-events");
  return (input) =>
    runT2Delivery(input, {
      env,
      adapter,
      // Offers already-stored provider evidence to the message id this send
      // binds, closing the callback-before-send-response race without ever
      // guessing an unmatched event onto an order.
      reconcile: (bound) => reconcileT2ResendCallbacks(bound, { env }),
    });
}

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
    let orchestration: unknown;
    try {
      const run =
        deps.run ??
        (await import("./t2-artifact-orchestrator")).runT2ArtifactOrchestration;
      orchestration = await run(input);
    } catch {
      // No raw provider/DB exception or customer identifier enters logs.
      console.error("[ot-artifact-orchestration] outcome=THREW");
      return;
    }

    // Delivery is a SEPARATE step behind its own gates, reached only from a
    // bound artifact. It never regenerates, never reaches for an older artifact
    // version, and never runs on a workflow outcome that produced no packet.
    if (!boundAndReleased(orchestration)) return;
    try {
      const deliver = deps.deliver ?? (await realDelivery(env));
      if (!deliver) return;
      await deliver(input);
    } catch {
      console.error("[ot-t2-delivery] outcome=THREW");
    }
  });
  return true;
}
