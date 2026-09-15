/**
 * Bounded, default-off T2 delivery orchestration.
 *
 * One attempt per invocation. No inline retry, no scheduler, no backoff loop.
 * The lease expiry is the only recovery path, exactly as in the artifact
 * orchestrator this mirrors.
 *
 * **The adapter is a required, explicitly injected dependency with no default.**
 * With none supplied, this function returns BLOCKED having made zero store calls
 * and zero writes. A sender is not a small last step: it needs a verified
 * sending identity, a callback endpoint whose signatures are verified before any
 * event is admitted, and a normalization layer that maps provider payloads into
 * the bounded event vocabulary. A real adapter satisfying all three now exists
 * (t2-resend-adapter.ts), and it is still injected rather than imported here, so
 * this module keeps no provider dependency of its own and a test can drive the
 * whole ordering with a synthetic one.
 *
 * The ordering it enforces when an adapter IS supplied:
 *
 *   claim lease → persist attempt (durable, BEFORE the send) → send →
 *   record outcome → release lease
 *
 * A crash anywhere after the persist leaves a DELIVERY_PENDING summary, which
 * [[decideDeliverySend]] refuses to retry. Unresolved is a state we keep, never
 * one we resolve by guessing.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { t2DeliveryEnabled } from "@/lib/fulfillment/flag";
import type { DeliverySendOutcome } from "@/lib/fulfillment/delivery-orchestration";
import {
  prismaT2DeliveryStore,
  type T2DeliveryStore,
} from "@/lib/fulfillment-runtime/delivery-store";

/** Fixed five-minute lease. Long enough for one attempt, short enough to self-heal. */
export const T2_DELIVERY_LEASE_MS = 5 * 60 * 1000;

/**
 * The seam a real provider integration must satisfy.
 *
 * It receives an artifact IDENTITY, never bytes and never a recipient address:
 * resolving who to mail and attaching the packet is the adapter's job, and
 * keeping both out of this module means neither can reach a log or an event row
 * from here.
 */
export interface T2DeliveryAdapter {
  /** Bounded provider name, e.g. "resend". Recorded on the attempt row. */
  readonly provider: string;
  send(input: {
    orderId: string;
    fulfillmentId: string;
    attemptNumber: number;
    artifactVersion: number;
    artifactSha256: string;
    idempotencyKey: string;
  }): Promise<DeliverySendOutcome>;
}

export type T2DeliveryOrchestrationResult =
  | { outcome: "DISABLED" }
  | { outcome: "BLOCKED"; blocker: "NO_DELIVERY_ADAPTER" }
  | { outcome: "NOT_CLAIMED" }
  | { outcome: "NOT_ATTEMPTED"; blocker: string; released: boolean }
  | {
      outcome: "ATTEMPTED";
      attemptNumber: number;
      recorded: boolean;
      unresolved: boolean;
      released: boolean;
      /** Stored callbacks this send's message id made correlatable, if any. */
      reconciled: number;
    };

export type T2DeliveryOrchestrationDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  store?: T2DeliveryStore;
  adapter?: T2DeliveryAdapter;
  /**
   * Optional hook, invoked ONLY after an accepted send has durably recorded its
   * provider message id.
   *
   * This closes the send/callback race from the other side. A provider can
   * report `delivered` before this call returns, and no correlation tag is
   * assumed, so such an event was stored as unmatched. The moment the message id
   * becomes a real binding, that stored evidence is offered to it. Purely
   * additive: it sends nothing, mints nothing, and a failure here changes no
   * outcome, because the stored events remain available to the operator
   * recovery control.
   */
  reconcile?: (input: { providerMessageId: string }) => Promise<unknown>;
  now?: () => Date;
};

/**
 * Best effort by contract: a lease that cannot be cleared is not an error the
 * caller can act on, and the expiry recovers it. Never rethrows and never logs
 * the underlying failure, which could carry provider or connection detail.
 */
async function releaseQuietly(
  store: T2DeliveryStore,
  input: { fulfillmentId: string; owner: string; token: string },
): Promise<boolean> {
  try {
    return await store.release(input);
  } catch {
    return false;
  }
}

export async function runT2Delivery(
  input: { orderId: string; fulfillmentId: string },
  deps: T2DeliveryOrchestrationDeps = {},
): Promise<T2DeliveryOrchestrationResult> {
  if (!t2DeliveryEnabled(deps.env ?? process.env)) return { outcome: "DISABLED" };

  // Checked BEFORE the lease and before any write: with no adapter there is
  // nothing to send, so persisting an attempt would manufacture a failed
  // delivery record for a send that was never even possible.
  const adapter = deps.adapter;
  if (!adapter) return { outcome: "BLOCKED", blocker: "NO_DELIVERY_ADAPTER" };

  const store = deps.store ?? prismaT2DeliveryStore;
  const now = deps.now?.() ?? new Date();
  // Generated here, never supplied by a caller, so request-shaped data can never
  // assert a worker identity.
  const owner = `ot-t2-delivery:${randomUUID()}`;
  const token = randomUUID();

  const claimed = await store.claim({
    orderId: input.orderId,
    fulfillmentId: input.fulfillmentId,
    owner,
    token,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + T2_DELIVERY_LEASE_MS),
  });
  if (!claimed) return { outcome: "NOT_CLAIMED" };

  const lease = { fulfillmentId: input.fulfillmentId, owner, token };

  const persisted = await store.persistAttempt({
    orderId: input.orderId,
    fulfillmentId: input.fulfillmentId,
    provider: adapter.provider,
    owner, token,
  });
  if (!persisted.ok) {
    return {
      outcome: "NOT_ATTEMPTED",
      blocker: persisted.blocker,
      released: await releaseQuietly(store, lease),
    };
  }

  // Everything below this line happens with a durable attempt already on record.
  let sendOutcome: DeliverySendOutcome;
  try {
    sendOutcome = await adapter.send({
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      attemptNumber: persisted.attemptNumber,
      artifactVersion: persisted.artifactVersion,
      artifactSha256: persisted.artifactSha256,
      idempotencyKey: persisted.idempotencyKey,
    });
  } catch {
    // A thrown adapter may still have sent the mail. That is UNKNOWN, not
    // failure — and UNKNOWN records nothing, so no retry can duplicate it.
    sendOutcome = { kind: "UNKNOWN", provider: adapter.provider };
  }

  let recorded = false;
  let unresolved = true;
  try {
    const result = await store.recordOutcome({
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      attemptNumber: persisted.attemptNumber,
      outcome: sendOutcome,
    });
    if (result.ok) {
      recorded = result.recorded;
      unresolved = result.unresolved;
    }
  } catch {
    // Failing to record leaves the summary DELIVERY_PENDING — unresolved, and
    // therefore not automatically retryable. That is the safe default.
    recorded = false;
    unresolved = true;
  }

  // Only once the message id is DURABLY bound to this attempt. Reconciling on an
  // unrecorded outcome would offer stored evidence to a correlation that does
  // not exist yet, which is the guess this whole design refuses to make.
  let reconciled = 0;
  if (recorded && sendOutcome.kind === "ACCEPTED" && deps.reconcile) {
    try {
      const result = (await deps.reconcile({
        providerMessageId: sendOutcome.providerMessageId,
      })) as { applied?: unknown } | undefined;
      reconciled =
        typeof result?.applied === "number" ? result.applied : 0;
    } catch {
      // Never rethrown and never logged. The stored events are durable and stay
      // available to the bounded operator recovery control.
      reconciled = 0;
    }
  }

  return {
    outcome: "ATTEMPTED",
    attemptNumber: persisted.attemptNumber,
    recorded,
    unresolved,
    released: await releaseQuietly(store, lease),
    reconciled,
  };
}
