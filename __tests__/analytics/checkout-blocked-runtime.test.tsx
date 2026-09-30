/**
 * @jest-environment jsdom
 *
 * Runtime proof for checkout_blocked from the real CheckoutPage.
 *
 * One checkout intent ends in exactly one of begin_checkout and
 * checkout_blocked, so their sum is the number of checkout attempts. The
 * blocked reason is a closed enum looked up from the server's code; nothing
 * the server said and nothing the buyer typed reaches the payload. Only the
 * router, the preview gate and the network are doubles.
 */
import React, { StrictMode } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import CheckoutPage from "@/components/ot-design/CheckoutPage"
import { analytics } from "@/lib/analytics/events"
import { CHECKOUT_BLOCKED_REASONS, checkoutBlockedReasonForResponse } from "@/lib/analytics/checkout-funnel"
import { validateBrowserFunnelEvent } from "@/lib/analytics/funnel-contract"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
jest.mock("@/lib/marketing/preview-gate-client", () => ({
  isClientPreviewStubMode: () => false,
  isClientProductionMarketingRuntime: () => true,
}))

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_redacted#fidkdWxOYHwnPyd1blpxYHZxWjA0"
const HOSTILE = "PIN 16-01-216-001-0000 JANE DOE 123 Main St jane@example.test cs_live_a1B2c3D4e5F6"
const TYPED = ["Buyer", "Example", "buyer@example.com", "Henderson", "60618"]

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

function response(status: number, body: unknown): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function fillDetails() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Buyer" } })
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Example" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } })
  fireEvent.change(screen.getByLabelText("Property address"), { target: { value: "2834 W Henderson St, Chicago IL 60618" } })
}

let gtag: jest.Mock

function calls(name: string) {
  return gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === name)
}

function outcomes() {
  return gtag.mock.calls.filter((call) => call[0] === "event").map((call) => call[1])
}

function expectNothingTypedOrHostile() {
  const serialized = JSON.stringify(gtag.mock.calls)
  for (const forbidden of [...TYPED, "jane", "JANE", "16-01-216", "Main St", "cs_live", "cs_test", "stripe", "?", "#"]) {
    expect(serialized).not.toContain(forbidden)
  }
}

async function submitOnce(fetchImpl: () => Promise<FakeResponse>) {
  global.fetch = jest.fn(fetchImpl) as jest.Mock
  render(
    <StrictMode>
      <CheckoutPage />
    </StrictMode>,
  )
  fillDetails()
  fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  Object.defineProperty(document, "cookie", { configurable: true, get: () => "" })
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value: "https://partner.example.test/clients/jane-doe-123-main-st?email=jane@example.test",
  })
  window.history.replaceState({}, "", "/checkout?email=jane@example.test&utm_content=16-01-216-001-0000#secret")
  gtag = jest.fn()
  window.gtag = gtag
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
})

describe("checkout_blocked from the real checkout page", () => {
  it.each([
    ["T2_ACKNOWLEDGMENT_REQUIRED", 409, "acknowledgment_required", /ordering an assessment analysis now/i],
    ["ADDRESS_AMBIGUOUS", 409, "address_ambiguous", /more than one possible match/i],
    ["T3_WINDOW_BLOCKED", 409, "window_blocked", /can't offer a full filing/i],
    ["NOTICE_REVIEW_REQUIRED", 422, "notice_review_required", /verify your reassessment notice/i],
  ])("a %s gate emits one checkout_blocked and still renders the gate", async (code, status, reason, gateText) => {
    await submitOnce(async () =>
      response(status, { code, error: HOSTILE, acknowledgmentToken: "t.k", candidates: [], window: { township: HOSTILE, status: "unknown" } }),
    )

    await waitFor(() => expect(screen.getAllByText(gateText).length).toBeGreaterThan(0))
    expect(outcomes()).toEqual(["checkout_blocked"])
    expect(calls("checkout_blocked")).toEqual([
      ["event", "checkout_blocked", { plan: "T2", blocked_reason: reason, page_location: "", page_referrer: "" }],
    ])
    expect(push).not.toHaveBeenCalled()
    expectNothingTypedOrHostile()
  })

  it.each([
    ["a known non-gate code", async () => response(400, { code: "PROPERTY_NOT_FOUND", error: HOSTILE }), "property_not_found"],
    ["a rate limit", async () => response(429, { code: "CHECKOUT_RATE_LIMITED", error: HOSTILE }), "rate_limited"],
    ["a hostile unknown code", async () => response(400, { code: HOSTILE, error: HOSTILE }), "unknown"],
    ["a prototype-named code", async () => response(400, { code: "__proto__", error: HOSTILE }), "unknown"],
    ["an unreadable 503 body", async () => ({ ok: false, status: 503, json: async () => { throw new Error(HOSTILE) } }), "unavailable"],
    ["a 5xx with an unknown code", async () => response(502, { code: "UPSTREAM", error: HOSTILE }), "unavailable"],
    ["a network rejection", async () => { throw new Error(HOSTILE) }, "network_error"],
    ["an unreadable success body", async () => ({ ok: true, status: 200, json: async () => { throw new Error(HOSTILE) } }), "unknown"],
    ["a success with no URL", async () => response(200, { error: HOSTILE }), "unknown"],
    ["a null error body", async () => response(400, null), "unknown"],
  ])("%s emits exactly one enum checkout_blocked and no begin_checkout", async (_label, fetchImpl, reason) => {
    await submitOnce(fetchImpl as () => Promise<FakeResponse>)

    await waitFor(() => expect(calls("checkout_blocked")).toHaveLength(1))
    expect(outcomes()).toEqual(["checkout_blocked"])
    expect(calls("checkout_blocked")[0][2]).toEqual({
      plan: "T2",
      blocked_reason: reason,
      page_location: "",
      page_referrer: "",
    })
    expect(push).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /continue to payment/i }) as HTMLButtonElement).disabled).toBe(false),
    )
    expectNothingTypedOrHostile()
  })

  it("a successful intent emits begin_checkout only", async () => {
    await submitOnce(async () => response(200, { url: STRIPE_URL }))

    await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))
    expect(outcomes()).toEqual(["begin_checkout"])
    expectNothingTypedOrHostile()
  })

  it("a hand-off that throws after begin_checkout does not add a checkout_blocked", async () => {
    push.mockImplementationOnce(() => {
      throw new Error(HOSTILE)
    })
    await submitOnce(async () => response(200, { url: STRIPE_URL }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /continue to payment/i }) as HTMLButtonElement).disabled).toBe(false),
    )
    expect(outcomes()).toEqual(["begin_checkout"])
  })

  it("a throwing analytics transport does not hide a gate", async () => {
    gtag.mockImplementation(() => {
      throw new Error("transport down")
    })
    await submitOnce(async () => response(409, { code: "T2_ACKNOWLEDGMENT_REQUIRED", acknowledgmentToken: "t.k" }))
    await waitFor(() => expect(screen.getAllByText(/ordering an assessment analysis now/i).length).toBeGreaterThan(0))
  })

  it("an analytics module that throws on the call still lets the gate render and the buyer continue", async () => {
    const blocked = jest.spyOn(analytics, "checkoutBlocked").mockImplementation(() => {
      throw new Error("broken")
    })
    const started = jest.spyOn(analytics, "checkoutStarted").mockImplementation(() => {
      throw new Error("broken")
    })
    try {
      await submitOnce(async () => response(409, { code: "ADDRESS_AMBIGUOUS", candidates: [] }))
      await waitFor(() => expect(screen.getByText(/more than one possible match/i)).toBeTruthy())

      global.fetch = jest.fn(async () => response(200, { url: STRIPE_URL })) as jest.Mock
      fireEvent.change(screen.getByLabelText("Property address"), { target: { value: "1 Other St" } })
      fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }))
      await waitFor(() => expect(push).toHaveBeenCalledWith(STRIPE_URL))
    } finally {
      blocked.mockRestore()
      started.mockRestore()
    }
  })
})

describe("the checkout_blocked emitter and contract", () => {
  it("sends nothing for a reason or plan outside the closed sets", () => {
    for (const [plan, reason] of [
      ["T2", HOSTILE],
      ["T2", "constructor"],
      ["T2", ""],
      [HOSTILE, "unknown"],
      ["T9", "unknown"],
      ["__proto__", "unknown"],
    ]) {
      analytics.checkoutBlocked(plan, reason as never)
    }
    expect(gtag).not.toHaveBeenCalled()
  })

  it("accepts every closed reason and refuses any extra or free-text field", () => {
    for (const reason of CHECKOUT_BLOCKED_REASONS) {
      expect(
        validateBrowserFunnelEvent("checkout_blocked", { plan: "T2", blocked_reason: reason, page_location: "", page_referrer: "" }),
      ).toEqual({ ok: true, grade: "decision" })
    }
    const base = { plan: "T2", blocked_reason: "unknown", page_location: "", page_referrer: "" }
    expect(validateBrowserFunnelEvent("checkout_blocked", { ...base, error: HOSTILE }).ok).toBe(false)
    expect(validateBrowserFunnelEvent("checkout_blocked", { ...base, blocked_reason: HOSTILE }).ok).toBe(false)
    expect(validateBrowserFunnelEvent("checkout_blocked", { ...base, page_location: "https://www.overtaxed-il.com/checkout" }).ok).toBe(false)
    expect(validateBrowserFunnelEvent("checkout_blocked", { blocked_reason: "unknown", page_location: "", page_referrer: "" }).ok).toBe(false)
  })

  it("looks the reason up by own key only and never passes the code through", () => {
    expect(checkoutBlockedReasonForResponse("toString", 400)).toBe("unknown")
    expect(checkoutBlockedReasonForResponse("hasOwnProperty", 400)).toBe("unknown")
    expect(checkoutBlockedReasonForResponse(HOSTILE, 400)).toBe("unknown")
    expect(checkoutBlockedReasonForResponse(undefined, 500)).toBe("unavailable")
    expect(checkoutBlockedReasonForResponse(undefined, 499)).toBe("unknown")
    expect(checkoutBlockedReasonForResponse({ code: "T3_WINDOW_BLOCKED" }, 409)).toBe("unknown")
  })

  it("never lets a browser caller emit purchase or refund", () => {
    for (const name of ["purchase", "refund"]) {
      expect(validateBrowserFunnelEvent(name, { page_location: "", page_referrer: "" })).toEqual({
        ok: false,
        violations: ["SERVER_ONLY_EVENT"],
      })
    }
  })
})
