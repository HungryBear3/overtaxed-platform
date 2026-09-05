/**
 * Analytics Event Tracking for OverTaxed
 * GA4, Meta Pixel, and Google Ads
 */

import { trackMetaEvent, trackMetaCustomEvent } from "@/components/analytics/meta-pixel"
import { trackGoogleAdsConversion } from "@/components/analytics/google-analytics"
import { buildSanitizedPageContext, sanitizeGaEventParams } from "./ga4"
import { getStoredUTMParams } from "./utm-tracking"
import {
  deriveFreeCheckOutcomeParams,
  type FreeCheckInputMode,
  type FreeCheckSurface,
} from "./free-check-funnel"

/**
 * Measurement is never load-bearing. The free-check surfaces call these from
 * inside the handler that renders a result and unlocks checkout, so a throwing
 * tag manager, a blocked script, or a hostile `window.gtag` must not become an
 * exception on the path that shows the reader their outcome.
 */
function safely(emit: () => void): void {
  try {
    emit()
  } catch {
    // Analytics failure is not the reader's problem and must not surface as one.
  }
}

export function trackGA4Event(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window !== "undefined" && window.gtag) {
    const pageContext = buildSanitizedPageContext({
      locationHref: window.location.href,
      referrer: document.referrer,
    })
    window.gtag("event", eventName, sanitizeGaEventParams({ ...params, ...pageContext }))
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

  pdfDownload: (appealId: string) => {
    trackEvent("pdf_download", { appeal_id: appealId })
    trackMetaCustomEvent("PDFDownload", { appeal_id: appealId })
  },

  contactFormSubmit: (category?: string) => {
    trackEvent("contact_form_submit", { category })
    trackMetaEvent("Lead", { content_name: "contact" })
  },

  deadlineMapView: (params: {
    officialCount: number
    openCount: number
    closedCount: number
    pendingCount: number
    sourceUpdated: string
  }) => {
    trackEvent("deadline_map_view", params)
  },

  deadlineTownshipSelected: (params: {
    source: "reminder_dropdown" | "township_grid" | "township_table" | "map_dot"
    townshipSlug: string
    townshipName: string
    status: "open" | "closed" | "pending"
  }) => {
    trackEvent("deadline_township_selected", params)
  },

  deadlineReminderSignup: (params: {
    townshipSlug: string
    townshipName: string
    status: "open" | "closed" | "pending"
  }) => {
    trackEvent("deadline_reminder_signup", params)
    trackMetaEvent("Lead", { content_name: "deadline_reminder", township: params.townshipSlug })
  },

  deadlineFreeCheckStart: (params: {
    source: "deadline_bottom_cta"
    hasAddressInput: boolean
  }) => {
    trackEvent("deadline_free_check_start", params)
    trackMetaCustomEvent("DeadlineFreeCheckStart", { source: params.source })
  },

  /**
   * One user-initiated free check. Fired from the submit handler after the
   * surface's own validation passes, so a rejected form contributes no start.
   *
   * Picking a parcel from the ambiguity list is not a second start: it resolves
   * the check the reader already began, and counting it again would report two
   * starts for one intent.
   */
  freeCheckStarted: (params: { surface: FreeCheckSurface; inputMode: FreeCheckInputMode }) => {
    safely(() => {
      trackEvent("free_check_started", {
        surface: params.surface,
        input_mode: params.inputMode,
      })
    })
  },

  /**
   * One authoritative result. `free_check_qualified` is emitted from the same
   * derivation rather than from a separate call, so the two can never disagree
   * about a single result and no call site can emit one without the other.
   */
  freeCheckCompleted: (params: {
    surface: FreeCheckSurface
    outcome: unknown
    windowStatus: unknown
    preview: boolean
  }) => {
    safely(() => {
      const derived = deriveFreeCheckOutcomeParams({
        outcome: params.outcome,
        windowStatus: params.windowStatus,
        preview: params.preview,
      })
      if (!derived) return

      trackEvent("free_check_completed", { surface: params.surface, ...derived })

      if (!derived.qualified) return
      const { qualified: _qualified, ...outcomeParams } = derived
      // Deliberately no stored UTM enrichment.
      //
      // `getStoredUTMParams` JSON-parses the `utm_params` localStorage key and
      // returns it with no key allow-list, no length bound and no content
      // check. Its values arrive as URL query parameters, so a crafted link — or
      // anything else that can write localStorage — chooses them. An address, an
      // email or a PIN carries neither `?` nor `#`, so `sanitizeGaEventParams`
      // has no handle on it and would forward it verbatim.
      //
      // This event states that an identified parcel qualified, which is exactly
      // the signal such a value must not be joined to. Campaign attribution for
      // this funnel belongs to the session's own page_view, which GA4 already
      // records against a sanitized page_location.
      trackEvent("free_check_qualified", {
        surface: params.surface,
        ...outcomeParams,
      })
    })
  },
}

/**
 * Track Google Ads conversion (call from checkout success, etc.)
 */
export function trackConversion(conversionId: string, conversionLabel: string, value?: number): void {
  trackGoogleAdsConversion(conversionId, conversionLabel, value)
}
