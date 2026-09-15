/**
 * Bounded, default-off T2 delivery orchestration.
 *
 * One attempt per invocation. No inline retry, no scheduler, no backoff loop.
 *
 * Lease expiry is the only recovery path for the LEASE — it frees a fulfillment
 * whose worker died holding it. It is emphatically not a send retry: a
 * fulfillment left at DELIVERY_PENDING is refused as UNRESOLVED_SEND no matter
 * how long its lease has been gone, so an expired lease can only ever unblock a
 * fulfillment that never advanced. Resolving an unresolved send needs a provider
 * event or an operator; nothing here does it automatically.
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
 *   claim lease → persist attempt (durable, BEFORE the send) →
 *   re-assert authority → send → record outcome → release lease
 *
 * The re-assert step is not decoration. Persisting first deliberately creates an
 * asynchronous gap, and a refund, a withdrawn flag, property drift or a lost
 * lease can land inside it. [[T2DeliveryStore.assertSendable]] re-reads the flag
 * and the authoritative settlement, artifact, property binding, lease and exact
 * pending attempt identity under the lock immediately before the adapter call.
 * That narrows the window to one transaction; it does not close it, and no
 * assumption is made that an adapter checks any of this.
 *
 * If the re-assert denies after the attempt is already durable, nothing is sent
 * and nothing is retried. The summary stays DELIVERY_PENDING — unresolved —
 * which [[decideDeliverySend]] refuses. Unresolved is a state we keep, never one
 * we resolve by guessing.
 *
 * A crash anywhere after the persist leaves the same DELIVERY_PENDING summary.
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
  /** The claim itself threw: whether a lease was taken is unknown. */
  | { outcome: "CLAIM_OUTCOME_UNKNOWN"; released: boolean }
  | { outcome: "NOT_ATTEMPTED"; blocker: string; released: boolean }
  /**
   * The persist threw. Whether the attempt committed is UNKNOWN, so nothing was
   * sent and nothing may be inferred: if it committed the summary is
   * DELIVERY_PENDING and refuses further attempts, and if it did not, the next
   * invocation starts cleanly.
   */
  | { outcome: "PERSIST_OUTCOME_UNKNOWN"; released: boolean }
  /**
   * A durable attempt exists but authority was gone at the pre-send gate. No
   * bytes were handed to a provider, and there is deliberately no retry.
   */
  | { outcome: "SEND_DENIED"; attemptNumber: number; blocker: string; released: boolean }
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
  // Generated here, never supplied by a caller, so request-shaped data can never
  // assert a worker identity. The expiry is derived from the database clock
  // inside the claim; this process only names a bounded duration.
  const owner = `ot-t2-delivery:${randomUUID()}`;
  const token = randomUUID();
  const lease = { fulfillmentId: input.fulfillmentId, owner, token };

  let claimed: boolean;
  try {
    claimed = await store.claim({
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      owner,
      token,
      leaseMs: T2_DELIVERY_LEASE_MS,
    });
  } catch {
    // A thrown claim may or may not have taken the lease. Nothing was sent, and
    // the release is conditional on our own owner/token, so it is safe either
    // way; the expiry recovers it if the release fails too.
    return {
      outcome: "CLAIM_OUTCOME_UNKNOWN",
      released: await releaseQuietly(store, lease),
    };
  }
  if (!claimed) return { outcome: "NOT_CLAIMED" };

  let persisted: Awaited<ReturnType<T2DeliveryStore["persistAttempt"]>>;
  try {
    persisted = await store.persistAttempt({
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      provider: adapter.provider,
      owner,
      token,
    });
  } catch {
    // The transaction outcome is unknown: the attempt may or may not be durable.
    // The one thing that must not happen is a send, because a durable attempt we
    // cannot see is exactly what a later invocation would refuse to duplicate.
    // The thrown value may carry connection detail and is never read or logged.
    return {
      outcome: "PERSIST_OUTCOME_UNKNOWN",
      released: await releaseQuietly(store, lease),
    };
  }
  if (!persisted.ok) {
    return {
      outcome: "NOT_ATTEMPTED",
      blocker: persisted.blocker,
      released: await releaseQuietly(store, lease),
    };
  }

  // Everything below this line happens with a durable attempt already on record.
  //
  // The flag is re-read first because it is free, then the store re-reads
  // everything it cannot: settlement, artifact identity, property binding, the
  // lease, and this exact pending attempt. No assumption is made that the
  // adapter checks any of it.
  let sendable: Awaited<ReturnType<T2DeliveryStore["assertSendable"]>>;
  if (!t2DeliveryEnabled(deps.env ?? process.env)) {
    sendable = { ok: false, blocker: "FLAG_DISABLED" };
  } else {
    try {
      sendable = await store.assertSendable({
        orderId: input.orderId,
        fulfillmentId: input.fulfillmentId,
        owner,
        token,
        attemptId: persisted.attemptId,
        attemptNumber: persisted.attemptNumber,
        idempotencyKey: persisted.idempotencyKey,
        provider: persisted.provider,
        artifactVersion: persisted.artifactVersion,
        artifactSha256: persisted.artifactSha256,
        propertyBindingFingerprint: persisted.propertyBindingFingerprint,
        statusRevision: persisted.statusRevision,
      });
    } catch {
      // Unable to prove the send is still authorized, so it is not made.
      sendable = { ok: false, blocker: "PRE_SEND_CHECK_UNKNOWN" };
    }
  }
  if (!sendable.ok) {
    // Deliberately no retry and no recorded failure. The attempt is durable and
    // the summary stays DELIVERY_PENDING, which the send authority refuses — the
    // ambiguity is left for a provider event or an operator.
    return {
      outcome: "SEND_DENIED",
      attemptNumber: persisted.attemptNumber,
      blocker: sendable.blocker,
      released: await releaseQuietly(store, lease),
    };
  }

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
