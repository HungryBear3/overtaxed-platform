/**
 * The privacy contract for campaign attribution touches.
 *
 * A touch records ONE landing: which of the five UTM parameters it carried, the
 * landing value (see ./landing-paths), and when it was captured. Nothing else
 * has a field to live in — no raw query, no fragment, no referrer, no form
 * value, no identifier. The same validator runs on every boundary a touch
 * crosses: the landing URL (client capture), the browser's stored copy (read
 * back before it may suppress a recapture), the checkout request body (server
 * revalidation) and, finally, the Stripe metadata projection.
 *
 * ## What a UTM value may be
 *
 * UTM values arrive as URL query parameters, so whoever wrote the link chose
 * them. Each of the five keys is bounded independently, and a value must be a
 * single token of `[A-Za-z0-9._-]` starting with a letter or digit. That makes
 * an email (`@`), a URL (`:`, `/`), a street address or a name (spaces), query
 * syntax (`=`, `&`) and percent-encoding (`%`) unrepresentable. Two shape rules
 * then refuse identifier-like tokens the charset alone would admit:
 *
 *   - ten or more consecutive digits once `.`/`_`/`-` are removed: a PIN
 *     (`16-01-216-001-0000`), a phone number, a numeric account id;
 *   - any separator-delimited segment of twelve or more characters that mixes
 *     letters and digits: a Stripe id (`cus_NffrFeUfNV2Hib`), a record id
 *     (`clx1abc…`), a token.
 *
 * A shape-legal token can still be a word someone chose (`jane_doe`). The
 * shape rules cannot read meaning, so the Stripe projection additionally keeps
 * a campaign touch only when its whole tuple passes the closed, owner-approved
 * campaign governance (lib/analytics/campaign-governance) — the same lists
 * GA4's page context uses — and never projects `utm_term`. Nothing here joins
 * a touch to a person: it only ever travels with the anonymous checkout it
 * preceded.
 *
 * Pure and isomorphic: no storage, no network, no framework.
 */

import { campaignTupleIssues } from "@/lib/analytics/campaign-governance"

import { isAllowlistedLanding, normalizeLandingPath } from "./landing-paths"

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const
export type UtmKey = (typeof UTM_KEYS)[number]

/** Independent bound per key. GA4 caps event parameter values at 100 chars. */
export const UTM_MAX_LENGTH: Readonly<Record<UtmKey, number>> = {
  utm_source: 40,
  utm_medium: 40,
  utm_campaign: 100,
  utm_content: 100,
  utm_term: 60,
}

/** Touch field for each UTM key. Stored, submitted and projected under these names. */
const TOUCH_FIELD_FOR_KEY = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_content: "content",
  utm_term: "term",
} as const satisfies Record<UtmKey, string>

type TouchField = (typeof TOUCH_FIELD_FOR_KEY)[UtmKey]

export type AttributionTouch = {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
  /** A value from ./landing-paths, never a raw pathname. */
  landing?: string
  /** Capture instant, epoch milliseconds. */
  at: number
}

export type CheckoutAttribution = {
  first: AttributionTouch | null
  last: AttributionTouch | null
}

/** A touch older than this no longer describes the visit that led to checkout. */
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Tolerated forward skew between the clock that captured a touch and ours. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

const UTM_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LONG_DIGIT_RUN = /\d{10,}/
const SEPARATORS = /[._-]/g
const MIXED_TOKEN_MIN_LENGTH = 12

const TOUCH_KEYS: ReadonlySet<string> = new Set([...Object.values(TOUCH_FIELD_FOR_KEY), "landing", "at"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function looksLikeIdentifier(value: string): boolean {
  if (LONG_DIGIT_RUN.test(value.replace(SEPARATORS, ""))) return true
  return value
    .split(SEPARATORS)
    .some((segment) => segment.length >= MIXED_TOKEN_MIN_LENGTH && /\d/.test(segment) && /[A-Za-z]/.test(segment))
}

/** The value for one UTM key, or `null` when it is not an acceptable token. */
export function sanitizeUtmValue(key: UtmKey, value: unknown): string | null {
  if (typeof value !== "string") return null
  if (value.length === 0 || value.length > UTM_MAX_LENGTH[key]) return null
  if (!UTM_VALUE_PATTERN.test(value)) return null
  if (looksLikeIdentifier(value)) return null
  return value
}

/** True when a touch carries at least one campaign field, i.e. is not direct. */
export function isCampaignTouch(touch: AttributionTouch): boolean {
  return UTM_KEYS.some((key) => touch[TOUCH_FIELD_FOR_KEY[key]] !== undefined)
}

/**
 * Build a touch from a landing URL's query string and pathname.
 *
 * The URL is untrusted input, so each UTM key is judged on its own and an
 * unacceptable value is simply not kept. A repeated key is ambiguous and
 * neither value is trusted. No other query parameter, no fragment and no raw
 * path can reach the result: the landing is the allowlisted value or nothing.
 */
export function touchFromLanding(input: { search: string; pathname: string; at: number }): AttributionTouch {
  const params = new URLSearchParams(input.search)
  const touch: AttributionTouch = { at: input.at }
  for (const key of UTM_KEYS) {
    const values = params.getAll(key)
    if (values.length !== 1) continue
    const value = sanitizeUtmValue(key, values[0])
    if (value !== null) touch[TOUCH_FIELD_FOR_KEY[key]] = value
  }
  const landing = normalizeLandingPath(input.pathname)
  if (landing !== null) touch.landing = landing
  return touch
}

/**
 * Validate a stored or submitted touch as a whole.
 *
 * Anything this code did not write is refused rather than repaired: an
 * unrecognized key, a value that fails its own key's contract, a landing that
 * is not an allowlisted value, or an instant that is not an integer inside the
 * attribution window. A partially valid touch is not kept, because dropping
 * one field can change what the remaining ones mean.
 */
export function sanitizeTouch(raw: unknown, now: number): AttributionTouch | null {
  if (!isPlainObject(raw)) return null
  for (const key of Object.keys(raw)) {
    if (!TOUCH_KEYS.has(key)) return null
  }

  const at = raw.at
  if (typeof at !== "number" || !Number.isSafeInteger(at)) return null
  if (at > now + MAX_CLOCK_SKEW_MS || now - at > ATTRIBUTION_WINDOW_MS) return null

  const touch: AttributionTouch = { at }
  for (const key of UTM_KEYS) {
    const field: TouchField = TOUCH_FIELD_FOR_KEY[key]
    if (!(field in raw)) continue
    const value = sanitizeUtmValue(key, raw[field])
    if (value === null) return null
    touch[field] = value
  }
  if ("landing" in raw) {
    if (!isAllowlistedLanding(raw.landing)) return null
    touch.landing = raw.landing
  }
  return touch
}

/**
 * Server-side revalidation of the checkout request's `attribution` field.
 *
 * The client's validation is a courtesy; this is the one that decides what can
 * reach Stripe metadata. Invalid input degrades to "no attribution" and never
 * refuses the checkout: a malformed link must not be able to block a purchase.
 */
export function revalidateCheckoutAttribution(raw: unknown, now: number): CheckoutAttribution {
  const none: CheckoutAttribution = { first: null, last: null }
  if (!isPlainObject(raw)) return none
  for (const key of Object.keys(raw)) {
    if (key !== "first" && key !== "last") return none
  }
  const first = raw.first === undefined ? null : sanitizeTouch(raw.first, now)
  const lastCandidate = raw.last === undefined ? null : sanitizeTouch(raw.last, now)
  const last = lastCandidate && isCampaignTouch(lastCandidate) ? lastCandidate : null
  return { first, last }
}

const METADATA_FIELD_SUFFIX: Readonly<Record<Exclude<TouchField, "term"> | "landing", string>> = {
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  content: "Content",
  landing: "Landing",
}

function secondPrecisionIso(at: number): string {
  return new Date(Math.floor(at / 1000) * 1000).toISOString().replace(".000Z", "Z")
}

/**
 * The touch as it may reach Stripe, or `null` when it may not. A direct touch
 * keeps its landing and instant. A campaign touch is kept only when its whole
 * source/medium/campaign/content tuple passes the owner-approved campaign
 * governance GA4 applies; otherwise nothing of it is kept, because a partial
 * tuple — or a direct-looking landing left behind — would misstate the visit.
 * The term is never kept: search terms are text a person typed.
 */
function governedTouch(touch: AttributionTouch): AttributionTouch | null {
  const { term: _term, ...kept } = touch
  if (!isCampaignTouch(touch)) return kept
  return campaignTupleIssues(kept, "owner_approved").length === 0 ? kept : null
}

function projectTouch(prefix: "firstTouch" | "lastTouch", raw: AttributionTouch | null): Record<string, string> {
  const touch = raw ? governedTouch(raw) : null
  if (!touch) return {}
  const output: Record<string, string> = {}
  for (const field of ["source", "medium", "campaign", "content", "landing"] as const) {
    const value = touch[field]
    if (value !== undefined) output[`${prefix}${METADATA_FIELD_SUFFIX[field]}`] = value
  }
  output[`${prefix}At`] = secondPrecisionIso(touch.at)
  return output
}

/**
 * Stripe metadata for already-revalidated touches, each governed as a whole
 * (see governedTouch). Fixed key names, each value bounded by its contract
 * (well under Stripe's 500-character limit), and none in the `attribution*`
 * namespace owned by the approved-code binding.
 */
export function touchesToStripeMetadata(touches: CheckoutAttribution): Record<string, string> {
  return {
    ...projectTouch("firstTouch", touches.first),
    ...projectTouch("lastTouch", touches.last),
  }
}
