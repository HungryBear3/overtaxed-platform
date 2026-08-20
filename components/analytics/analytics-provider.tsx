"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
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

interface AnalyticsProviderProps {
  children: React.ReactNode
}

/**
 * Analytics Provider: GA4, Meta Pixel, UTM capture, page view tracking
 *
 * Env vars: NEXT_PUBLIC_GA_MEASUREMENT_ID, NEXT_PUBLIC_GOOGLE_ADS_ID, NEXT_PUBLIC_META_PIXEL_ID
 */
export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [gaReady, setGaReady] = useState(() => isGaReadyOnWindow())

  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  const liveMarketing =
    isClientProductionMarketingRuntime() &&
    isCanonicalGaHost(typeof window !== "undefined" ? window.location.host : null)
  // GA4 script loads from root layout (server) for reliable collect; this provider handles page_view on nav + UTM + Meta

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

  return (
    <>
      {liveMarketing && metaPixelId && <MetaPixel pixelId={metaPixelId} />}
      {children}
    </>
  )
}

/** Suspense wrapper for useSearchParams (Next.js 13+) */
export function AnalyticsProviderWithSuspense({ children }: AnalyticsProviderProps) {
  return (
    <Suspense fallback={null}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </Suspense>
  )
}
