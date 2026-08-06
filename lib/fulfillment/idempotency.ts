/**
 * OT T2 delivery-evidence foundation — idempotency-key construction.
 *
 * The key is derived from a complete, non-PII logical contract. Every dimension
 * that changes the meaning of a send/regeneration (order, kind, tier, attempt,
 * artifact hash, generator/template version, purpose) is part of the key, so two
 * materially different operations can never alias the same key. No email, name,
 * address, or other PII is ever part of the key. Invalid components fail closed.
 */
import type { OTFulfillmentKind } from "@/lib/fulfillment/types"
import { isValidArtifactSha256 } from "@/lib/fulfillment/validation"

export type FulfillmentIdempotencyPurpose = "DELIVERY" | "REGENERATION"

export type FulfillmentIdempotencyContract = {
  orderId: string
  kind: OTFulfillmentKind
  tier: string
  attemptNumber: number
  artifactSha256: string
  generatorVersion: string
  templateVersion?: string
  purpose: FulfillmentIdempotencyPurpose
}

export type IdempotencyKeyResult = { ok: true; key: string } | { ok: false; reason: string }

// Deliberately excludes the ":" join delimiter and "=" label separator so that
// no free-text segment (orderId, tier, generator/template version) can forge a
// field boundary and alias a different logical contract to the same key.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

function segmentOk(value: string): boolean {
  return value.length > 0 && value.length <= 128 && SAFE_SEGMENT.test(value)
}

/**
 * Build a deterministic idempotency key, or fail closed with a reason. The key is
 * a single-line, delimiter-joined string of only ids / hashes / versions /
 * numbers — never PII.
 */
export function buildFulfillmentIdempotencyKey(contract: FulfillmentIdempotencyContract): IdempotencyKeyResult {
  const orderId = String(contract.orderId ?? "")
  const tier = String(contract.tier ?? "")
  const generatorVersion = String(contract.generatorVersion ?? "")
  const templateVersion = contract.templateVersion === undefined ? "none" : String(contract.templateVersion)

  if (!segmentOk(orderId)) return { ok: false, reason: "INVALID_ORDER_ID" }
  if (contract.kind !== "T2_APPEAL_EVIDENCE") return { ok: false, reason: "INVALID_KIND" }
  if (!segmentOk(tier)) return { ok: false, reason: "INVALID_TIER" }
  if (contract.purpose !== "DELIVERY" && contract.purpose !== "REGENERATION") {
    return { ok: false, reason: "INVALID_PURPOSE" }
  }
  if (!Number.isInteger(contract.attemptNumber) || contract.attemptNumber < 1) {
    return { ok: false, reason: "INVALID_ATTEMPT_NUMBER" }
  }
  if (!isValidArtifactSha256(contract.artifactSha256)) return { ok: false, reason: "INVALID_ARTIFACT_SHA256" }
  if (!segmentOk(generatorVersion)) return { ok: false, reason: "INVALID_GENERATOR_VERSION" }
  if (!segmentOk(templateVersion)) return { ok: false, reason: "INVALID_TEMPLATE_VERSION" }

  const key = [
    "otf",
    "v1",
    contract.purpose,
    contract.kind,
    orderId,
    `tier=${tier}`,
    `attempt=${contract.attemptNumber}`,
    `sha=${contract.artifactSha256}`,
    `gen=${generatorVersion}`,
    `tpl=${templateVersion}`,
  ].join(":")

  return { ok: true, key }
}
