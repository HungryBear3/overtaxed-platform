"use client"

import Script from "next/script"

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
  if (!measurementId && !googleAdsId) {
    return null
  }

  const primaryId = measurementId || googleAdsId

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
          gtag('js', new Date());
          ${measurementId ? `gtag('config', '${measurementId}', { page_path: window.location.pathname, send_page_view: true });` : ""}
          ${googleAdsId ? `gtag('config', '${googleAdsId}');` : ""}
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
    gtag: (...args: unknown[]) => void
    dataLayer: unknown[]
  }
}
