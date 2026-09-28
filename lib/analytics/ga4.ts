const CANONICAL_GA_HOSTS = new Set(["overtaxed-il.com", "www.overtaxed-il.com"])
const STRIPE_CHECKOUT_HOST = "checkout.stripe.com"
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

function sanitizeUrl(raw: string | null | undefined, suppressStripeCheckoutReferrer: boolean): string | undefined {
  const parsed = safeUrl(raw)
  if (!parsed) return undefined
  if (suppressStripeCheckoutReferrer && normalizeHost(parsed.host) === STRIPE_CHECKOUT_HOST) return undefined
  return `${parsed.origin}${parsed.pathname}`
}

export function buildSanitizedPageContext(input: { locationHref?: string | null; referrer?: string | null }) {
  return {
    page_location: sanitizeUrl(input.locationHref, false),
    page_referrer: sanitizeUrl(input.referrer, true) ?? "",
  }
}

export function sanitizeGaEventParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    if (BLOCKED_KEYS.includes(key)) continue
    if (Array.isArray(value)) continue
    if (typeof value === "object") continue
    if (typeof value === "string" && (value.includes("checkout.stripe.com") || value.includes("?") || value.includes("#"))) {
      if (key === "page_location" || key === "page_referrer") {
        const sanitized = sanitizeUrl(value, key === "page_referrer")
        if (sanitized) output[key] = sanitized
      }
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
