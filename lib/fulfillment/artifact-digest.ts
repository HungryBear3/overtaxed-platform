/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — server-side artifact digests.
 *
 * Content addressing is derived HERE, from the exact bytes, and never from
 * caller-supplied text. Nothing in this module logs, stores, echoes, or returns
 * the bytes themselves: the only outputs are fixed-width lowercase hex digests.
 *
 * Pure and database-free. `node:crypto` is a Node builtin, not a framework or
 * provider dependency, so this stays in the pure decision layer alongside the
 * other `lib/fulfillment/*` helpers.
 */
import { createHash } from "node:crypto";

/**
 * Lowercase 64-hex SHA-256 over the EXACT artifact bytes.
 *
 * This is the single authority for artifact identity. A caller may assert what
 * it believes the digest to be, but the asserted value is only ever compared —
 * never substituted (see `decideArtifactBinding`).
 */
export function computeArtifactSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical private key for immutable T2 artifact bytes. */
export function contentAddressedT2ArtifactLocator(sha256: string): string {
  return `t2-artifacts/sha256/${sha256}.pdf`;
}

/**
 * Stable, bounded fingerprint of the property binding that a packet claims as
 * its source.
 *
 * Purpose: let a later replay detect that the order's property binding drifted
 * since generation, WITHOUT persisting a second copy of the PIN/address on the
 * artifact row. The inputs are length-prefixed before hashing so that no pair of
 * distinct (pin, address) values can collide by concatenation
 * (e.g. `"12" + "3ab"` vs `"123" + "ab"`).
 *
 * This is a fingerprint for drift detection, not a privacy control: `ot_order`
 * already stores the PIN and address in plaintext, so this is strictly less
 * exposing than what the schema already holds. It is deliberately NOT surfaced
 * in the admin evidence projection.
 */
export function computePropertyBindingFingerprint(input: {
  orderId: string;
  propertyPin: string;
  propertyAddress: string;
}): string {
  const parts = [
    "otpb:v1",
    input.orderId,
    input.propertyPin,
    normalizeAddressForFingerprint(input.propertyAddress),
  ];
  const canonical = parts.map((p) => `${p.length}~${p}`).join(":");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Canonical address form for fingerprinting only: trimmed, internal whitespace
 * collapsed, lowercased. This tolerates incidental re-spacing while still
 * treating a genuinely different address as different.
 */
export function normalizeAddressForFingerprint(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
