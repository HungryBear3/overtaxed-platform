import "server-only";

import { randomUUID } from "node:crypto";
import { t2ArtifactOrchestrationEnabled } from "@/lib/fulfillment/flag";
import {
  prismaT2ArtifactOrchestrationStore,
  type T2ArtifactOrchestrationStore,
} from "@/lib/fulfillment-runtime/orchestration-store";
import {
  runT2ArtifactBindingWorkflow,
  type T2ArtifactWorkflowResult,
} from "@/lib/fulfillment-runtime/t2-artifact-workflow";

/**
 * The runtime caller the reviewed binding workflow never had.
 *
 * Until this module existed, a paid T2 settlement reached `ARTIFACT_PENDING`
 * and stopped: nothing in the webhook, kickoff, cron or admin surfaces invoked
 * `runT2ArtifactBindingWorkflow`. This closes that gap and nothing else.
 *
 * Three properties are deliberate.
 *
 * **It cannot open itself.** `OT_T2_ARTIFACT_ORCHESTRATION_ENABLED` is its own
 * strict exact-"true" gate, independent of the binding and evidence flags. With
 * it absent — which is every environment — this function makes no store call,
 * no workflow call, and no write. `OT_T2_ARTIFACT_BINDING_ENABLED` is still
 * checked separately inside the workflow, so two switches must be thrown before
 * any artifact can be produced.
 *
 * **Exactly one caller can run per row.** The claim is an atomic lease over the
 * exact `ARTIFACT_PENDING` fulfillment, taken under the same lock ordering the
 * binder uses. Concurrent duplicate webhooks converge there: one claims, the
 * rest are refused without invoking anything.
 *
 * **It adds no authority.** One workflow attempt per claim, no inline retry, no
 * scheduler. It never creates an artifact, never advances a status, never
 * creates a delivery attempt or event, and never sends. The five-minute lease
 * expiry is the only recovery path in this slice.
 */

/** Fixed five-minute lease. Long enough for one attempt, short enough to self-heal. */
export const T2_ARTIFACT_LEASE_MS = 5 * 60 * 1000;

export type T2ArtifactOrchestrationResult =
  | { outcome: "DISABLED" }
  | { outcome: "NOT_CLAIMED" }
  | {
      outcome: "RAN";
      workflowOutcome: T2ArtifactWorkflowResult["outcome"];
      released: boolean;
    }
  | { outcome: "THREW"; released: boolean };

export type T2ArtifactOrchestrationDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: T2ArtifactOrchestrationStore;
  run?: (input: {
    orderId: string;
    fulfillmentId: string;
  }) => Promise<{ outcome: T2ArtifactWorkflowResult["outcome"] }>;
  now?: () => Date;
};

/**
 * Best effort by contract: a lease that cannot be cleared is not an error the
 * caller can act on, and the expiry recovers it. Never rethrows, never logs the
 * underlying failure, which could carry provider or connection detail.
 */
async function releaseQuietly(
  store: T2ArtifactOrchestrationStore,
  input: { fulfillmentId: string; owner: string; token: string },
): Promise<boolean> {
  try {
    return await store.release(input);
  } catch {
    return false;
  }
}

export async function runT2ArtifactOrchestration(
  input: { orderId: string; fulfillmentId: string },
  deps: T2ArtifactOrchestrationDeps = {},
): Promise<T2ArtifactOrchestrationResult> {
  if (!t2ArtifactOrchestrationEnabled(deps.env ?? process.env)) {
    return { outcome: "DISABLED" };
  }

  const store = deps.store ?? prismaT2ArtifactOrchestrationStore;
  const run = deps.run ?? runT2ArtifactBindingWorkflow;
  const now = deps.now?.() ?? new Date();
  // Bounded, opaque, single-line, and generated here — never supplied by a
  // caller, so request-shaped data can never assert an identity.
  const owner = `ot-t2-orchestrator:${randomUUID()}`;
  const token = randomUUID();

  const claimed = await store.claim({
    orderId: input.orderId,
    fulfillmentId: input.fulfillmentId,
    owner,
    token,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + T2_ARTIFACT_LEASE_MS),
  });
  if (!claimed) return { outcome: "NOT_CLAIMED" };

  const lease = { fulfillmentId: input.fulfillmentId, owner, token };
  let workflowOutcome: T2ArtifactWorkflowResult["outcome"];
  try {
    workflowOutcome = (
      await run({
        orderId: input.orderId,
        fulfillmentId: input.fulfillmentId,
      })
    ).outcome;
  } catch {
    // The thrown value is deliberately not read: it may carry provider text,
    // source data or connection detail, and none of that may be returned.
    return { outcome: "THREW", released: await releaseQuietly(store, lease) };
  }
  return {
    outcome: "RAN",
    workflowOutcome,
    released: await releaseQuietly(store, lease),
  };
}
