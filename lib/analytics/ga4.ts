import { normalizeLandingPath } from "@/lib/attribution/landing-paths"
import { campaignIssues, contentIssues, mediumIssues, sourceIssues } from "./campaign-governance"

const CANONICAL_GA_HOSTS = new Set(["overtaxed-il.com", "www.overtaxed-il.com"])
export const GA_READY_EVENT_NAME = "ot:ga-ready"
export const GA_READY_WINDOW_FLAG = "__OT_GA_READY__"
const BLOCKED_KEYS = [
  "pin",
  "email",
  "address",
  "name",
  "session_id",
  "stripe_session_id",
  "stripe_url",
  "checkout_url",
  "customer_id",
  "payment_intent",
]

export type AnonymousGaIdentifiers = {
  gaClientId?: string
  gaSessionId?: string
  gaSessionNumber?: string
}

function normalizeHost(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toLowerCase().split(":")[0]
}

export function isCanonicalGaHost(host: string | null | undefined): boolean {
  return CANONICAL_GA_HOSTS.has(normalizeHost(host))
}

export function shouldEnableLiveGa(input: { measurementId?: string | null; host?: string | null | undefined }): boolean {
  return Boolean(input.measurementId?.trim()) && isCanonicalGaHost(input.host)
}

type GaReadyWindow = Window & {
  [GA_READY_WINDOW_FLAG]?: boolean
  gtag?: (...args: unknown[]) => void
}

export function isGaReadyOnWindow(): boolean {
  if (typeof window === "undefined") return false
  const gaWindow = window as GaReadyWindow
  return gaWindow[GA_READY_WINDOW_FLAG] === true || typeof gaWindow.gtag === "function"
}

export function markGaReadyOnWindow(): void {
  if (typeof window === "undefined") return
  const gaWindow = window as GaReadyWindow
  gaWindow[GA_READY_WINDOW_FLAG] = true
  window.dispatchEvent(new CustomEvent(GA_READY_EVENT_NAME))
}

function safeUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * The path GA4 is told for any page that is not an approved landing route.
 * Account, appeal and property pages carry record ids in their paths, and an
 * unknown path is text somebody else wrote; neither is reported.
 */
export const UNLISTED_PAGE_PATH = "/(other)"

/**
 * Referrer hosts GA4 may see, each for a governed source. A referrer from any
 * other host is sent as "" (direct): a hostname can itself be chosen text, and
 * GA4 needs only the host to classify these. A partner that wants credit tags
 * its links with governed UTM values instead.
 */
const REFERRER_HOST_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  "google.com": "google",
  "www.google.com": "google",
  "bing.com": "bing",
  "www.bing.com": "bing",
  "duckduckgo.com": "duckduckgo",
  "search.yahoo.com": "yahoo",
  "facebook.com": "facebook",
  "www.facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  "lm.facebook.com": "facebook",
  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
  "l.instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "pinterest.com": "pinterest",
  "www.pinterest.com": "pinterest",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "linkedin.com": "linkedin",
  "www.linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "reddit.com": "reddit",
  "www.reddit.com": "reddit",
  "old.reddit.com": "reddit",
  "out.reddit.com": "reddit",
  "t.co": "x",
  "x.com": "x",
  "nextdoor.com": "nextdoor",
  "www.nextdoor.com": "nextdoor",
  "chatgpt.com": "chatgpt",
  "perplexity.ai": "perplexity",
  "www.perplexity.ai": "perplexity",
})

/** The governed source a referrer host stands for, or null. Own keys only. */
export function referrerHostSource(host: unknown): string | null {
  if (typeof host !== "string" || !Object.prototype.hasOwnProperty.call(REFERRER_HOST_SOURCES, host)) return null
  return REFERRER_HOST_SOURCES[host]
}

function webUrl(raw: string | null | undefined): URL | null {
  const parsed = safeUrl(raw)
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.port !== "") return null
  return parsed
}

/** The approved landing value for a pathname, or the unlisted marker. */
export function governedPagePath(pathname: unknown): string {
  return normalizeLandingPath(pathname) ?? UNLISTED_PAGE_PATH
}

/** A query parameter present exactly once. A repeated key is ambiguous and dropped. */
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  return values.length === 1 ? values[0] : null
}

/**
 * The governed UTM query for a landing, rebuilt from values the campaign
 * governance accepts — never the original query. A source outside the closed
 * list means no query at all; medium, campaign (owner-approved slugs only) and
 * content are then each kept only if governed. `utm_term`, click ids and every
 * other parameter are dropped.
 */
function governedCampaignQuery(params: URLSearchParams): string {
  const source = single(params, "utm_source")
  if (source === null || sourceIssues(source).length > 0) return ""
  const kept: Array<[string, string]> = [["utm_source", source]]
  const medium = single(params, "utm_medium")
  if (medium !== null && mediumIssues(medium).length === 0) kept.push(["utm_medium", medium])
  const campaign = single(params, "utm_campaign")
  if (campaign !== null && campaignIssues(campaign, "owner_approved").length === 0) kept.push(["utm_campaign", campaign])
  const content = single(params, "utm_content")
  if (content !== null && contentIssues(content).length === 0) kept.push(["utm_content", content])
  return `?${kept.map(([key, value]) => `${key}=${value}`).join("&")}`
}

/**
 * The page location GA4 may see: origin, the approved landing route (or
 * UNLISTED_PAGE_PATH), and the governed UTM query. Every value in it is from a
 * closed list, so applying it twice gives the same string.
 */
export function governedPageLocation(raw: string | null | undefined): string | undefined {
  const parsed = webUrl(raw)
  if (!parsed) return undefined
  return `${parsed.origin}${governedPagePath(parsed.pathname)}${governedCampaignQuery(parsed.searchParams)}`
}

/**
 * The page referrer GA4 may see: an allowlisted host's origin with path `/`,
 * this site's origin with its governed path, or "".
 */
export function governedPageReferrer(raw: string | null | undefined): string {
  const parsed = webUrl(raw)
  if (!parsed) return ""
  if (isCanonicalGaHost(parsed.host)) return `${parsed.origin}${governedPagePath(parsed.pathname)}`
  return referrerHostSource(parsed.host) ? `${parsed.origin}/` : ""
}

export function buildSanitizedPageContext(input: { locationHref?: string | null; referrer?: string | null }) {
  return {
    page_location: governedPageLocation(input.locationHref),
    page_referrer: governedPageReferrer(input.referrer),
  }
}

/**
 * Bound a generic event's parameters. `page_location`, `page_referrer` and
 * `page_path` are always re-governed (an explicit "" is kept as ""), so no
 * caller can hand GA4 a raw URL, referrer or path under those names.
 */
export function sanitizeGaEventParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    if (BLOCKED_KEYS.includes(key)) continue
    if (Array.isArray(value)) continue
    if (typeof value === "object") continue
    if (key === "page_location" || key === "page_referrer" || key === "page_path") {
      if (typeof value !== "string") continue
      if (value === "") {
        if (key !== "page_path") output[key] = ""
        continue
      }
      const governed =
        key === "page_location"
          ? governedPageLocation(value)
          : key === "page_referrer"
            ? governedPageReferrer(value)
            : governedPagePath(value)
      if (governed !== undefined) output[key] = governed
      continue
    }
    if (typeof value === "string" && (value.includes("checkout.stripe.com") || value.includes("?") || value.includes("#"))) {
      continue
    }
    output[key] = value
  }

  return output
}

/**
 * Every value of every cookie, raw.
 *
 * Nothing is percent-decoded. GA writes plain ASCII cookie values and never
 * encodes them, so an encoded or malformed-encoded value was not written by GA
 * and must fail the exact patterns below rather than be decoded into a match.
 * Every copy of a name is kept: a browser can hold the same name twice (set on
 * the apex and on `www`, or by another script), and which copy is "the" value
 * is then unknowable.
 */
function cookieValues(): Map<string, string[]> {
  const cookies = new Map<string, string[]>()
  if (typeof document === "undefined") return cookies

  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator)
    const values = cookies.get(name) ?? []
    values.push(trimmed.slice(separator + 1))
    cookies.set(name, values)
  }

  return cookies
}

/** The cookie's value when every copy of it agrees; otherwise nothing. */
function unambiguousCookie(cookies: Map<string, string[]>, name: string): string | undefined {
  const values = cookies.get(name)
  if (!values || new Set(values).size !== 1) return undefined
  return values[0]
}

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/
/** `GA1.<domain depth>.<random>.<first-visit epoch seconds>`; the client id is the last two fields. */
const GA_CLIENT_COOKIE_PATTERN = /^GA1\.[1-9]\d?\.(\d{1,10}\.\d{10})$/
/** `GS1.1.<session start>.<session number>.<more numeric fields>` */
const GS1_SESSION_COOKIE_PATTERN = /^GS1\.[1-9]\.([1-9]\d{9})\.([1-9]\d{0,5})(?:\.[0-9A-Za-z_-]{1,32}){0,12}$/
/** `GS2.1.s<session start>$o<session number>$g…$t…` */
const GS2_SESSION_COOKIE_PATTERN = /^GS2\.[1-9]\.s([1-9]\d{9})\$o([1-9]\d{0,5})(?:\$[a-z][0-9A-Za-z_-]{0,64}){0,16}$/

const GA_CLIENT_ID_PATTERN = /^\d{1,10}\.\d{10}$/
const GA_SESSION_ID_PATTERN = /^[1-9]\d{9}$/
const GA_SESSION_NUMBER_PATTERN = /^[1-9]\d{0,5}$/

/**
 * The session cookie for THIS property only. A missing or malformed
 * measurement id yields no name at all: there is no fallback to "the only
 * `_ga_*` cookie present", because any script on any subdomain can set one.
 */
function gaMeasurementCookieName(measurementId: string | null | undefined): string | undefined {
  const id = String(measurementId ?? "").trim()
  if (!GA_MEASUREMENT_ID_PATTERN.test(id)) return undefined
  return `_ga_${id.slice(2)}`
}

function extractGaClientId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  return GA_CLIENT_COOKIE_PATTERN.exec(raw)?.[1]
}

function extractGaSession(raw: string | undefined): Pick<AnonymousGaIdentifiers, "gaSessionId" | "gaSessionNumber"> {
  if (!raw) return {}
  const match = GS1_SESSION_COOKIE_PATTERN.exec(raw) ?? GS2_SESSION_COOKIE_PATTERN.exec(raw)
  return match ? { gaSessionId: match[1], gaSessionNumber: match[2] } : {}
}

/**
 * Server-side (and client-side) bound on the identifiers checkout forwards.
 *
 * Exact shapes, not "some digits": the client id is `<random>.<epoch seconds>`,
 * the session id is an epoch-seconds session start, and the session number is a
 * small positive count. Anything else is dropped, never repaired — a leading
 * zero is not stripped into a different id.
 */
export function sanitizeAnonymousGaIdentifiers(input: Record<string, unknown> | AnonymousGaIdentifiers | null | undefined): AnonymousGaIdentifiers {
  const gaClientId = typeof input?.gaClientId === "string" && GA_CLIENT_ID_PATTERN.test(input.gaClientId) ? input.gaClientId : undefined
  const gaSessionId = typeof input?.gaSessionId === "string" && GA_SESSION_ID_PATTERN.test(input.gaSessionId) ? input.gaSessionId : undefined
  const gaSessionNumber = typeof input?.gaSessionNumber === "string" && GA_SESSION_NUMBER_PATTERN.test(input.gaSessionNumber) ? input.gaSessionNumber : undefined
  return {
    ...(gaClientId ? { gaClientId } : {}),
    ...(gaSessionId ? { gaSessionId } : {}),
    ...(gaSessionNumber ? { gaSessionNumber } : {}),
  }
}

export function getAnonymousGaIdentifiersForRequest(): AnonymousGaIdentifiers {
  if (typeof document === "undefined") return {}

  const cookies = cookieValues()
  const sessionCookieName = gaMeasurementCookieName(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)

  return sanitizeAnonymousGaIdentifiers({
    gaClientId: extractGaClientId(unambiguousCookie(cookies, "_ga")),
    ...(sessionCookieName ? extractGaSession(unambiguousCookie(cookies, sessionCookieName)) : {}),
  })
}
