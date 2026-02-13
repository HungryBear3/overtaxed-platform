/**
 * Analytics Event Tracking for OverTaxed
 * GA4, Meta Pixel, and Google Ads
 */

import { trackMetaEvent, trackMetaCustomEvent } from "@/components/analytics/meta-pixel"
import { trackGoogleAdsConversion } from "@/components/analytics/google-analytics"
import { getStoredUTMParams } from "./utm-tracking"

export function trackGA4Event(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", eventName, params)
  }
}

export function trackEvent(eventName: string, params?: Record<string, unknown>): void {
  trackGA4Event(eventName, params)
  if (process.env.NODE_ENV === "development") {
    console.log("[Analytics]", eventName, params)
  }
}

/**
 * Pre-configured analytics events for OverTaxed
 */
export const analytics = {
  signUp: (method: "email" | "google", utmParams?: Record<string, string>) => {
    const utm = utmParams ?? getStoredUTMParams() ?? {}
    trackEvent("sign_up", { method, ...utm })
    trackMetaEvent("Lead", { content_name: "signup", method })
  },

  login: (method: "email" | "google") => {
    trackEvent("login", { method })
  },

  pageView: (pagePath: string, pageTitle?: string) => {
    trackEvent("page_view", { page_path: pagePath, page_title: pageTitle })
  },

  propertyAdded: (pin: string, county?: string) => {
    trackEvent("property_added", { pin, county })
    trackMetaCustomEvent("PropertyAdded", { pin })
  },

  appealStarted: (propertyId: string, taxYear?: string) => {
    trackEvent("appeal_started", { property_id: propertyId, tax_year: taxYear })
    trackMetaCustomEvent("AppealStarted", { property_id: propertyId })
  },

  appealFiled: (appealId: string) => {
    trackEvent("appeal_filed", { appeal_id: appealId })
    trackMetaEvent("CompleteRegistration", { content_name: "appeal_filed" })
  },

  checkoutStarted: (plan: string, value?: number) => {
    trackEvent("begin_checkout", { plan, value })
    trackMetaEvent("InitiateCheckout", { content_name: plan, value })
  },

  subscriptionComplete: (plan: string, value: number, transactionId?: string) => {
    trackEvent("purchase", {
      currency: "USD",
      value,
      items: [{ item_name: plan }],
      transaction_id: transactionId,
    })
    trackMetaEvent("Purchase", { value, currency: "USD", content_name: plan })
  },

  diyPurchase: (value: number, transactionId?: string) => {
    trackEvent("purchase", {
      currency: "USD",
      value,
      items: [{ item_name: "DIY" }],
      transaction_id: transactionId,
    })
    trackMetaEvent("Purchase", { value, currency: "USD", content_name: "DIY" })
  },

  pdfDownload: (appealId: string) => {
    trackEvent("pdf_download", { appeal_id: appealId })
    trackMetaCustomEvent("PDFDownload", { appeal_id: appealId })
  },

  contactFormSubmit: (category?: string) => {
    trackEvent("contact_form_submit", { category })
    trackMetaEvent("Lead", { content_name: "contact" })
  },
}

/**
 * Track Google Ads conversion (call from checkout success, etc.)
 */
export function trackConversion(conversionId: string, conversionLabel: string, value?: number): void {
  trackGoogleAdsConversion(conversionId, conversionLabel, value)
}
