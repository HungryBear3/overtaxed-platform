"use client"

import { useEffect } from "react"
import { captureFirstTouchUTM } from "@/lib/analytics/utm-tracking"

/**
 * First-touch UTM capture, mounted app-wide in the root layout.
 *
 * Renders nothing. On mount it reads the current URL's UTM parameters and, if
 * none are already stored, persists them to localStorage (30-day window). This
 * is what preserves a campaign's `utm_source`/`utm_medium`/`utm_campaign` from a
 * landing page (e.g. /hoa or a resident-notice link straight to /check) through
 * the rest of the funnel, since /hoa's own outbound links re-tag onward traffic
 * with internal UTMs.
 *
 * Deliberately NOT gated behind the marketing preview gate: it writes only
 * localStorage — no cookies, no network requests, no PII — so it is safe in
 * preview/dev and does not touch any lead, email/SMS, cookie, or analytics
 * platform surface.
 */
export function UtmFirstTouchCapture() {
  useEffect(() => {
    captureFirstTouchUTM()
  }, [])

  return null
}
