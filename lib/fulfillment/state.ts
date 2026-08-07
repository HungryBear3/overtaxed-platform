/**
 * OT T2 delivery-evidence foundation — state machine & append-only event folding.
 *
 * Pure and database-free. Two concerns:
 *   1. `canTransition` / `ALLOWED_TRANSITIONS` — the allowed monotonic status
 *      edges, used to model (not perform) admin/worker transitions.
 *   2. `foldDeliveryEvent` / `foldDeliveryEvents` — deterministic folding of an
 *      append-only provider-event log into the summary status. Folding is
 *      idempotent (exact replays are ignored), monotonic (out-of-order/stale
 *      events never regress), fail-closed (malformed or conflicting evidence is
 *      rejected), and terminal-safe (a bounced / complained / cancelled / failed
 *      state is never resurrected).
 *
 * Provider "accepted" is never treated as "delivered". A delivery retry is not
 * modeled here as regeneration (see retry.ts).
 */
import type {
  OTDeliveryEventType,
  OTFulfillmentStatus,
} from "@/lib/fulfillment/types";
import { TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types";
import {
  isPgIntInRange,
  isValidInstant,
  isValidProviderEventId,
  isValidProviderName,
  PG_INT_MAX,
} from "@/lib/fulfillment/validation";

/** Allowed status→status edges. Terminal-lock states have no outgoing edges. */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<OTFulfillmentStatus, readonly OTFulfillmentStatus[]>
> = {
  NOT_STARTED: [
    "INELIGIBLE",
    "INCOMPLETE_INPUT",
    "ARTIFACT_PENDING",
    "NEEDS_RECONCILIATION",
    "MANUAL_REVIEW",
    "CANCELLED",
  ],
  NEEDS_RECONCILIATION: [
    "ARTIFACT_PENDING",
    "INELIGIBLE",
    "MANUAL_REVIEW",
    "CANCELLED",
  ],
  INELIGIBLE: [],
  INCOMPLETE_INPUT: [
    "ARTIFACT_PENDING",
    "MANUAL_REVIEW",
    "INELIGIBLE",
    "CANCELLED",
  ],
  MANUAL_REVIEW: ["ARTIFACT_PENDING", "INELIGIBLE", "CANCELLED"],
  // ARTIFACT_PENDING as a target of ARTIFACT_READY / DELAYED models regeneration.
  ARTIFACT_PENDING: ["ARTIFACT_READY", "MANUAL_REVIEW", "FAILED", "CANCELLED"],
  ARTIFACT_READY: [
    "DELIVERY_PENDING",
    "ARTIFACT_PENDING",
    "MANUAL_REVIEW",
    "CANCELLED",
  ],
  DELIVERY_PENDING: [
    "PROVIDER_ACCEPTED",
    "DELIVERED",
    "DELAYED",
    "BOUNCED",
    "COMPLAINED",
    "FAILED",
  ],
  PROVIDER_ACCEPTED: [
    "DELIVERED",
    "DELAYED",
    "BOUNCED",
    "COMPLAINED",
    "FAILED",
  ],
  // DELIVERY_PENDING as a target of DELAYED models a safe delivery retry.
  DELAYED: [
    "PROVIDER_ACCEPTED",
    "DELIVERED",
    "DELIVERY_PENDING",
    "ARTIFACT_PENDING",
    "BOUNCED",
    "COMPLAINED",
    "FAILED",
  ],
  DELIVERED: ["COMPLAINED"],
  BOUNCED: [],
  COMPLAINED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(
  from: OTFulfillmentStatus,
  to: OTFulfillmentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * The status a provider event would move the fulfillment to, or null if the event
 * does not apply (already terminal-locked, not-yet-delivering, or a no-op). This
 * is the authority for "accepted ≠ delivered" and terminal-resurrection safety.
 */
export function nextStatusForEvent(
  status: OTFulfillmentStatus,
  eventType: OTDeliveryEventType,
): OTFulfillmentStatus | null {
  if (TERMINAL_LOCK_STATUSES.has(status)) return null;
  switch (status) {
    case "ARTIFACT_READY":
      return eventType === "REQUESTED" ? "DELIVERY_PENDING" : null;
    case "DELIVERY_PENDING":
      switch (eventType) {
        case "ACCEPTED":
          return "PROVIDER_ACCEPTED";
        case "DELIVERED":
          return "DELIVERED";
        case "DELAYED":
          return "DELAYED";
        case "BOUNCED":
          return "BOUNCED";
        case "COMPLAINED":
          return "COMPLAINED";
        case "FAILED":
          return "FAILED";
        default:
          return null;
      }
    case "PROVIDER_ACCEPTED":
      switch (eventType) {
        case "DELIVERED":
          return "DELIVERED";
        case "DELAYED":
          return "DELAYED";
        case "BOUNCED":
          return "BOUNCED";
        case "COMPLAINED":
          return "COMPLAINED";
        case "FAILED":
          return "FAILED";
        default:
          return null;
      }
    case "DELAYED":
      switch (eventType) {
        case "ACCEPTED":
          return "PROVIDER_ACCEPTED";
        case "DELIVERED":
          return "DELIVERED";
        case "BOUNCED":
          return "BOUNCED";
        case "COMPLAINED":
          return "COMPLAINED";
        case "FAILED":
          return "FAILED";
        default:
          return null;
      }
    case "DELIVERED":
      // A confirmed delivery may still be superseded by a later complaint, but
      // never regressed by a delayed/bounced signal.
      return eventType === "COMPLAINED" ? "COMPLAINED" : null;
    default:
      // NOT_STARTED, NEEDS_RECONCILIATION, INCOMPLETE_INPUT, MANUAL_REVIEW,
      // ARTIFACT_PENDING: no send has occurred, so provider events do not apply.
      return null;
  }
}

/**
 * A normalized provider event. `provider` is part of the dedup identity — the
 * schema dedupes on `(provider, providerEventId)`, and so does folding, so the
 * same event id from two providers never aliases.
 */
export type DeliveryEvent = {
  provider: string;
  providerEventId: string;
  eventType: OTDeliveryEventType;
  sequence: number;
  occurredAt: string;
};

/** Runtime allowlist of valid delivery-event types (forged types fail closed). */
export const DELIVERY_EVENT_TYPES: ReadonlySet<OTDeliveryEventType> = new Set([
  "REQUESTED",
  "ACCEPTED",
  "DELIVERED",
  "DELAYED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
]);

// Text-safe, total, collision-free field encoder: `<codeUnitLen>~<hex>`, where
// <hex> is the value's UTF-16 code units as fixed-width 4-digit lowercase hex.
// Because the output alphabet is only [0-9a-f~] plus decimal digits, the exported
// key/signature can NEVER contain a raw NUL, C0/C1 control, Unicode separator, or
// (lone) surrogate — `charCodeAt` reads code units, so it never throws on unpaired
// surrogates. The code-unit length prefix keeps concatenated fields unambiguous,
// and fixed-width hex makes the whole encoding an injection from strings to text.
function lengthPrefixed(value: string): string {
  let hex = "";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return `${value.length}~${hex}`;
}

/**
 * Composite dedup IDENTITY, matching schema `@@unique([provider, providerEventId])`.
 * Length-prefixed and text-safe (no NUL) so distinct pairs can never collide.
 */
export function deliveryEventKey(
  event: Pick<DeliveryEvent, "provider" | "providerEventId">,
): string {
  return `k1.${lengthPrefixed(event.provider)}${lengthPrefixed(event.providerEventId)}`;
}

/**
 * Full-content SIGNATURE over every normalized semantic field. Two events with the
 * same identity but any differing field yield different signatures, which lets the
 * fold distinguish an exact replay (idempotent) from a conflicting reuse.
 */
export function deliveryEventSignature(event: DeliveryEvent): string {
  return [
    "s1",
    lengthPrefixed(event.provider),
    lengthPrefixed(event.providerEventId),
    lengthPrefixed(event.eventType),
    lengthPrefixed(String(event.sequence)),
    lengthPrefixed(event.occurredAt),
  ].join("");
}

/**
 * Validate a normalized event fail-closed. Returns a bounded reason code, or null
 * if valid. Runtime-checks the event-type allowlist, provider identity, a
 * schema-safe local sequence, and a strict canonical UTC instant — all BEFORE any
 * pointer can advance.
 */
export function validateDeliveryEvent(event: DeliveryEvent): string | null {
  if (!DELIVERY_EVENT_TYPES.has(event.eventType)) return "INVALID_EVENT_TYPE";
  if (!isValidProviderName(event.provider)) return "INVALID_PROVIDER";
  if (!isValidProviderEventId(event.providerEventId))
    return "INVALID_PROVIDER_EVENT_ID";
  if (!isPgIntInRange(event.sequence, 1, PG_INT_MAX)) return "INVALID_SEQUENCE";
  if (!isValidInstant(event.occurredAt)) return "INVALID_TIMESTAMP";
  return null;
}

type SeenEvent = { key: string; signature: string };

export type FoldState = {
  status: OTFulfillmentStatus;
  statusRevision: number;
  lastSequence: number | null;
  lastOccurredAt: string | null;
  seen: readonly SeenEvent[];
  seenSequences: readonly number[];
  conflicted: boolean;
  reason: string | null;
};

export type FoldStepResult = {
  state: FoldState;
  applied: boolean;
  reason: string | null;
};

export function initialFoldState(status: OTFulfillmentStatus): FoldState {
  return {
    status,
    statusRevision: 0,
    lastSequence: null,
    lastOccurredAt: null,
    seen: [],
    seenSequences: [],
    conflicted: false,
    reason: null,
  };
}

function frozen(
  state: FoldState,
  seen: readonly SeenEvent[],
  reason: string,
): FoldStepResult {
  return {
    state: { ...state, conflicted: true, reason, seen },
    applied: false,
    reason,
  };
}

/**
 * Single-step fold contract (arrival-ordered). Fail-closed:
 *   - an invalid event never advances any pointer or seen evidence;
 *   - the same identity with an IDENTICAL signature is an exact replay (idempotent);
 *   - the same identity with ANY differing semantic field is EVENT_IDENTITY_CONFLICT
 *     and freezes the state deterministically (never accepting either outcome);
 *   - a distinct event re-using an already-consumed local sequence is a
 *     SEQUENCE_CONFLICT and freezes the state;
 *   - a stale/out-of-order event never regresses.
 * The state retains a per-identity content signature so replay and conflict are
 * distinguishable. For an order-independent verdict, use `foldDeliveryEvents`.
 */
export function foldDeliveryEvent(
  state: FoldState,
  event: DeliveryEvent,
): FoldStepResult {
  if (state.conflicted) return { state, applied: false, reason: "CONFLICTED" };

  const invalid = validateDeliveryEvent(event);
  if (invalid) return { state, applied: false, reason: invalid };

  const key = deliveryEventKey(event);
  const signature = deliveryEventSignature(event);
  const existing = state.seen.find((s) => s.key === key);
  if (existing) {
    if (existing.signature === signature)
      return { state, applied: false, reason: "EXACT_REPLAY" };
    return frozen(
      state,
      [...state.seen, { key, signature }],
      "EVENT_IDENTITY_CONFLICT",
    );
  }

  if (state.seenSequences.includes(event.sequence)) {
    // A distinct identity claiming an already-consumed local sequence: fail closed.
    return frozen(
      state,
      [...state.seen, { key, signature }],
      "SEQUENCE_CONFLICT",
    );
  }

  const seen = [...state.seen, { key, signature }];
  if (state.lastSequence !== null && event.sequence <= state.lastSequence) {
    // Stale / out-of-order: record that we saw it AND reserve its local sequence
    // (so a later distinct event reusing this stale sequence is a SEQUENCE_CONFLICT,
    // matching the schema's @@unique([fulfillmentId, sequence]) and the canonical
    // fold) — but never regress status / revision / lastSequence / lastOccurredAt.
    return {
      state: {
        ...state,
        seen,
        seenSequences: [...state.seenSequences, event.sequence],
      },
      applied: false,
      reason: "OUT_OF_ORDER",
    };
  }

  const next = nextStatusForEvent(state.status, event.eventType);
  const base: FoldState = {
    ...state,
    lastSequence: event.sequence,
    lastOccurredAt: event.occurredAt,
    seen,
    seenSequences: [...state.seenSequences, event.sequence],
  };
  if (next === null) {
    return { state: base, applied: false, reason: "NOT_APPLICABLE" };
  }
  return {
    state: { ...base, status: next, statusRevision: state.statusRevision + 1 },
    applied: true,
    reason: null,
  };
}

/**
 * Canonical full-set fold. Order-INDEPENDENT and fail-closed:
 *   - if ANY event is malformed, the whole fold returns a deterministic invalid
 *     result (initial status, conflicted, reason INVALID_EVENT) — malformed
 *     evidence is never silently dropped to reach an accepted/delivered status;
 *   - the same identity with a differing signature → EVENT_IDENTITY_CONFLICT;
 *   - two distinct identities claiming the same local sequence → SEQUENCE_CONFLICT;
 *   - exact-replay duplicates collapse.
 * Reversing the input can never change the final status, revision, pointers,
 * conflict flag, or reason.
 */
export function foldDeliveryEvents(
  initial: FoldState,
  events: readonly DeliveryEvent[],
): FoldState {
  for (const e of events) {
    if (validateDeliveryEvent(e) !== null)
      return { ...initial, conflicted: true, reason: "INVALID_EVENT" };
  }

  const ordered = [...events].sort((a, b) =>
    a.sequence === b.sequence
      ? deliveryEventSignature(a).localeCompare(deliveryEventSignature(b))
      : a.sequence - b.sequence,
  );

  const byKey = new Map<string, string>();
  const deduped: DeliveryEvent[] = [];
  for (const e of ordered) {
    const key = deliveryEventKey(e);
    const signature = deliveryEventSignature(e);
    const seenSig = byKey.get(key);
    if (seenSig !== undefined) {
      if (seenSig !== signature)
        return {
          ...initial,
          conflicted: true,
          reason: "EVENT_IDENTITY_CONFLICT",
        };
      continue; // exact replay
    }
    byKey.set(key, signature);
    deduped.push(e);
  }

  const bySequence = new Set<number>();
  for (const e of deduped) {
    if (bySequence.has(e.sequence))
      return { ...initial, conflicted: true, reason: "SEQUENCE_CONFLICT" };
    bySequence.add(e.sequence);
  }

  let state = initial;
  for (const event of deduped) {
    state = foldDeliveryEvent(state, event).state;
  }
  return state;
}

export type NextAttemptResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/**
 * The next delivery attempt number, as a discriminated result. Fails closed
 * (never normalizes malformed input to 1): the current count must be a schema-safe
 * integer in `0..PG_INT_MAX - 1` so the next value stays within the PostgreSQL Int
 * range. `decideDeliverySend` uses this as the single numbering authority.
 */
export function nextDeliveryAttemptNumber(
  currentAttemptCount: number,
): NextAttemptResult {
  if (!isPgIntInRange(currentAttemptCount, 0, PG_INT_MAX - 1))
    return { ok: false, reason: "INVALID_ATTEMPT_COUNT" };
  return { ok: true, value: currentAttemptCount + 1 };
}
