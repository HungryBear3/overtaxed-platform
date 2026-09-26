/** @jest-environment jsdom */

import { analytics } from "@/lib/analytics/events"

describe("checkout analytics transport", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("cannot block the Stripe redirect when a browser analytics transport throws", () => {
    window.gtag = jest.fn(() => {
      throw new Error("analytics transport unavailable")
    })

    expect(() => analytics.checkoutStarted("T2", 69)).not.toThrow()
  })

  it("serializes begin_checkout without hostile browser URL or referrer context", () => {
    window.history.replaceState(
      {},
      "",
      "/clients/jane-doe-123-main-st/parcel-1234567890?email=jane@example.test#secret",
    )
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://partner.example.test/clients/jane-doe-123-main-st/parcel-1234567890",
    })
    window.gtag = jest.fn()

    analytics.checkoutStarted("T2", 69)

    expect(window.gtag).toHaveBeenCalledWith("event", "begin_checkout", {
      plan: "T2",
      value: 69,
      page_location: "",
      page_referrer: "",
    })
    const serialized = JSON.stringify((window.gtag as jest.Mock).mock.calls)
    expect(serialized).not.toMatch(/jane-doe|123-main-st|1234567890|jane@example\.test|secret/)
  })
})
