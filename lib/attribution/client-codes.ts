/**
 * Client-side first-touch capture of APPROVED acquisition codes.
 *
 * What this can carry is exhaustively: a campaign code and a creative code that
 * are both already members of the server's approved registry. It reads two
 * dedicated query parameters and nothing else — not `document.referrer`, not
 * the landing URL, not UTM values, not any form field. The existing
 * `lib/analytics/utm-tracking.ts` localStorage UTM capture is a separate,
 * untouched mechanism and is never a source for this one.
 *
 * The validation here is a courtesy that avoids pointless requests. It is NOT
 * load-bearing: the checkout route re-resolves every submitted code against the
 * server registry before anything is persisted or sent to the provider.
 *
 * With the shipped registry empty, every function below is a no-op: nothing is
 * stored and nothing is forwarded.
 */

import { resolveAttributionCodes, shippedAttributionRegistry } from "./registry"

/** Dedicated params. Approved codes only — not a place to put a label. */
export const ATTRIBUTION_CAMPAIGN_PARAM = "ot_campaign"
export const ATTRIBUTION_CREATIVE_PARAM = "ot_creative"

const STORAGE_KEY = "ot_attribution_first_touch_v1"
const EXPIRY_DAYS = 30

type StoredFirstTouch = { campaignCode: string; creativeCode: string | null; at: number }

/** The exact body fields the checkout route accepts. */
export type AttributionRequestFields = {
  attributionCampaignCode?: string
  attributionCreativeCode?: string
}

function readStored(): StoredFirstTouch | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFirstTouch>
    if (typeof parsed?.campaignCode !== "string" || typeof parsed?.at !== "number") return null
    if (Date.now() > parsed.at + EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return {
      campaignCode: parsed.campaignCode,
      creativeCode: typeof parsed.creativeCode === "string" ? parsed.creativeCode : null,
      at: parsed.at,
    }
  } catch {
    return null
  }
}

/**
 * Capture on landing. First touch wins: an already-stored pair is never
 * replaced, so a later on-site link carrying different codes cannot clobber the
 * campaign someone actually arrived from.
 *
 * Unapproved or malformed codes are dropped silently here — the client has
 * nothing useful to do with the rejection, and the server refuses them anyway
 * if a hand-rolled request forwards them.
 */
export function captureFirstTouchAttributionCodes(): void {
  if (typeof window === "undefined") return
  if (readStored()) return

  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    return
  }

  const campaignCode = params.get(ATTRIBUTION_CAMPAIGN_PARAM)
  const creativeCode = params.get(ATTRIBUTION_CREATIVE_PARAM)
  if (!campaignCode && !creativeCode) return

  const resolved = resolveAttributionCodes({ campaignCode, creativeCode }, shippedAttributionRegistry())
  if (!resolved.ok || !resolved.attribution) return

  try {
    const stored: StoredFirstTouch = {
      campaignCode: resolved.attribution.campaignCode,
      creativeCode: resolved.attribution.creativeCode,
      at: Date.now(),
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // localStorage unavailable — attribution is simply not captured.
  }
}

/**
 * Fields to merge into the checkout request body.
 *
 * Re-validated against the CURRENT registry on the way out, so a code that was
 * approved when it was stored but has since been withdrawn is not forwarded.
 */
export function getApprovedAttributionCodesForRequest(): AttributionRequestFields {
  const stored = readStored()
  if (!stored) return {}

  const resolved = resolveAttributionCodes(
    { campaignCode: stored.campaignCode, creativeCode: stored.creativeCode },
    shippedAttributionRegistry(),
  )
  if (!resolved.ok || !resolved.attribution) return {}

  return {
    attributionCampaignCode: resolved.attribution.campaignCode,
    ...(resolved.attribution.creativeCode ? { attributionCreativeCode: resolved.attribution.creativeCode } : {}),
  }
}

/** Test/consent helper. */
export function clearStoredAttributionCodes(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}
