"use client"

import { useEffect, useState } from "react"
import Script from "next/script"
import {
  buildSanitizedPageContext,
  GA_READY_EVENT_NAME,
  GA_READY_WINDOW_FLAG,
  isCanonicalGaHost,
  markGaReadyOnWindow,
  shouldEnableLiveGa,
} from "@/lib/analytics/ga4"
import { isClientProductionMarketingRuntime } from "@/lib/marketing/preview-gate-client"

interface GoogleAnalyticsProps {
  measurementId?: string
  googleAdsId?: string
}

/**
 * Google Analytics 4 and Google Ads component
 *
 * Environment variables:
 * - NEXT_PUBLIC_GA_MEASUREMENT_ID (optional)
 * - NEXT_PUBLIC_GOOGLE_ADS_ID (optional)
 *
 * Per LESSONS_LEARNED: Use GA4 ID as script source; configure Google Ads via gtag('config').
 */
export function GoogleAnalytics({ measurementId, googleAdsId }: GoogleAnalyticsProps) {
  const [host, setHost] = useState<string | null>(null)

  useEffect(() => {
    setHost(typeof window !== "undefined" ? window.location.host : null)
  }, [])

  const liveGa = shouldEnableLiveGa({ measurementId, host })
  const liveMarketingHost = isCanonicalGaHost(host)
  const liveMarketing = isClientProductionMarketingRuntime() && liveMarketingHost
  const pageContext = typeof window !== "undefined"
    ? buildSanitizedPageContext({ locationHref: window.location.href, referrer: document.referrer })
    : { page_location: undefined, page_referrer: undefined }

  const primaryId = (liveGa ? measurementId : undefined) || googleAdsId

  useEffect(() => {
    if (!liveMarketing) return
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      markGaReadyOnWindow()
    }
  }, [liveMarketing, primaryId])

  if (!liveMarketing || (!measurementId && !googleAdsId)) {
    return null
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          ${liveGa && measurementId
            ? `gtag('config', '${measurementId}', { send_page_view: false, page_location: ${JSON.stringify(pageContext.page_location ?? "")}, page_referrer: ${JSON.stringify(pageContext.page_referrer ?? "")} });`
            : ""}
          ${googleAdsId ? `gtag('config', '${googleAdsId}');` : ""}
          window.${GA_READY_WINDOW_FLAG} = true;
          window.dispatchEvent(new CustomEvent('${GA_READY_EVENT_NAME}'));
        `}
      </Script>
    </>
  )
}

export function trackGoogleAdsConversion(
  conversionId: string,
  conversionLabel: string,
  value?: number
): void {
  if (typeof window !== "undefined" && (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag) {
    ;(window as unknown as { gtag: (...args: unknown[]) => void }).gtag("event", "conversion", {
      send_to: `${conversionId}/${conversionLabel}`,
      value,
      currency: "USD",
    })
  }
}

declare global {
  interface Window {
    __OT_GA_READY__?: boolean
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}
