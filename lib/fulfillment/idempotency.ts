/**
 * OT T2 delivery-evidence foundation — idempotency-key construction.
 *
 * The key is derived from a complete, non-PII logical contract. Every dimension
 * that changes the meaning of a send/regeneration (order, kind, tier, attempt,
 * artifact hash, generator/template version, purpose) is part of the key, so two
 * materially different operations can never alias the same key. No email, name,
 * address, or other PII is ever part of the key. Invalid components fail closed.
 */
import type { OTFulfillmentKind } from "@/lib/fulfillment/types";
import {
  isPgIntInRange,
  isValidArtifactSha256,
  PG_INT_MAX,
} from "@/lib/fulfillment/validation";

export type FulfillmentIdempotencyPurpose = "DELIVERY" | "REGENERATION";

export type FulfillmentIdempotencyContract = {
  orderId: string;
  kind: OTFulfillmentKind;
  tier: string;
  attemptNumber: number;
  artifactSha256: string;
  generatorVersion: string;
  templateVersion?: string;
  purpose: FulfillmentIdempotencyPurpose;
};

export type IdempotencyKeyResult =
  | { ok: true; key: string }
  | { ok: false; reason: string };

// Deliberately excludes the ":" join delimiter, "=" label separator, and "~"
// length separator so that no free-text segment can forge a field boundary and
// alias a different logical contract to the same key.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function segmentOk(value: string): boolean {
  return value.length > 0 && value.length <= 128 && SAFE_SEGMENT.test(value);
}

// Length-prefixed, tagged encoding of a present value. Because the length prefix
// and the delimiter-free charset are both enforced, no two distinct values can
// produce the same encoding, and a present value can never look like the absence
// sentinel.
function present(value: string): string {
  return `present.${value.length}~${value}`;
}

const ABSENT = "absent";

/**
 * Build a deterministic idempotency key, or fail closed with a reason. The key is
 * a single-line, canonically-encoded string of only ids / hashes / versions /
 * numbers — never PII. Optional fields use a tagged present/absent encoding so an
 * omitted value and any explicit literal (e.g. "none") never collide.
 */
export function buildFulfillmentIdempotencyKey(
  contract: FulfillmentIdempotencyContract,
): IdempotencyKeyResult {
  // Reject wrong runtime types outright — no permissive String(...) coercion, so a
  // number/boolean/null/object/array/symbol can never be smuggled into the key.
  if (typeof contract.orderId !== "string" || !segmentOk(contract.orderId)) {
    return { ok: false, reason: "INVALID_ORDER_ID" };
  }
  if (contract.kind !== "T2_APPEAL_EVIDENCE")
    return { ok: false, reason: "INVALID_KIND" };
  // T2-only kind: reject any tier other than exact "T2" rather than encoding an
  // impossible T2-kind/non-T2-tier key.
  if (contract.tier !== "T2") return { ok: false, reason: "INVALID_TIER" };
  if (contract.purpose !== "DELIVERY" && contract.purpose !== "REGENERATION") {
    return { ok: false, reason: "INVALID_PURPOSE" };
  }
  // Attempt number must be a schema-safe PostgreSQL Int in 1..PG_INT_MAX.
  if (!isPgIntInRange(contract.attemptNumber, 1, PG_INT_MAX)) {
    return { ok: false, reason: "INVALID_ATTEMPT_NUMBER" };
  }
  if (!isValidArtifactSha256(contract.artifactSha256))
    return { ok: false, reason: "INVALID_ARTIFACT_SHA256" };
  if (
    typeof contract.generatorVersion !== "string" ||
    !segmentOk(contract.generatorVersion)
  ) {
    return { ok: false, reason: "INVALID_GENERATOR_VERSION" };
  }
  // Absent (undefined) is the ONLY absent form and is distinct from any present
  // value; a present value must already be a string satisfying the grammar — an
  // empty/invalid/non-string value (including null) is rejected.
  let templateSegment = ABSENT;
  if (contract.templateVersion !== undefined) {
    if (
      typeof contract.templateVersion !== "string" ||
      !segmentOk(contract.templateVersion)
    ) {
      return { ok: false, reason: "INVALID_TEMPLATE_VERSION" };
    }
    templateSegment = present(contract.templateVersion);
  }

  const orderId = contract.orderId;
  const generatorVersion = contract.generatorVersion;

  const key = [
    "otf",
    "v1",
    `purpose=${contract.purpose}`,
    `kind=${contract.kind}`,
    `order=${present(orderId)}`,
    "tier=T2",
    `attempt=${contract.attemptNumber}`,
    `sha=${contract.artifactSha256}`,
    `gen=${present(generatorVersion)}`,
    `tpl=${templateSegment}`,
  ].join(":");

  return { ok: true, key };
}
