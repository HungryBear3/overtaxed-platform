/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — exact artifact identity and
 * provenance binding (PURE decision layer).
 *
 * This module decides whether a finalized private packet may be bound to an
 * existing eligible T2 fulfillment summary. It is pure: no database, no
 * provider, no filesystem, no clock. It performs no writes and sends nothing.
 *
 * Contract:
 *   - artifact identity is derived from the EXACT bytes, server-side, here;
 *     a caller-supplied digest is only ever compared, never substituted;
 *   - every refusal is a bounded, stable, non-PII blocker code;
 *   - ambiguity fails closed — there is no permissive default branch;
 *   - the result never echoes bytes, PIN, address, email, or provider text.
 *
 * Settlement remains authoritative and untouched: nothing here reads or returns
 * a Stripe field, and binding never implies delivery.
 */
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  normalizeAddressForFingerprint,
} from "@/lib/fulfillment/artifact-digest";
import {
  isBoundedOpaqueString,
  isValidArtifactSha256,
  isValidInstant,
  isValidPrivateStorageLocator,
  parseStrictInstant,
} from "@/lib/fulfillment/validation";
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types";
import type {
  OTFulfillmentKind,
  OTFulfillmentStatus,
  PropertyBindingState,
} from "@/lib/fulfillment/types";

export { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types";

/**
 * Fulfillment statuses from which a first artifact binding may be made.
 * Deliberately narrow: a terminal, held, delivered, or ineligible fulfillment
 * never accepts new artifact identity in this slice.
 */
export const BINDABLE_FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  "ARTIFACT_PENDING",
]);

/**
 * Fulfillment statuses from which an EXACT no-op replay of an already-bound
 * artifact may return success.
 *
 * Deliberately not "any status where a row exists". A first successful bind
 * leaves the summary in exactly ARTIFACT_READY, so that is the only state in
 * which a replay is consistent with the evidence. Every other state means
 * something moved on — a terminal outcome, a hold, a cancellation, or an
 * existing row sitting under an ARTIFACT_PENDING summary that should be
 * impossible — and each of those is a reconciliation question, not a retry.
 * Widening this set requires a justification in code and a test.
 */
export const REPLAYABLE_FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  "ARTIFACT_READY",
]);

/**
 * Slice 2 binds the first artifact only. Regeneration past v1 is deferred, so
 * the version is a constant and callers can pre-read the row it would occupy.
 */
export const SLICE2_ARTIFACT_VERSION = 1;

/** Bounded, stable, non-PII refusal vocabulary for artifact binding. */
export type ArtifactBindingBlocker =
  | "FLAG_DISABLED"
  | "ORDER_NOT_FOUND"
  | "FULFILLMENT_NOT_FOUND"
  | "FULFILLMENT_ORDER_MISMATCH"
  | "INELIGIBLE_TIER"
  | "INELIGIBLE_SETTLEMENT"
  | "INCOMPLETE_PROPERTY_BINDING"
  | "PROVENANCE_ORDER_MISMATCH"
  | "PROVENANCE_PROPERTY_MISMATCH"
  | "INELIGIBLE_FULFILLMENT_STATUS"
  | "EMPTY_ARTIFACT"
  | "ARTIFACT_TOO_LARGE"
  | "INVALID_STORAGE_LOCATOR"
  | "INVALID_GENERATOR_VERSION"
  | "INVALID_TEMPLATE_VERSION"
  | "INVALID_GENERATED_AT"
  | "GENERATED_AT_IN_FUTURE"
  | "UNTRUSTED_CLOCK"
  | "SHA256_ASSERTION_MISMATCH"
  | "ARTIFACT_BINDING_CONFLICT";

export const ARTIFACT_BINDING_BLOCKERS: ReadonlySet<string> = new Set<string>([
  "FLAG_DISABLED",
  "ORDER_NOT_FOUND",
  "FULFILLMENT_NOT_FOUND",
  "FULFILLMENT_ORDER_MISMATCH",
  "INELIGIBLE_TIER",
  "INELIGIBLE_SETTLEMENT",
  "INCOMPLETE_PROPERTY_BINDING",
  "PROVENANCE_ORDER_MISMATCH",
  "PROVENANCE_PROPERTY_MISMATCH",
  "INELIGIBLE_FULFILLMENT_STATUS",
  "EMPTY_ARTIFACT",
  "ARTIFACT_TOO_LARGE",
  "INVALID_STORAGE_LOCATOR",
  "INVALID_GENERATOR_VERSION",
  "INVALID_TEMPLATE_VERSION",
  "INVALID_GENERATED_AT",
  "GENERATED_AT_IN_FUTURE",
  "UNTRUSTED_CLOCK",
  "SHA256_ASSERTION_MISMATCH",
  "ARTIFACT_BINDING_CONFLICT",
]);

export type ArtifactBindingOrder = {
  id: string;
  tier: string;
  status: string;
  propertyPin: string | null;
  propertyAddress: string | null;
  refunded?: boolean;
  disputed?: boolean;
};

export type ArtifactBindingFulfillment = {
  id: string;
  orderId: string;
  kind: OTFulfillmentKind | string;
  status: OTFulfillmentStatus | string;
  statusRevision: number;
};

/** What the packet generator claims this artifact was produced from. */
export type ArtifactProvenanceInput = {
  sourceOrderId: string;
  propertyPin: string;
  propertyAddress: string;
  generatorVersion: string;
  templateVersion?: string | null;
  /** Strict RFC3339 UTC instant at which the bytes were generated. */
  generatedAt: string;
};

export type ArtifactBindingInput = {
  flagEnabled: boolean;
  /**
   * Authoritative current time, supplied by the store from PostgreSQL
   * transaction time (`CURRENT_TIMESTAMP`) inside the binding transaction.
   *
   * This is deliberately NOT on `BindArtifactCommand`: like activation, the
   * clock that decides whether a generation time is physically possible is not
   * something request-shaped data gets to assert. Sourcing it inside the same
   * transaction as the read-and-write means the check and the insert cannot
   * straddle a clock change.
   */
  trustedNow: string;
  bytes: Buffer;
  order: ArtifactBindingOrder | null;
  fulfillment: ArtifactBindingFulfillment | null;
  provenance: ArtifactProvenanceInput;
  storageLocator: string;
  /** Optional caller assertion — compared, never trusted as the identity. */
  assertedSha256?: string;
  /**
   * True when an artifact row already occupies this fulfillment/version.
   *
   * This selects WHICH lifecycle allowlist applies, and nothing more. A first
   * binding must come from BINDABLE_FULFILLMENT_STATUSES; a replay must come
   * from REPLAYABLE_FULFILLMENT_STATUSES. It never disables the gate: every
   * order, tier, settlement, property, provenance, bytes, locator and version
   * check still runs in full and still fails closed.
   */
  existingBinding?: boolean;
  /**
   * Test-only size override so the bounded-size gate can be proven without
   * allocating a 50MB buffer. Ignored unless larger than the real byte length.
   */
  byteSizeOverrideForTest?: number;
};

/** The exact durable identity to persist. Payload-free. */
export type BoundArtifactIdentity = {
  fulfillmentId: string;
  sourceOrderId: string;
  version: number;
  artifactSha256: string;
  byteSize: number;
  storageLocator: string;
  generatorVersion: string;
  templateVersion: string | null;
  generatedAt: string;
  propertyBindingFingerprint: string;
};

/**
 * CREATE authorizes exactly one insert plus the ARTIFACT_PENDING → ARTIFACT_READY
 * transition. REPLAY authorizes NO write at all — it only permits comparing the
 * decided identity against the row that already exists. The store asserts on this
 * so a replay decision can never be executed as an insert.
 */
export type ArtifactBindingMode = "CREATE" | "REPLAY";

export type ArtifactBindingDecision =
  | {
      ok: true;
      mode: ArtifactBindingMode;
      artifact: BoundArtifactIdentity;
      fromStatus: OTFulfillmentStatus | string;
      nextStatus: OTFulfillmentStatus;
      expectedStatusRevision: number;
    }
  | { ok: false; blocker: ArtifactBindingBlocker };

const T2_PIN = /^\d{14}$/;

function refuse(blocker: ArtifactBindingBlocker): ArtifactBindingDecision {
  return { ok: false, blocker };
}

function presentString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decide whether these exact bytes may be bound to this fulfillment.
 *
 * Order of gates matters: cheap structural checks that reveal nothing run
 * before anything derived from the bytes, and the flag is checked first so a
 * disabled deployment does no work at all.
 */
export function decideArtifactBinding(
  input: ArtifactBindingInput,
): ArtifactBindingDecision {
  // 1. Feature gate. Absent/default-off means this path does nothing.
  if (input.flagEnabled !== true) return refuse("FLAG_DISABLED");

  // 2. Both sides of the binding must exist and refer to each other.
  const order = input.order;
  if (!order) return refuse("ORDER_NOT_FOUND");
  const fulfillment = input.fulfillment;
  if (!fulfillment) return refuse("FULFILLMENT_NOT_FOUND");
  if (fulfillment.orderId !== order.id)
    return refuse("FULFILLMENT_ORDER_MISMATCH");

  // 3. Tier: this slice is T2-only.
  if (String(order.tier ?? "").trim() !== "T2") return refuse("INELIGIBLE_TIER");

  // 4. Settlement must be durably paid under the existing authoritative
  //    semantics. A refund/dispute overrides a PAID status. Anything unknown
  //    is ineligible — there is no permissive default.
  if (order.refunded === true || order.disputed === true)
    return refuse("INELIGIBLE_SETTLEMENT");
  if (String(order.status ?? "").trim() !== "PAID")
    return refuse("INELIGIBLE_SETTLEMENT");

  // 5. Property binding must be complete on the ORDER, using the same contract
  //    the Phase 1 kickoff seam already enforces.
  const orderPin = (order.propertyPin ?? "").trim();
  if (!T2_PIN.test(orderPin)) return refuse("INCOMPLETE_PROPERTY_BINDING");
  if (!presentString(order.propertyAddress))
    return refuse("INCOMPLETE_PROPERTY_BINDING");

  // 6. Packet provenance must name that same order and that same property.
  const provenance = input.provenance;
  if (provenance?.sourceOrderId !== order.id)
    return refuse("PROVENANCE_ORDER_MISMATCH");
  if ((provenance.propertyPin ?? "").trim() !== orderPin)
    return refuse("PROVENANCE_PROPERTY_MISMATCH");
  if (
    normalizeAddressForFingerprint(provenance.propertyAddress ?? "") !==
    normalizeAddressForFingerprint(order.propertyAddress)
  ) {
    return refuse("PROVENANCE_PROPERTY_MISMATCH");
  }

  // 7. Lifecycle allowlist. Both branches are closed sets, so a terminal, held,
  //    cancelled, or unrecognized status can never produce an `ok` decision —
  //    including for an exact replay, which must not resurrect ARTIFACT_READY
  //    from a state that has already moved past it.
  const isReplay = input.existingBinding === true;
  const allowedStatuses = isReplay
    ? REPLAYABLE_FULFILLMENT_STATUSES
    : BINDABLE_FULFILLMENT_STATUSES;
  if (!allowedStatuses.has(String(fulfillment.status)))
    return refuse("INELIGIBLE_FULFILLMENT_STATUS");

  // 8. Bytes must be non-empty and within the explicit bounded size.
  const bytes = input.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0)
    return refuse("EMPTY_ARTIFACT");
  const byteSize = Math.max(
    bytes.byteLength,
    input.byteSizeOverrideForTest ?? 0,
  );
  if (byteSize > MAX_ARTIFACT_BYTES) return refuse("ARTIFACT_TOO_LARGE");

  // 9. The locator must be a private internal path, never a public bearer URL.
  //    Reuses the branded Phase 1 validator so there is one source of truth.
  if (!isValidPrivateStorageLocator(input.storageLocator))
    return refuse("INVALID_STORAGE_LOCATOR");

  // 10. Generator/template/timestamp provenance fields.
  if (
    !presentString(provenance.generatorVersion) ||
    !isBoundedOpaqueString(provenance.generatorVersion, 64)
  ) {
    return refuse("INVALID_GENERATOR_VERSION");
  }
  const templateVersion =
    provenance.templateVersion === undefined ||
    provenance.templateVersion === null
      ? null
      : provenance.templateVersion;
  if (
    templateVersion !== null &&
    !isBoundedOpaqueString(templateVersion, 64)
  ) {
    return refuse("INVALID_TEMPLATE_VERSION");
  }
  if (!isValidInstant(provenance.generatedAt))
    return refuse("INVALID_GENERATED_AT");

  // Bytes cannot have been generated in the future. `deriveProvenanceState` in
  // the admin read model classifies `generatedAt > now` as MISMATCHED, so
  // admitting one here would manufacture a success-like row that the read
  // boundary immediately rejects as impossible. The two boundaries must agree.
  //
  // The comparison is against store-owned transaction time; a clock we cannot
  // parse is a clock we cannot trust, and we refuse rather than silently fall
  // back to an ambient wall clock a caller could influence.
  const trustedNowMs = parseStrictInstant(input.trustedNow);
  if (trustedNowMs === null) return refuse("UNTRUSTED_CLOCK");
  const generatedAtMs = parseStrictInstant(provenance.generatedAt);
  if (generatedAtMs === null) return refuse("INVALID_GENERATED_AT");
  // Inclusive: generation exactly at transaction time is legitimate.
  if (generatedAtMs > trustedNowMs) return refuse("GENERATED_AT_IN_FUTURE");

  // 11. Identity is computed HERE from the exact bytes. Any caller assertion is
  //     compared against it and can only ever refuse the binding.
  const artifactSha256 = computeArtifactSha256(bytes);
  if (!isValidArtifactSha256(artifactSha256))
    return refuse("SHA256_ASSERTION_MISMATCH");
  if (
    input.assertedSha256 !== undefined &&
    input.assertedSha256 !== artifactSha256
  ) {
    return refuse("SHA256_ASSERTION_MISMATCH");
  }

  const propertyBindingFingerprint = computePropertyBindingFingerprint({
    orderId: order.id,
    propertyPin: orderPin,
    propertyAddress: order.propertyAddress,
  });

  return {
    ok: true,
    mode: isReplay ? "REPLAY" : "CREATE",
    artifact: {
      fulfillmentId: fulfillment.id,
      sourceOrderId: order.id,
      version: SLICE2_ARTIFACT_VERSION,
      artifactSha256,
      byteSize: bytes.byteLength,
      storageLocator: input.storageLocator,
      generatorVersion: provenance.generatorVersion,
      templateVersion,
      generatedAt: provenance.generatedAt,
      propertyBindingFingerprint,
    },
    fromStatus: fulfillment.status,
    nextStatus: "ARTIFACT_READY",
    expectedStatusRevision: fulfillment.statusRevision,
  };
}

/**
 * Authenticate a stored property-binding fingerprint against the order as it
 * stands NOW, and collapse the answer to a non-sensitive state.
 *
 * This is the only supported way for a read surface to learn anything about the
 * property binding. It takes the PIN and address because the comparison can only
 * be made from them, and it returns an enum precisely so that neither those
 * inputs, nor the stored fingerprint, nor the expected fingerprint can travel any
 * further. Every failure mode is distinct and fails closed: a value we cannot
 * parse is MALFORMED, an order we cannot fingerprint is UNVERIFIABLE, and a
 * well-formed value describing a different property is DRIFTED. Only an exact
 * match is MATCHES.
 */
export function classifyPropertyBinding(input: {
  storedFingerprint: string | null | undefined;
  orderId: string;
  propertyPin: string | null | undefined;
  propertyAddress: string | null | undefined;
}): PropertyBindingState {
  const stored = input.storedFingerprint;
  // Legacy rows bound before Slice 2 carry nothing. That is expected, not a fault.
  if (stored === null || stored === undefined || stored === "") return "ABSENT";
  if (typeof stored !== "string" || !isValidArtifactSha256(stored))
    return "MALFORMED";

  const pin = (input.propertyPin ?? "").trim();
  const address = input.propertyAddress ?? "";
  // Without complete authoritative property inputs there is nothing to compare
  // against, so we must not claim agreement.
  if (!T2_PIN.test(pin) || !presentString(address)) return "UNVERIFIABLE";

  const expected = computePropertyBindingFingerprint({
    orderId: input.orderId,
    propertyPin: pin,
    propertyAddress: address,
  });
  return stored === expected ? "MATCHES" : "DRIFTED";
}

/**
 * Compare an already-persisted artifact row against a freshly decided identity.
 * Exact match in every durable dimension is an idempotent no-op; any difference
 * is a stable conflict. Used by the store to distinguish a safe retry from an
 * attempt to mutate immutable evidence.
 */
export function isIdenticalBinding(
  existing: {
    artifactSha256: string;
    byteSize: number;
    storageLocator: string;
    generatorVersion: string;
    templateVersion: string | null;
    sourceOrderId: string | null;
    propertyBindingFingerprint: string | null;
    generatedAt: Date | string | null;
  },
  next: BoundArtifactIdentity,
): boolean {
  const existingGeneratedAt =
    existing.generatedAt instanceof Date
      ? existing.generatedAt.toISOString()
      : (existing.generatedAt ?? null);
  const nextGeneratedAt = new Date(next.generatedAt).toISOString();
  return (
    existing.artifactSha256 === next.artifactSha256 &&
    existing.byteSize === next.byteSize &&
    existing.storageLocator === next.storageLocator &&
    existing.generatorVersion === next.generatorVersion &&
    existing.templateVersion === next.templateVersion &&
    existing.sourceOrderId === next.sourceOrderId &&
    existing.propertyBindingFingerprint === next.propertyBindingFingerprint &&
    existingGeneratedAt === nextGeneratedAt
  );
}
