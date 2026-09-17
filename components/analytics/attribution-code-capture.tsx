"use client"

import { useEffect } from "react"
import { captureFirstTouchAttributionCodes } from "@/lib/attribution/client-codes"

/**
 * First-touch capture of APPROVED acquisition codes, mounted app-wide.
 *
 * Renders nothing. On mount it reads `ot_campaign` / `ot_creative` from the
 * landing URL and, only if both resolve against the server-approved registry,
 * stores the pair in localStorage under its own key. The shipped registry is
 * empty, so today this stores nothing.
 *
 * Separate from `UtmFirstTouchCapture` on purpose: that one persists raw UTM
 * values for analytics, this one persists only registry-approved codes and is
 * the only source that may reach the checkout request. Neither reads the other.
 *
 * Writes localStorage only — no cookies, no network, no referrer, no PII — so,
 * like its sibling, it is not gated behind the marketing preview gate.
 */
export function AttributionCodeCapture() {
  useEffect(() => {
    captureFirstTouchAttributionCodes()
  }, [])

  return null
}
