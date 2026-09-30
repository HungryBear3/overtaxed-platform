/**
 * Canonical, closed campaign naming for OverTaxed IL.
 *
 *   campaign  ot_<yyyymm>_<objective>_<slug>   e.g. ot_202610_ret_<slug>
 *   content   <format>_<variant>               e.g. eml_a
 *   source    one of CAMPAIGN_SOURCES
 *   medium    one of CAMPAIGN_MEDIUMS
 *   landing   a Phase-A landing value (lib/attribution/landing-paths)
 *
 * The grammar and vocabularies match the offline decision-packet tool, so a
 * governed value means the same thing there, and every canonical value is also
 * a valid Phase-A UTM token and approved-code shape, so capture and checkout
 * revalidation never drop it. There is no `utm_term` anywhere: search terms
 * are text a person typed.
 *
 * The slug list is the approval. It ships EMPTY — no OT campaign is approved —
 * so no owner-approved registry entry or export row can name a campaign until
 * one is added here by a reviewed change. The synthetic slugs exist only for
 * synthetic fixtures and are refused everywhere else.
 *
 * `forbiddenValueCode` is defense in depth, not the control: it gives a
 * specific, value-free reason (EMAIL, PROPERTY_PIN, STRIPE_ID…) for a value
 * the closed vocabularies would reject anyway. A shape-legal word can still be
 * something a person chose; only the reviewed lists decide acceptance.
 *
 * Pure: no I/O, no framework.
 */

import { isAllowlistedLanding } from "@/lib/attribution/landing-paths"

export const GOVERNANCE_VERSION = "ot-campaign-governance-v1"

export type GovernanceOrigin = "owner_approved" | "synthetic_fixture"

export const CAMPAIGN_OBJECTIVES = ["acq", "rtg", "ret", "brand", "season"] as const
export const CONTENT_FORMATS = ["img", "vid", "txt", "car", "eml", "srch"] as const
export const CONTENT_VARIANTS = ["a", "b", "b2", "v2"] as const

/** Owner-approved OT campaign slugs. Extend only by a reviewed change. */
export const APPROVED_CAMPAIGN_SLUGS: readonly string[] = Object.freeze([])

/** Fixture-only slugs, matching the decision-packet tool's synthetic OT labels. */
export const SYNTHETIC_CAMPAIGN_SLUGS: readonly string[] = Object.freeze(["synthappeal", "synthreminder"])

/** utm_source values a governed campaign may carry. No placeholders. */
export const CAMPAIGN_SOURCES = [
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "facebook",
  "instagram",
  "tiktok",
  "pinterest",
  "youtube",
  "linkedin",
  "reddit",
  "x",
  "nextdoor",
  "newsletter",
  "chatgpt",
  "perplexity",
] as const

/** utm_medium values a governed campaign may carry. No placeholders. */
export const CAMPAIGN_MEDIUMS = [
  "organic",
  "cpc",
  "paid_social",
  "social",
  "email",
  "referral",
  "display",
  "affiliate",
  "sms",
  "qr",
] as const

const MAX_VALUE_LENGTH = 96
const URL_PATTERN = /:\/\/|^\/\/|^www\.|\.(?:com|net|org|io|co|us|app|dev|ai|info|biz|edu|gov)(?:[/:?#]|$)/i
const QUERY_PATTERN = /[?&=#%]/
const STRIPE_PREFIXES = [
  "acct", "ba", "bpc", "card", "ch", "cn", "cs", "cus", "dp", "du", "evt", "fr", "ic", "ii", "il", "in", "ipi",
  "pi", "pk", "pm", "po", "price", "prod", "promo", "py", "pyr", "re", "rk", "seti", "si", "sk", "src", "sub",
  "tok", "tr", "trr", "txn", "txr", "whsec",
]
// A Stripe id body is random base62; an all-lowercase word after a prefix
// (`promo_synthappeal`) is a naming slip, not a provider id.
const STRIPE_ID_PATTERN = new RegExp(
  `(?:^|[^A-Za-z0-9])(?:${STRIPE_PREFIXES.join("|")})_(?:(?:test|live)_)?(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{8,}`,
)
const GA_CLIENT_ID_PATTERN = /(?:^|\D)\d{6,}\.\d{6,}(?!\d)|^GA\d\.\d/i
const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
const PROPERTY_PIN_PATTERN = /(?:^|\D)\d{2}-\d{2}-\d{3}-\d{3}(?:-\d{4})?(?!\d)/
const PHONE_PATTERN = /(?:^|\D)\(?\d{3}\)?[-.]\d{3}[-.]\d{4}(?!\d)/
const HEX_HASH_PATTERN = /(?:^|[^0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/
const OPAQUE_TOKEN_PATTERN = /[A-Za-z0-9]{33,}/
const NUMERIC_ID_PATTERN = /\d{7,}/
/** Phase-A touch-contract identifier shapes: long digit runs, long mixed segments. */
const SEPARATORS = /[._-]/g
const MIXED_SEGMENT_MIN_LENGTH = 12

const ORDERED_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["URL", URL_PATTERN],
  ["QUERY_STRING", QUERY_PATTERN],
  ["STRIPE_ID", STRIPE_ID_PATTERN],
  ["GA_CLIENT_ID", GA_CLIENT_ID_PATTERN],
  ["UUID", UUID_PATTERN],
  ["PROPERTY_PIN", PROPERTY_PIN_PATTERN],
  ["PHONE", PHONE_PATTERN],
  ["UNKEYED_HASH", HEX_HASH_PATTERN],
  ["OPAQUE_TOKEN", OPAQUE_TOKEN_PATTERN],
  ["NUMERIC_IDENTIFIER", NUMERIC_ID_PATTERN],
]

/** A value-free category when `value` looks like free text, a URL or an identifier. */
export function forbiddenValueCode(value: string): string | null {
  if (/\s/.test(value)) return "FREE_TEXT"
  if (/[^\x21-\x7e]/.test(value)) return "NON_ASCII"
  if (value.length > MAX_VALUE_LENGTH) return "FREE_TEXT"
  if (value.includes("@")) return "EMAIL"
  for (const [code, pattern] of ORDERED_PATTERNS) {
    if (pattern.test(value)) return code
  }
  if (/\d{10,}/.test(value.replace(SEPARATORS, ""))) return "IDENTIFIER_SHAPE"
  const mixed = value
    .split(SEPARATORS)
    .some((segment) => segment.length >= MIXED_SEGMENT_MIN_LENGTH && /\d/.test(segment) && /[A-Za-z]/.test(segment))
  return mixed ? "IDENTIFIER_SHAPE" : null
}

/** `TYPE_STRING`, a forbidden-value code, or nothing. */
function screen(value: unknown): string[] | null {
  if (typeof value !== "string") return ["TYPE_STRING"]
  const code = forbiddenValueCode(value)
  return code ? [`FORBIDDEN_VALUE:${code}`] : null
}

const MONTH = /^20[2-9]\d(?:0[1-9]|1[0-2])$/
const PART = /^[a-z0-9]+$/

export function campaignSlugs(origin: GovernanceOrigin): readonly string[] {
  return origin === "synthetic_fixture" ? [...APPROVED_CAMPAIGN_SLUGS, ...SYNTHETIC_CAMPAIGN_SLUGS] : APPROVED_CAMPAIGN_SLUGS
}

export function campaignIssues(value: unknown, origin: GovernanceOrigin): string[] {
  const screened = screen(value)
  if (screened) return screened
  const parts = (value as string).split("_")
  if (parts.length !== 4 || !parts.every((part) => PART.test(part))) return ["CAMPAIGN_SHAPE"]
  const [business, month, objective, slug] = parts
  const issues: string[] = []
  if (business !== "ot") issues.push("CAMPAIGN_BUSINESS")
  if (!MONTH.test(month)) issues.push("CAMPAIGN_MONTH")
  if (!(CAMPAIGN_OBJECTIVES as readonly string[]).includes(objective)) issues.push("CAMPAIGN_OBJECTIVE")
  if (!campaignSlugs(origin).includes(slug)) issues.push("CAMPAIGN_SLUG")
  return issues
}

export function contentIssues(value: unknown): string[] {
  const screened = screen(value)
  if (screened) return screened
  const parts = (value as string).split("_")
  if (parts.length !== 2) return ["CONTENT_SHAPE"]
  const issues: string[] = []
  if (!(CONTENT_FORMATS as readonly string[]).includes(parts[0])) issues.push("CONTENT_FORMAT")
  if (!(CONTENT_VARIANTS as readonly string[]).includes(parts[1])) issues.push("CONTENT_VARIANT")
  return issues
}

export function sourceIssues(value: unknown): string[] {
  const screened = screen(value)
  if (screened) return screened
  return (CAMPAIGN_SOURCES as readonly string[]).includes(value as string) ? [] : ["SOURCE_NOT_GOVERNED"]
}

export function mediumIssues(value: unknown): string[] {
  const screened = screen(value)
  if (screened) return screened
  return (CAMPAIGN_MEDIUMS as readonly string[]).includes(value as string) ? [] : ["MEDIUM_NOT_GOVERNED"]
}

/** A landing must be a value Phase-A capture can produce: a public path or template. */
export function landingIssues(value: unknown): string[] {
  const screened = screen(value)
  if (screened) return screened
  return isAllowlistedLanding(value) ? [] : ["LANDING_NOT_APPROVED"]
}
