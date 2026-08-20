import React from "react"
import { render } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { CheckoutSuccessTracker } from "@/components/analytics/checkout-success-tracker"

let searchParams = new URLSearchParams("checkout=success&session_id=cs_test_123&amount=14900")

jest.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}))

const subscriptionCompleteMock = jest.fn()
const diyPurchaseMock = jest.fn()

jest.mock("@/lib/analytics/events", () => ({
  analytics: {
    subscriptionComplete: (...args: unknown[]) => subscriptionCompleteMock(...args),
    diyPurchase: (...args: unknown[]) => diyPurchaseMock(...args),
  },
}))

describe("CheckoutSuccessTracker", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    searchParams = new URLSearchParams("checkout=success&session_id=cs_test_123&amount=14900")
  })

  it("does not emit browser purchase events from return query params alone", () => {
    render(<CheckoutSuccessTracker />)
    expect(subscriptionCompleteMock).not.toHaveBeenCalled()
    expect(diyPurchaseMock).not.toHaveBeenCalled()
  })

  it("leaves no client-side purchase trigger patterns in source", () => {
    const repoRoot = resolve(__dirname, "../..")
    const files = [
      "components/analytics/checkout-success-tracker.tsx",
      "lib/analytics/events.ts",
      "components/account/PendingInvoicesSection.tsx",
      "components/ot-design/CheckoutPage.tsx",
    ]
    const combined = files
      .map((file) => readFileSync(resolve(repoRoot, file), "utf8"))
      .join("\n")

    expect(combined).not.toMatch(/gtag\(\s*["']event["']\s*,\s*["']purchase["']/)
    expect(combined).not.toMatch(/trackEvent\(\s*["']purchase["']/)
    expect(combined).not.toMatch(/subscriptionComplete/)
    expect(combined).not.toMatch(/diyPurchase/)
  })
})
