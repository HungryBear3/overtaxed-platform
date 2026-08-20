import React from "react"
import { act, render } from "@testing-library/react"
import { AnalyticsProvider } from "@/components/analytics/analytics-provider"

let pathname = "/initial"
let searchParams = new URLSearchParams()
let productionRuntime = true
let canonicalHost = true
let liveGa = true
const deliveredViews: Array<{ eventName: string; params?: Record<string, unknown> }> = []

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

jest.mock("@/lib/analytics/utm-tracking", () => ({
  captureUTMParams: jest.fn(),
}))

jest.mock("@/lib/analytics/events", () => ({
  trackGA4Event: (eventName: string, params?: Record<string, unknown>) => {
    if (window.gtag) deliveredViews.push({ eventName, params })
  },
}))

jest.mock("@/components/analytics/meta-pixel", () => ({
  MetaPixel: () => null,
}))

jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientProductionMarketingRuntime: () => productionRuntime,
}))

jest.mock("@/lib/analytics/ga4", () => ({
  GA_READY_EVENT_NAME: "ot:ga-ready",
  buildSanitizedPageContext: jest.fn(() => ({
    page_location: "https://www.overtaxed-il.com/current",
    page_referrer: "https://www.overtaxed-il.com/referrer",
  })),
  isCanonicalGaHost: jest.fn(() => canonicalHost),
  isGaReadyOnWindow: jest.fn(() => Boolean(window.__OT_GA_READY__ || window.gtag)),
  sanitizeGaEventParams: jest.fn((params: Record<string, unknown>) => params),
  shouldEnableLiveGa: jest.fn(() => liveGa),
}))

declare global {
  interface Window {
    __OT_GA_READY__?: boolean
    gtag?: (...args: unknown[]) => void
  }
}

describe("AnalyticsProvider gtag readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    deliveredViews.length = 0
    pathname = "/initial"
    searchParams = new URLSearchParams()
    productionRuntime = true
    canonicalHost = true
    liveGa = true
    document.title = "Initial Title"
    delete window.__OT_GA_READY__
    delete window.gtag
  })

  it("fires the initial page_view once when the provider mounts before gtag is ready", () => {
    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(0)

    window.gtag = jest.fn()
    act(() => {
      window.dispatchEvent(new CustomEvent("ot:ga-ready"))
    })

    expect(deliveredViews).toHaveLength(1)
    expect(deliveredViews[0]).toEqual({
      eventName: "page_view",
      params: expect.objectContaining({
      page_path: "/initial",
      page_title: "Initial Title",
      page_location: "https://www.overtaxed-il.com/current",
      page_referrer: "https://www.overtaxed-il.com/referrer",
      }),
    })
  })

  it("fires the initial page_view once when gtag is already ready before the provider mounts", () => {
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(1)
    expect(deliveredViews[0]).toEqual({
      eventName: "page_view",
      params: expect.objectContaining({
        page_path: "/initial",
      }),
    })
  })

  it("does not duplicate the initial page_view when the ready event arrives after an already-ready mount", () => {
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    act(() => {
      window.dispatchEvent(new CustomEvent("ot:ga-ready"))
    })

    expect(deliveredViews).toHaveLength(1)
  })

  it("continues to fire exactly once per route change after the initial ready page_view", () => {
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    const view = render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(1)

    pathname = "/appeal-deadline/cicero"
    searchParams = new URLSearchParams("utm_campaign=ignored")
    document.title = "Cicero Deadline"
    view.rerender(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(2)
    expect(deliveredViews[1]).toEqual({
      eventName: "page_view",
      params: expect.objectContaining({
        page_path: "/appeal-deadline/cicero",
        page_title: "Cicero Deadline",
      }),
    })
  })

  it("does not emit another page_view for a query-only navigation", () => {
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    const view = render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )
    expect(deliveredViews).toHaveLength(1)

    searchParams = new URLSearchParams("utm_campaign=changed&email=hidden@example.com")
    view.rerender(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(1)
  })

  it("refuses page_view tracking in preview mode", () => {
    productionRuntime = false
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(0)
  })

  it("refuses page_view tracking on a noncanonical host", () => {
    canonicalHost = false
    window.__OT_GA_READY__ = true
    window.gtag = jest.fn()

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(deliveredViews).toHaveLength(0)
  })
})
