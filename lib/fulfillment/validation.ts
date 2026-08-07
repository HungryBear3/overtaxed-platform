/**
 * OT T2 delivery-evidence foundation — fail-closed validators for the durable
 * evidence fields. Pure and database-free. Anything malformed is rejected; none
 * of these accept or echo PII or provider payloads.
 */
import { MAX_ARTIFACT_BYTES, REASON_CODES } from "@/lib/fulfillment/types";

export { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types";

const SHA256_LOWER = /^[0-9a-f]{64}$/;

// PostgreSQL 32-bit signed integer bounds. Every persisted numeric decision is
// held to these so nothing can be authorized that the schema column cannot store.
export const PG_INT_MIN = -2_147_483_648;
export const PG_INT_MAX = 2_147_483_647;

/** A schema-safe PostgreSQL Int: a safe integer within [PG_INT_MIN, PG_INT_MAX]. */
export function isPgInt(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= PG_INT_MIN &&
    value <= PG_INT_MAX
  );
}

/** A schema-safe PostgreSQL Int additionally constrained to [min, max] inclusive. */
export function isPgIntInRange(
  value: unknown,
  min: number,
  max: number,
): boolean {
  return isPgInt(value) && (value as number) >= min && (value as number) <= max;
}

/** Lowercase 64-hex digest of the exact artifact bytes. Uppercase is rejected. */
export function isValidArtifactSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_LOWER.test(value);
}

/** A positive integer byte count within the defensive upper bound. */
export function isValidByteSize(
  value: unknown,
  max: number = MAX_ARTIFACT_BYTES,
): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= max
  );
}

// Any Unicode "Other" (control/format/surrogate/private-use/unassigned) code
// point, or any Unicode whitespace/separator. `\p{Cs}` matches lone surrogate
// code units under the `u` flag, so malformed UTF-16 is rejected too.
const CONTROL_OR_SEPARATOR = /[\p{C}\p{Z}]/u;

/**
 * A bounded, single-line, non-empty opaque string. Rejects — across the whole of
 * Unicode, not merely C0/DEL — every control/format/surrogate/other code point and
 * every whitespace/separator (space, tab, CR/LF, U+0085 NEL, U+00A0 NBSP, U+2028
 * LINE / U+2029 PARAGRAPH SEPARATOR, U+200B ZWSP, U+FEFF, …), and lone surrogates.
 * Never trims/normalizes malformed input into validity. Used for provider ids and
 * lease owners/tokens. Ordinary ASCII and ordinary non-control Unicode identifiers
 * remain accepted.
 */
export function isBoundedOpaqueString(value: unknown, max = 255): boolean {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > max) return false;
  return !CONTROL_OR_SEPARATOR.test(value);
}

/** Opaque provider message id (e.g. a Resend id). Bounded, single-line, non-empty. */
export function isValidProviderMessageId(value: unknown): boolean {
  return isBoundedOpaqueString(value);
}

/** Immutable provider event id used for dedup. Bounded, single-line, non-empty. */
export function isValidProviderEventId(value: unknown): boolean {
  return isBoundedOpaqueString(value);
}

// Strict aware RFC3339 / ISO-8601 UTC instant: `YYYY-MM-DDTHH:MM:SS(.sss)?Z`.
// The trailing `Z` is required (aware/UTC only — naive local times are rejected).
const RFC3339_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * Parse a strict canonical UTC instant to epoch-ms, or null. Rejects `"0"`,
 * date-only, naive (no `Z`), whitespace-padded, control-bearing, and oversized
 * values, and performs a calendar round-trip so impossible dates (e.g. Feb 30)
 * fail closed. Never uses permissive `Date.parse()` alone.
 */
export function parseStrictInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (value.length < 20 || value.length > 24) return null;
  const m = RFC3339_UTC.exec(value);
  if (!m) return null;
  const year = +m[1]!;
  const month = +m[2]!;
  const day = +m[3]!;
  const hour = +m[4]!;
  const minute = +m[5]!;
  const second = +m[6]!;
  const milli = m[7] ? +m[7].padEnd(3, "0") : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const t = Date.UTC(year, month - 1, day, hour, minute, second, milli);
  const dt = new Date(t);
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day ||
    dt.getUTCHours() !== hour ||
    dt.getUTCMinutes() !== minute ||
    dt.getUTCSeconds() !== second
  ) {
    return null;
  }
  return t;
}

/** True when `value` is a strict canonical UTC instant (see parseStrictInstant). */
export function isValidInstant(value: unknown): boolean {
  return parseStrictInstant(value) !== null;
}

/**
 * A private, opaque, relative storage locator (path/key) — never a public/signed/
 * bearer URL. Branded so the Phase-1 storage seam can enforce its own contract.
 * Rejects schemes, protocol-relative and absolute paths, query/fragment, percent
 * encoding, backslashes, whitespace/control chars, empty/`.`/`..` segments, and
 * over-bound values. Accepts e.g. `artifacts/ful_123/v1.pdf`.
 */
export type PrivateStorageLocator = string & {
  readonly __brand: "PrivateStorageLocator";
};

const MAX_LOCATOR = 512;
const LOCATOR_CHARS = /^[A-Za-z0-9._/-]+$/;

export function isValidPrivateStorageLocator(
  value: unknown,
): value is PrivateStorageLocator {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > MAX_LOCATOR) return false;
  if (value.includes("\\")) return false; // backslash
  if (value.includes("?") || value.includes("#")) return false; // query / fragment
  if (value.includes("%")) return false; // percent encoding
  if (value.includes("://")) return false; // scheme separator
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false; // any URI scheme (http:, data:, …)
  if (value.startsWith("/")) return false; // absolute or protocol-relative "//"
  if (!LOCATOR_CHARS.test(value)) return false; // whitespace / control / other chars
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

/** Provider name (e.g. "resend"). Bounded, single-line, non-empty, delimiter-free. */
export function isValidProviderName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.trim().length < 1 || value.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(value);
}

/** Reason code must be a member of the bounded non-PII allowlist. */
export function isValidReasonCode(value: unknown): boolean {
  return typeof value === "string" && REASON_CODES.has(value);
}

export type TimestampChain = {
  createdAt: string;
  requestedAt?: string;
  providerAcceptedAt?: string;
  deliveredAt?: string;
  failedAt?: string;
};

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
  ];
  let prevMs: number | null = null;
  let prevName = "";
  for (const [name, raw] of order) {
    if (raw === undefined) continue;
    const ms = parseStrictInstant(raw);
    if (ms === null) return `INVALID_TIMESTAMP:${String(name)}`;
    if (prevMs !== null && ms < prevMs)
      return `OUT_OF_ORDER:${prevName}->${String(name)}`;
    prevMs = ms;
    prevName = String(name);
  }
  if (chain.failedAt !== undefined) {
    const ms = parseStrictInstant(chain.failedAt);
    if (ms === null) return "INVALID_TIMESTAMP:failedAt";
    const createdMs = parseStrictInstant(chain.createdAt);
    if (createdMs !== null && ms < createdMs)
      return "OUT_OF_ORDER:createdAt->failedAt";
  }
  return null;
}
