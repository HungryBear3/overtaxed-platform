/**
 * @jest-environment jsdom
 *
 * The begin_checkout vendor boundary accepts a closed set of properties: a plan
 * drawn from the checkout tier codes and a bounded positive value, plus the
 * explicit empty page context that stops gtag falling back to the browser's
 * URL or referrer. Anything else a caller passes never reaches `gtag`.
 */
import { analytics } from "@/lib/analytics/events"

let gtag: jest.Mock

beforeEach(() => {
  gtag = jest.fn()
  window.gtag = gtag
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

function beginCheckoutParams(): Record<string, unknown> {
  const calls = gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === "begin_checkout")
  expect(calls).toHaveLength(1)
  return calls[0][2] as Record<string, unknown>
}

describe("begin_checkout closed property allowlist", () => {
  it("forwards a known tier code and a bounded value with explicit empty page context", () => {
    analytics.checkoutStarted("T2", 69)

    expect(beginCheckoutParams()).toEqual({ plan: "T2", value: 69, page_location: "", page_referrer: "" })
  })

  it.each([
    ["an email as the plan", "owner@example.com"],
    ["a street address as the plan", "100 W Randolph St"],
    ["an unknown plan code", "T9"],
  ])("drops %s but still records the checkout start", (_label, plan) => {
    analytics.checkoutStarted(plan, 69)

    expect(beginCheckoutParams()).toEqual({ value: 69, page_location: "", page_referrer: "" })
  })

  it.each([
    ["NaN", Number.NaN],
    ["a negative value", -5],
    ["zero", 0],
    ["an implausible value", 1_000_000],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("drops %s as the value", (_label, value) => {
    analytics.checkoutStarted("T2", value)

    expect(beginCheckoutParams()).toEqual({ plan: "T2", page_location: "", page_referrer: "" })
  })
})
