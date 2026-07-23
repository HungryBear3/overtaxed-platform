/**
 * UTM Parameter Tracking
 * Captures and stores UTM parameters for marketing attribution.
 */

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
  const utmKeys: (keyof UTMParams)[] = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]

  utmKeys.forEach((key) => {
    const value = params.get(key)
    if (value) utm[key] = value
  })

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
    if (!stored || !timestamp) return null

    const storedTime = parseInt(timestamp, 10)
    const expiryTime = storedTime + UTM_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() > expiryTime) {
      clearUTMParams()
      return null
    }

    return JSON.parse(stored)
  } catch {
    return null
  }
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
