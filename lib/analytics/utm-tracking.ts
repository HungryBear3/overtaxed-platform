/**
 * UTM Parameter Tracking
 * Captures and stores UTM parameters for marketing attribution.
 *
 * Every value written to or read back from the legacy `utm_params` key obeys
 * the attribution touch contract (lib/attribution/touch-contract): the five
 * UTM keys only, each independently bounded and token-shaped. The values come
 * from URL query parameters that anyone who writes a link chooses, and
 * `sanitizeGaEventParams` cannot catch an email or a PIN that carries neither
 * `?` nor `#`, so nothing unvalidated is persisted or returned from here.
 */

import { MAX_CLOCK_SKEW_MS, UTM_KEYS, sanitizeUtmValue } from "@/lib/attribution/touch-contract"

export interface UTMParams {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

const UTM_STORAGE_KEY = "utm_params"
const UTM_TIMESTAMP_KEY = "utm_timestamp"
const UTM_EXPIRY_DAYS = 30

export function captureUTMParams(): UTMParams {
  if (typeof window === "undefined") return {}

  const params = new URLSearchParams(window.location.search)
  const utm: UTMParams = {}
  for (const key of UTM_KEYS) {
    const values = params.getAll(key)
    // A repeated key is ambiguous; neither value is kept.
    if (values.length !== 1) continue
    const value = sanitizeUtmValue(key, values[0])
    if (value !== null) utm[key] = value
  }

  if (Object.keys(utm).length > 0) {
    try {
      localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utm))
      localStorage.setItem(UTM_TIMESTAMP_KEY, Date.now().toString())
    } catch {
      // localStorage unavailable
    }
  }

  return utm
}

/**
 * First-touch capture. Persists the campaign UTM the FIRST time they appear and
 * never lets a later navigation overwrite them. This matters for the funnel:
 * /hoa's own on-page links re-tag onward traffic as `utm_source=hoa`
 * (see app/hoa/hoa-client.tsx), so a plain `captureUTMParams()` running on every
 * page would clobber the original campaign source (e.g. `property_manager`) at
 * the very next click. First-touch keeps the original attribution readable via
 * getStoredUTMParams()/getAttributionData() across the whole funnel.
 *
 * localStorage only — no cookies, no network, no PII — so it is safe to run in
 * preview and dev as well as production.
 */
export function captureFirstTouchUTM(): UTMParams {
  if (typeof window === "undefined") return {}
  const existing = getStoredUTMParams()
  if (existing && Object.keys(existing).length > 0) return existing
  return captureUTMParams()
}

export function getStoredUTMParams(): UTMParams | null {
  if (typeof window === "undefined") return null

  try {
    const stored = localStorage.getItem(UTM_STORAGE_KEY)
    const timestamp = localStorage.getItem(UTM_TIMESTAMP_KEY)
    if (!stored || !timestamp) {
      // Half a record can never be read back; do not leave it behind.
      if (stored || timestamp) clearUTMParams()
      return null
    }

    // A timestamp that is not a plain integer, or lies in the future, would
    // otherwise never expire (`Date.now() > NaN` is false), keeping whatever
    // sits under the key alive indefinitely.
    const storedTime = /^\d{1,16}$/.test(timestamp) ? Number(timestamp) : Number.NaN
    const now = Date.now()
    if (
      !Number.isSafeInteger(storedTime) ||
      storedTime > now + MAX_CLOCK_SKEW_MS ||
      now - storedTime > UTM_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    ) {
      clearUTMParams()
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stored)
    } catch {
      clearUTMParams()
      return null
    }
    const utm = sanitizeStoredUTMParams(parsed)
    if (Object.keys(utm).length === 0) {
      clearUTMParams()
      return null
    }
    // Keep only what the contract accepts: a refused value is removed from
    // storage, not just from the result. Skipped if another tab rewrote it.
    const sanitized = JSON.stringify(utm)
    if (sanitized !== stored && localStorage.getItem(UTM_STORAGE_KEY) === stored) {
      localStorage.setItem(UTM_STORAGE_KEY, sanitized)
    }
    return utm
  } catch {
    return null
  }
}

function sanitizeStoredUTMParams(raw: unknown): UTMParams {
  const utm: UTMParams = {}
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return utm
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(key, (raw as Record<string, unknown>)[key])
    if (value !== null) utm[key] = value
  }
  return utm
}

export function clearUTMParams(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(UTM_STORAGE_KEY)
    localStorage.removeItem(UTM_TIMESTAMP_KEY)
  } catch {
    // Ignore
  }
}

export function getAttributionData(): {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
} | null {
  const utm = getStoredUTMParams()
  if (!utm) return null
  return {
    utmSource: utm.utm_source,
    utmMedium: utm.utm_medium,
    utmCampaign: utm.utm_campaign,
    utmTerm: utm.utm_term,
    utmContent: utm.utm_content,
  }
}
