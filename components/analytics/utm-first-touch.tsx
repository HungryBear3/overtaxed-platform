"use client"

import { useEffect } from "react"
import { captureFirstTouchUTM } from "@/lib/analytics/utm-tracking"
import { recordLandingTouch } from "@/lib/attribution/touch-store"

/**
 * First-touch UTM capture, mounted app-wide in the root layout.
 *
 * Renders nothing. On mount it records this document's landing as an
 * attribution touch (lib/attribution/touch-store: the immutable first touch and
 * the last non-direct touch that checkout carries), and keeps the legacy
 * first-touch `utm_params` copy (30-day window). This is what preserves a
 * campaign's `utm_source`/`utm_medium`/`utm_campaign` from a landing page
 * (e.g. /hoa or a resident-notice link straight to /check) through the rest of
 * the funnel, since /hoa's own outbound links re-tag onward traffic with
 * internal UTMs.
 *
 * Deliberately NOT gated behind the marketing preview gate: it writes only
 * localStorage — no cookies, no network requests, no PII — so it is safe in
 * preview/dev and does not touch any lead, email/SMS, cookie, or analytics
 * platform surface.
 */
export function UtmFirstTouchCapture() {
  useEffect(() => {
    recordLandingTouch()
    captureFirstTouchUTM()
  }, [])

  return null
}
