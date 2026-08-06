/**
 * OT T2 delivery-evidence foundation — fail-closed validators for the durable
 * evidence fields. Pure and database-free. Anything malformed is rejected; none
 * of these accept or echo PII or provider payloads.
 */
import { MAX_ARTIFACT_BYTES, REASON_CODES } from "@/lib/fulfillment/types"

export { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"

const SHA256_LOWER = /^[0-9a-f]{64}$/

/** Lowercase 64-hex digest of the exact artifact bytes. Uppercase is rejected. */
export function isValidArtifactSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_LOWER.test(value)
}

/** A positive integer byte count within the defensive upper bound. */
export function isValidByteSize(value: unknown, max: number = MAX_ARTIFACT_BYTES): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max
}

function isBoundedOpaqueId(value: unknown): boolean {
  if (typeof value !== "string") return false
  if (value.trim().length < 1 || value.length > 255) return false
  // Opaque single-line token only: reject whitespace, C0 control chars and DEL.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return false
  }
  return true
}

/** Opaque provider message id (e.g. Resend id). Bounded, single-line, non-empty. */
export function isValidProviderMessageId(value: unknown): boolean {
  return isBoundedOpaqueId(value)
}

/** Immutable provider event id used for dedup. Bounded, single-line, non-empty. */
export function isValidProviderEventId(value: unknown): boolean {
  return isBoundedOpaqueId(value)
}

/** Reason code must be a member of the bounded non-PII allowlist. */
export function isValidReasonCode(value: unknown): boolean {
  return typeof value === "string" && REASON_CODES.has(value)
}

export type TimestampChain = {
  createdAt: string
  requestedAt?: string
  providerAcceptedAt?: string
  deliveredAt?: string
  failedAt?: string
}

/**
 * Validate the monotonic ordering of a fulfillment's lifecycle timestamps.
 * Returns null when valid, or a bounded reason string when not. A delivered/
 * accepted timestamp that precedes an earlier lifecycle stage fails closed.
 */
export function validateTimestampChain(chain: TimestampChain): string | null {
  const order: Array<[keyof TimestampChain, string | undefined]> = [
    ["createdAt", chain.createdAt],
    ["requestedAt", chain.requestedAt],
    ["providerAcceptedAt", chain.providerAcceptedAt],
    ["deliveredAt", chain.deliveredAt],
  ]
  let prevMs: number | null = null
  let prevName = ""
  for (const [name, raw] of order) {
    if (raw === undefined) continue
    const ms = Date.parse(raw)
    if (Number.isNaN(ms)) return `INVALID_TIMESTAMP:${String(name)}`
    if (prevMs !== null && ms < prevMs) return `OUT_OF_ORDER:${prevName}->${String(name)}`
    prevMs = ms
    prevName = String(name)
  }
  if (chain.failedAt !== undefined) {
    const ms = Date.parse(chain.failedAt)
    if (Number.isNaN(ms)) return "INVALID_TIMESTAMP:failedAt"
    const createdMs = Date.parse(chain.createdAt)
    if (!Number.isNaN(createdMs) && ms < createdMs) return "OUT_OF_ORDER:createdAt->failedAt"
  }
  return null
}
