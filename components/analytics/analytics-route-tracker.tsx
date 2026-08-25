"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { MetaPixel } from "./meta-pixel"
import { captureUTMParams } from "@/lib/analytics/utm-tracking"
import { trackGA4Event } from "@/lib/analytics/events"
import {
  buildSanitizedPageContext,
  GA_READY_EVENT_NAME,
  isCanonicalGaHost,
  isGaReadyOnWindow,
  sanitizeGaEventParams,
  shouldEnableLiveGa,
} from "@/lib/analytics/ga4"
import { isClientProductionMarketingRuntime } from "@/lib/marketing/preview-gate-client"

/**
 * Route-scoped analytics effects: GA4 page_view on navigation, UTM recapture,
 * and the Meta Pixel mount. Renders no route content — deliberately.
 *
 * `useSearchParams()` cannot be prerendered. React suspends on it during a
 * static render and Next resolves the whole enclosing `<Suspense>` boundary on
 * the client, replacing that boundary's output with
 * `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">`. Whatever is inside
 * the boundary is therefore absent from the served bytes.
 *
 * This component exists so that the boundary contains only these effects. When
 * the hooks lived on a component that also rendered `{children}`, the boundary
 * was the entire route tree and `/`, `/pricing` and `/terms` served an empty
 * body — correct only after hydration, and invisible to a crawler, a link
 * preview, or a reader whose scripts have not run.
 *
 * Env vars: NEXT_PUBLIC_GA_MEASUREMENT_ID, NEXT_PUBLIC_GOOGLE_ADS_ID,
 * NEXT_PUBLIC_META_PIXEL_ID
 */
export function AnalyticsRouteTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [gaReady, setGaReady] = useState(() => isGaReadyOnWindow())

  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  const liveMarketing =
    isClientProductionMarketingRuntime() &&
    isCanonicalGaHost(typeof window !== "undefined" ? window.location.host : null)
  // GA4 script loads from root layout (server) for reliable collect; this tracker handles page_view on nav + UTM + Meta

  useEffect(() => {
    captureUTMParams()
  }, [pathname, searchParams])

  useEffect(() => {
    if (!liveMarketing) return

    const syncGaReady = () => {
      if (isGaReadyOnWindow()) setGaReady(true)
    }

    syncGaReady()
    window.addEventListener(GA_READY_EVENT_NAME, syncGaReady)

    return () => {
      window.removeEventListener(GA_READY_EVENT_NAME, syncGaReady)
    }
  }, [liveMarketing])

  useEffect(() => {
    if (!liveMarketing || !gaReady || !pathname) return

    const liveGa = shouldEnableLiveGa({
      measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
      host: typeof window !== "undefined" ? window.location.host : null,
    })
    if (!liveGa) return

    const pageContext = buildSanitizedPageContext({
      locationHref: typeof window !== "undefined" ? window.location.href : undefined,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
    })
    trackGA4Event("page_view", sanitizeGaEventParams({
      page_path: pathname,
      page_title: typeof document !== "undefined" ? document.title : "",
      ...pageContext,
    }))
  }, [gaReady, liveMarketing, pathname])

  return <>{liveMarketing && metaPixelId && <MetaPixel pixelId={metaPixelId} />}</>
}
