"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { MetaPixel } from "./meta-pixel"
import { captureUTMParams } from "@/lib/analytics/utm-tracking"
import { trackGA4Event } from "@/lib/analytics/events"

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

  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID
  // GA4 script loads from root layout (server) for reliable collect; this provider handles page_view on nav + UTM + Meta

  useEffect(() => {
    captureUTMParams()
  }, [])

  useEffect(() => {
    if (pathname) {
      const url = searchParams?.toString() ? `${pathname}?${searchParams.toString()}` : pathname
      trackGA4Event("page_view", {
        page_path: url,
        page_location: typeof window !== "undefined" ? window.location.href : "",
        page_title: typeof document !== "undefined" ? document.title : "",
      })
    }
  }, [pathname, searchParams])

  return (
    <>
      {metaPixelId && <MetaPixel pixelId={metaPixelId} />}
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
