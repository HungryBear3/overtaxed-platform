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

/* ── Provider-stated instants ────────────────────────────────────────────── */

/**
 * A full RFC3339 `date-time`, as a PROVIDER may legitimately write one.
 *
 * [[parseStrictInstant]] deliberately accepts only our own canonical rendering:
 * `Z`, and at most three fractional digits. That is right for instants this
 * system produces — every one of them comes from `to_char(... 'MS')` or from
 * `Date.prototype.toISOString`, and a value outside that shape means something
 * is wrong with US.
 *
 * It is the wrong rule for a value a third party wrote. RFC3339 places no cap on
 * `time-secfrac` and does not require the `Z` spelling of a zero offset, and
 * Resend's own API documents timestamps in both `2026-09-12T12:00:00.000Z` and
 * `2026-09-12T12:00:00.674981+00:00` forms. Under the strict validator the
 * second of those is INVALID_TIMESTAMP: a well-formed, authenticated, signed
 * `email.delivered` event would be refused at the door and the packet would
 * never be recorded as delivered.
 *
 * So provider instants get their own parser — a wider grammar, normalized once,
 * explicitly. What is deliberately NOT done here is falling back to `new Date()`
 * or `Date.parse()`: those accept `"2026"`, `"Dec 12 2026"`, `"2026-13-45"` on
 * some engines, and silently interpret a naive local time in the server's own
 * zone. A provider timestamp is attacker-adjacent input even after signature
 * verification, and coercing it is how an evidence row gets an instant nobody
 * asserted.
 */
const RFC3339_PROVIDER =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

/**
 * `YYYY-MM-DDTHH:MM:SS` + `.mmm` + up to 6 more fractional digits + `±HH:MM`.
 * A value outside this is not a date-time we are willing to spend time parsing.
 */
const MIN_PROVIDER_INSTANT = 20;
const MAX_PROVIDER_INSTANT = 35;

export type ProviderInstant = {
  /** Epoch milliseconds, with sub-millisecond precision TRUNCATED. */
  epochMs: number;
  /**
   * The same instant in this system's canonical form, which
   * [[parseStrictInstant]] accepts. This — never the provider's own spelling —
   * is what may be persisted or compared.
   */
  canonical: string;
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Parse a provider-stated RFC3339 instant, or null.
 *
 * Normalization is stated rather than inferred:
 *
 *   - **offsets are resolved by arithmetic**, not by a date library. `+HH:MM` is
 *     subtracted and `-HH:MM` added to reach UTC. `-00:00` — which RFC3339 gives
 *     the distinct meaning "offset unknown" — is accepted as the zero offset it
 *     numerically is, because the instant is unambiguous either way and it is
 *     the instant, not the reporter's locale, that this system records;
 *   - **sub-millisecond precision is TRUNCATED, never rounded.** Truncation can
 *     only move an instant up to one millisecond into the PAST, which cannot
 *     manufacture an event that happened after it arrived; rounding could;
 *   - **leap seconds are refused.** `:60` is valid RFC3339 and has no
 *     representation in a JavaScript epoch, so it fails closed rather than
 *     silently becoming `:59` or the next minute;
 *   - **the calendar is round-tripped**, so `2026-02-30T00:00:00Z` is rejected
 *     rather than rolling forward into March the way `Date` would.
 */
export function parseProviderInstant(value: unknown): ProviderInstant | null {
  if (typeof value !== "string") return null;
  if (
    value.length < MIN_PROVIDER_INSTANT ||
    value.length > MAX_PROVIDER_INSTANT
  ) {
    return null;
  }
  const m = RFC3339_PROVIDER.exec(value);
  if (!m) return null;

  const year = +m[1]!;
  const month = +m[2]!;
  const day = +m[3]!;
  const hour = +m[4]!;
  const minute = +m[5]!;
  const second = +m[6]!;
  // Exactly the first three digits. `.6` is 600ms, not 6ms, so the fraction is
  // right-padded before it is cut — a provider writing tenths must not have its
  // timestamp shifted by 594 milliseconds.
  const milli = m[7] ? +m[7].padEnd(3, "0").slice(0, 3) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  let offsetMinutes = 0;
  if (m[8] === undefined) {
    const offsetHour = +m[10]!;
    const offsetMinute = +m[11]!;
    if (offsetHour > 23 || offsetMinute > 59) return null;
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (m[9] === "-" ? -1 : 1);
  }

  // The wall-clock fields are validated as if they were UTC, so an impossible
  // calendar date fails before the offset is applied and cannot be rescued by it.
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, milli);
  const asUtc = new Date(wall);
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day ||
    asUtc.getUTCHours() !== hour ||
    asUtc.getUTCMinutes() !== minute ||
    asUtc.getUTCSeconds() !== second
  ) {
    return null;
  }

  const epochMs = wall - offsetMinutes * 60_000;
  if (!Number.isFinite(epochMs)) return null;
  const utc = new Date(epochMs);
  const canonical =
    `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1, 2)}-` +
    `${pad(utc.getUTCDate(), 2)}T${pad(utc.getUTCHours(), 2)}:` +
    `${pad(utc.getUTCMinutes(), 2)}:${pad(utc.getUTCSeconds(), 2)}.` +
    `${pad(utc.getUTCMilliseconds(), 3)}Z`;
  // Belt and braces: whatever comes out of here must satisfy the strict parser
  // every other layer measures instants with, or it may not leave this function.
  if (parseStrictInstant(canonical) !== epochMs) return null;
  return { epochMs, canonical };
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
