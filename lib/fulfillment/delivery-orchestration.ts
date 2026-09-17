/**
 * OT T2 delivery-evidence — bounded delivery dispatch decisions (PURE layer).
 *
 * This module answers exactly two questions and owns neither the sending nor the
 * writing:
 *
 *   1. `decideDeliveryDispatch` — may a delivery attempt be created right now,
 *      and if so with which attempt number and idempotency key? It composes the
 *      existing authorities rather than restating them: [[decideDeliverySend]]
 *      for "is a send safe from this state", and
 *      [[buildFulfillmentIdempotencyKey]] for the key. Nothing new is invented.
 *
 *   2. `decideSendOutcomeRecord` — given what the provider adapter reported,
 *      what may be written down?
 *
 * The second is where the dangerous distinctions live, so they are stated once,
 * here, and enforced structurally:
 *
 *   - **accepted is not delivered.** An adapter that returns success has told us
 *     the provider took custody. That folds to PROVIDER_ACCEPTED via the shared
 *     [[nextStatusForEvent]] authority. Only a provider DELIVERED webhook can
 *     ever produce DELIVERED, and no code path here can manufacture one.
 *   - **unknown is not failure, and never a resend.** A thrown or ambiguous
 *     adapter call may have sent the mail. It records NO event and NO status
 *     change, so the summary stays DELIVERY_PENDING — which
 *     [[decideDeliverySend]] already refuses as UNRESOLVED_SEND. The result is
 *     that an unresolved send can only be resolved by a provider event or an
 *     operator, never by an automatic retry.
 *   - **terminal never resurrects.** Every transition is routed through
 *     [[nextStatusForEvent]], which returns null for every TERMINAL_LOCK status.
 *
 * Pure: no database, no provider, no clock, no framework.
 */
import {
  buildFulfillmentIdempotencyKey,
  type FulfillmentIdempotencyPurpose,
} from "@/lib/fulfillment/idempotency";
import { decideDeliverySend } from "@/lib/fulfillment/retry";
import { canTransition, nextStatusForEvent } from "@/lib/fulfillment/state";
import type {
  OTDeliveryEventType,
  OTFulfillmentStatus,
} from "@/lib/fulfillment/types";
import {
  isPgIntInRange,
  isValidArtifactSha256,
  isValidInstant,
  isValidProviderMessageId,
  isValidProviderName,
  isValidReasonCode,
  PG_INT_MAX,
} from "@/lib/fulfillment/validation";

export type DeliveryDispatchInput = {
  flagEnabled: boolean;
  orderId: string;
  fulfillmentId: string;
  status: OTFulfillmentStatus | string;
  statusRevision: number;
  attemptCount: number;
  maxAttempts: number;
  provider: string;
  artifactVersion: number;
  artifactSha256: string;
  generatorVersion: string;
  templateVersion?: string;
};

export type DeliveryDispatchPlan = {
  fulfillmentId: string;
  attemptNumber: number;
  artifactVersion: number;
  idempotencyKey: string;
  provider: string;
  purpose: FulfillmentIdempotencyPurpose;
  fromStatus: OTFulfillmentStatus;
  nextStatus: "DELIVERY_PENDING";
  expectedStatusRevision: number;
  /** The attempt row and its REQUESTED event are written BEFORE any send. */
  requestEventType: "REQUESTED";
};

export type DeliveryDispatchDecision =
  | { ok: true; plan: DeliveryDispatchPlan }
  | { ok: false; blocker: string };

/**
 * Decide whether to create a delivery attempt.
 *
 * A refusal reason from [[decideDeliverySend]] is passed through unchanged so
 * the vocabulary stays single-sourced (ALREADY_DELIVERED, TERMINAL_*,
 * UNRESOLVED_SEND, MAX_ATTEMPTS, …).
 */
export function decideDeliveryDispatch(
  input: DeliveryDispatchInput,
): DeliveryDispatchDecision {
  if (input.flagEnabled !== true) return { ok: false, blocker: "FLAG_DISABLED" };
  if (!isValidProviderName(input.provider))
    return { ok: false, blocker: "INVALID_PROVIDER" };
  if (!isPgIntInRange(input.statusRevision, 0, PG_INT_MAX - 1))
    return { ok: false, blocker: "INVALID_STATUS_REVISION" };
  if (!isPgIntInRange(input.artifactVersion, 1, PG_INT_MAX))
    return { ok: false, blocker: "INVALID_ARTIFACT_VERSION" };
  if (!isValidArtifactSha256(input.artifactSha256))
    return { ok: false, blocker: "INVALID_ARTIFACT_SHA256" };

  // The send authority owns every lifecycle/counter gate, including refusing an
  // unresolved in-flight send. It is never second-guessed here.
  const send = decideDeliverySend({
    status: input.status as OTFulfillmentStatus,
    attemptCount: input.attemptCount,
    maxAttempts: input.maxAttempts,
  });
  if (!send.send) return { ok: false, blocker: send.reason };

  // The transition to DELIVERY_PENDING must be an allowed edge under the shared
  // transition authority, or this is not a send at all. [[canTransition]] is the
  // right authority here rather than [[nextStatusForEvent]]: the latter folds
  // PROVIDER events, and a locally originated delivery request is a transition
  // we make, not an event a provider reports. The transition table still admits
  // the DELAYED → DELIVERY_PENDING edge because an operator path may one day
  // need it; [[decideDeliverySend]] above has already refused that status, and
  // it — not the table — is the send authority.
  if (!canTransition(input.status as OTFulfillmentStatus, "DELIVERY_PENDING"))
    return { ok: false, blocker: "NOT_SENDABLE" };

  const key = buildFulfillmentIdempotencyKey({
    orderId: input.orderId,
    kind: "T2_APPEAL_EVIDENCE",
    tier: "T2",
    attemptNumber: send.attemptNumber,
    artifactSha256: input.artifactSha256,
    generatorVersion: input.generatorVersion,
    templateVersion: input.templateVersion,
    purpose: "DELIVERY",
  });
  if (!key.ok) return { ok: false, blocker: key.reason };

  return {
    ok: true,
    plan: {
      fulfillmentId: input.fulfillmentId,
      attemptNumber: send.attemptNumber,
      artifactVersion: input.artifactVersion,
      idempotencyKey: key.key,
      provider: input.provider,
      purpose: "DELIVERY",
      fromStatus: input.status as OTFulfillmentStatus,
      nextStatus: "DELIVERY_PENDING",
      expectedStatusRevision: input.statusRevision,
      requestEventType: "REQUESTED",
    },
  };
}

/**
 * What a transactional adapter reported.
 *
 * `UNKNOWN` is a first-class outcome, not an error case bolted on: a timeout, a
 * dropped connection, or a thrown call all mean the same thing — the mail may
 * be in flight — and that must be representable without lying in either
 * direction.
 */
export type DeliverySendOutcome =
  | { kind: "ACCEPTED"; provider: string; providerMessageId: string }
  | { kind: "REJECTED"; provider: string; reasonCode: string }
  | { kind: "UNKNOWN"; provider: string };

export type DeliveryOutcomeRecord = {
  /** Null when nothing may be written down about this outcome. */
  eventType: OTDeliveryEventType | null;
  nextStatus: OTFulfillmentStatus | null;
  providerMessageId: string | null;
  reasonCode: string | null;
  /** False whenever an automatic resend would risk a duplicate delivery. */
  resendAllowed: false;
  /** True only for an outcome that leaves the send unresolved. */
  unresolved: boolean;
};

export type DeliveryOutcomeDecision =
  | { ok: true; record: DeliveryOutcomeRecord }
  | { ok: false; blocker: string };

/**
 * Decide what a send outcome permits us to record.
 *
 * `resendAllowed` is typed as the literal `false`. There is no adapter outcome
 * in this slice that authorizes an automatic resend, and making that a type
 * rather than a runtime value means a future edit cannot quietly introduce one
 * without changing the contract in the open.
 */
export function decideSendOutcomeRecord(input: {
  status: OTFulfillmentStatus | string;
  outcome: DeliverySendOutcome;
  occurredAt: string;
}): DeliveryOutcomeDecision {
  const { outcome } = input;
  if (!outcome || !isValidProviderName(outcome.provider))
    return { ok: false, blocker: "INVALID_PROVIDER" };
  if (!isValidInstant(input.occurredAt))
    return { ok: false, blocker: "UNTRUSTED_CLOCK" };

  if (outcome.kind === "UNKNOWN") {
    // Deliberately writes nothing. The summary stays DELIVERY_PENDING, which the
    // send authority refuses to retry, so the ambiguity is preserved until a
    // provider event or an operator resolves it.
    return {
      ok: true,
      record: {
        eventType: null,
        nextStatus: null,
        providerMessageId: null,
        reasonCode: null,
        resendAllowed: false,
        unresolved: true,
      },
    };
  }

  const status = input.status as OTFulfillmentStatus;
  if (outcome.kind === "ACCEPTED") {
    if (!isValidProviderMessageId(outcome.providerMessageId))
      return { ok: false, blocker: "INVALID_PROVIDER_MESSAGE_ID" };
    // ACCEPTED, never DELIVERED. The fold is the only authority for the edge,
    // so a terminal-locked summary yields null and nothing is written.
    const nextStatus = nextStatusForEvent(status, "ACCEPTED");
    if (nextStatus === null)
      return { ok: false, blocker: "OUTCOME_NOT_APPLICABLE" };
    return {
      ok: true,
      record: {
        eventType: "ACCEPTED",
        nextStatus,
        providerMessageId: outcome.providerMessageId,
        reasonCode: null,
        resendAllowed: false,
        unresolved: false,
      },
    };
  }

  if (!isValidReasonCode(outcome.reasonCode))
    return { ok: false, blocker: "INVALID_REASON_CODE" };
  const nextStatus = nextStatusForEvent(status, "FAILED");
  if (nextStatus === null)
    return { ok: false, blocker: "OUTCOME_NOT_APPLICABLE" };
  return {
    ok: true,
    record: {
      eventType: "FAILED",
      nextStatus,
      providerMessageId: null,
      reasonCode: outcome.reasonCode,
      resendAllowed: false,
      unresolved: false,
    },
  };
}
