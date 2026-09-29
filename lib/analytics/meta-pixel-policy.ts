/**
 * Policy for the Meta Pixel candidate: when it may load, which page it may
 * describe, and what it may say. Default-off and fail-closed at every step.
 *
 * ## Loading
 *
 * All four must hold, checked in this order, before any script is inserted:
 * a well-formed public pixel id (NEXT_PUBLIC_META_PIXEL_ID), a production
 * build, the canonical host, and an explicit, current `granted` consent
 * record. There is no consent surface yet, so today nothing loads.
 *
 * ## The page a hit describes
 *
 * The Pixel attaches the page URL and the referrer to every hit by itself;
 * no parameter allowlist can stop that. So a hit is allowed only while the
 * page is one the Pixel may see, judged on raw bytes: a canonical origin, an
 * exact static public path (never a dynamic route, whose segment would travel
 * raw), no fragment, and no query at all except the literal `?plan=diy` on
 * /checkout. A click id or UTM value that fits a pattern is not thereby safe —
 * a PIN, a name or a Stripe id fits too — so `fbclid` and `utm_*` pages are
 * not reported. The referrer must be empty or a static page of this same
 * origin with no query or fragment; another origin never qualifies.
 *
 * ## What a hit may say
 *
 * PageView (no parameters) and InitiateCheckout (tier, value, USD) — nothing
 * else. There is no browser Purchase: the only purchase is the webhook's, and
 * its Meta server counterpart is deferred (./meta-capi). No Advanced Matching
 * data is ever passed.
 *
 * Pure apart from `readMetaPixelConsent`, which reads (and removes an invalid)
 * localStorage record.
 */

import { isCanonicalGaHost } from "./ga4"
import { CHECKOUT_TIERS, MAX_CHECKOUT_VALUE } from "./funnel-contract"
import { normalizeLandingPath } from "@/lib/attribution/landing-paths"

export const META_FBEVENTS_URL = "https://connect.facebook.net/en_US/fbevents.js"
export const META_PIXEL_ID_PATTERN = /^\d{15,16}$/

export const MARKETING_CONSENT_STORAGE_KEY = "ot_marketing_consent_v1"
export const MARKETING_CONSENT_VERSION = 1
/** A consent decision older than this is no longer a current decision. */
export const MARKETING_CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000
const CONSENT_CLOCK_SKEW_MS = 5 * 60 * 1000

export type MetaConsent = "granted" | "denied" | "unknown"
export type MetaLoadRefusal = "not_configured" | "non_production" | "non_canonical_host" | "no_consent"
export type MetaLoadDecision = { allowed: true; pixelId: string } | { allowed: false; reason: MetaLoadRefusal }

export function decideMetaPixelLoad(input: {
  pixelId: unknown
  productionRuntime: boolean
  host: string | null | undefined
  consent: MetaConsent
}): MetaLoadDecision {
  if (typeof input.pixelId !== "string" || !META_PIXEL_ID_PATTERN.test(input.pixelId)) {
    return { allowed: false, reason: "not_configured" }
  }
  if (input.productionRuntime !== true) return { allowed: false, reason: "non_production" }
  if (!isCanonicalGaHost(input.host)) return { allowed: false, reason: "non_canonical_host" }
  if (input.consent !== "granted") return { allowed: false, reason: "no_consent" }
  return { allowed: true, pixelId: input.pixelId }
}

/**
 * `{"version":1,"meta_pixel":"granted"|"denied","decided_at":<epoch ms>}` and
 * nothing else. Anything this code would not have written reads as unknown.
 */
export function parseMarketingConsent(raw: string | null, now: number): MetaConsent {
  if (raw === null) return "unknown"
  let record: unknown
  try {
    record = JSON.parse(raw)
  } catch {
    return "unknown"
  }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return "unknown"
  const value = record as Record<string, unknown>
  if (Object.keys(value).sort().join(",") !== "decided_at,meta_pixel,version") return "unknown"
  if (value.version !== MARKETING_CONSENT_VERSION) return "unknown"
  const at = value.decided_at
  if (typeof at !== "number" || !Number.isSafeInteger(at)) return "unknown"
  if (at > now + CONSENT_CLOCK_SKEW_MS || now - at > MARKETING_CONSENT_MAX_AGE_MS) return "unknown"
  return value.meta_pixel === "granted" || value.meta_pixel === "denied" ? value.meta_pixel : "unknown"
}

/** The current consent decision. An expired or tampered record is removed. */
export function readMetaPixelConsent(): MetaConsent {
  if (typeof window === "undefined") return "unknown"
  try {
    const raw = window.localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY)
    const consent = parseMarketingConsent(raw, Date.now())
    if (raw !== null && consent === "unknown" && window.localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY) === raw) {
      window.localStorage.removeItem(MARKETING_CONSENT_STORAGE_KEY)
    }
    return consent
  } catch {
    return "unknown"
  }
}

export type MetaPageContext = { origin: string; pathname: string; search: string; hash: string; referrer: string }

/** The one query the Pixel may see, compared as raw bytes on its one path. */
const CHECKOUT_PLAN_PATH = "/checkout"
const CHECKOUT_PLAN_QUERY = "?plan=diy"

/** An exact static public path: a Phase-A landing that is not a template. */
function isStaticPublicPath(pathname: string): boolean {
  return normalizeLandingPath(pathname) === pathname && !pathname.includes("[")
}

/** `https://` + a canonical host, spelled exactly as a browser serializes an origin. */
function isCanonicalOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.protocol === "https:" && url.port === "" && url.origin === origin && isCanonicalGaHost(url.host)
}

/**
 * No parsing and no decoding: a value is safe only if its raw bytes are known.
 * A click id or a UTM value that merely fits a pattern can still be a PIN, a
 * name or a Stripe id, so every query except the literal checkout link is out.
 */
function isReportableQuery(pathname: string, search: string): boolean {
  return search === "" || (pathname === CHECKOUT_PLAN_PATH && search === CHECKOUT_PLAN_QUERY)
}

/**
 * Empty, or a static page of this same origin with nothing after the path.
 * Never another origin: its hostname alone is text somebody else chose.
 */
function isSafeReferrer(referrer: string, origin: string): boolean {
  if (referrer === "") return true
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return false
  }
  return url.origin === origin && referrer === `${url.origin}${url.pathname}` && isStaticPublicPath(url.pathname)
}

/** True only while the page the Pixel would report is one it may see. */
export function isMetaSafePageContext(context: MetaPageContext): boolean {
  return (
    isCanonicalOrigin(context.origin) &&
    context.hash === "" &&
    isStaticPublicPath(context.pathname) &&
    isReportableQuery(context.pathname, context.search) &&
    isSafeReferrer(context.referrer, context.origin)
  )
}

export type MetaBrowserEvent = { name: "PageView" | "InitiateCheckout"; params: Record<string, unknown> }

function isCheckoutValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_CHECKOUT_VALUE
}

/**
 * The closed browser event set. InitiateCheckout mirrors begin_checkout's
 * closed parameters; any other name — Purchase above all — has no entry.
 */
export function buildMetaBrowserEvent(name: unknown, params?: unknown): MetaBrowserEvent | null {
  if (name === "PageView") return { name: "PageView", params: {} }
  if (name !== "InitiateCheckout") return null
  const input = typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {}
  const tier = (CHECKOUT_TIERS as readonly unknown[]).includes(input.content_name) ? input.content_name : undefined
  return {
    name: "InitiateCheckout",
    params: {
      ...(tier ? { content_name: tier } : {}),
      ...(isCheckoutValue(input.value) ? { currency: "USD", value: input.value } : {}),
    },
  }
}
