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

function safeDecodeURIComponent(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}

function parseCookies(): Map<string, string> {
  const cookies = new Map<string, string>()
  if (typeof document === "undefined") return cookies

  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator)
    const decoded = safeDecodeURIComponent(trimmed.slice(separator + 1))
    if (decoded !== undefined) cookies.set(name, decoded)
  }

  return cookies
}

function readCookie(name: string): string | undefined {
  return parseCookies().get(name)
}

function gaMeasurementCookieName(measurementId: string | null | undefined): string | undefined {
  const suffix = String(measurementId ?? "").trim().replace(/^G-/i, "").replace(/[^A-Za-z0-9]/g, "")
  return suffix ? `_ga_${suffix}` : undefined
}

function extractGaClientId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const match = raw.match(/GA\d+\.\d+\.(\d+\.\d+)/)
  return match?.[1]
}

function extractGaSession(raw: string | undefined): Pick<AnonymousGaIdentifiers, "gaSessionId" | "gaSessionNumber"> {
  if (!raw) return {}
  const gs1 = raw.match(/^GS1\.1\.(\d+)\.(\d+)/)
  if (gs1) return { gaSessionId: gs1[1], gaSessionNumber: gs1[2] }

  const gs2Session = raw.match(/(?:^|[$.])s(\d+)/)
  const gs2Number = raw.match(/(?:^|[$.])o(\d+)/)
  if (gs2Session || gs2Number) {
    return {
      gaSessionId: gs2Session?.[1],
      gaSessionNumber: gs2Number?.[1],
    }
  }

  return {}
}

export function sanitizeAnonymousGaIdentifiers(input: Record<string, unknown> | AnonymousGaIdentifiers | null | undefined): AnonymousGaIdentifiers {
  const gaClientId = typeof input?.gaClientId === "string" && /^\d{1,20}\.\d{1,20}$/.test(input.gaClientId) ? input.gaClientId : undefined
  const gaSessionIdCandidate = typeof input?.gaSessionId === "string" && /^\d{1,20}$/.test(input.gaSessionId) ? Number(input.gaSessionId) : NaN
  const gaSessionId = Number.isSafeInteger(gaSessionIdCandidate) && gaSessionIdCandidate > 0 ? String(gaSessionIdCandidate) : undefined
  const gaSessionNumber = typeof input?.gaSessionNumber === "string" && /^[1-9]\d{0,9}$/.test(input.gaSessionNumber) ? input.gaSessionNumber : undefined
  return {
    ...(gaClientId ? { gaClientId } : {}),
    ...(gaSessionId ? { gaSessionId } : {}),
    ...(gaSessionNumber ? { gaSessionNumber } : {}),
  }
}

export function getAnonymousGaIdentifiersForRequest(): AnonymousGaIdentifiers {
  if (typeof document === "undefined") return {}

  const gaClientId = extractGaClientId(readCookie("_ga"))
  const cookies = parseCookies()
  const expectedSessionCookie = gaMeasurementCookieName(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)
  const sessionCandidates = Array.from(cookies.entries()).filter(([name]) => name.startsWith("_ga_"))
  const sessionRaw = expectedSessionCookie
    ? cookies.get(expectedSessionCookie)
    : sessionCandidates.length === 1
      ? sessionCandidates[0]?.[1]
      : undefined

  return sanitizeAnonymousGaIdentifiers({
    gaClientId,
    ...extractGaSession(sessionRaw),
  })
}
