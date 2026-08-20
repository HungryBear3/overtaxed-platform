/**
 * @jest-environment jsdom
 *
 * Hostile `_v2` cache regression: a partial outcome must not be treated as
 * authority to render figures or a legacy appeal argument.
 */
import React from "react"
import { render, screen, waitFor } from "@testing-library/react"

jest.mock("@/components/check/FreeCheckForm", () => ({
  FreeCheckForm: () => <div data-testid="free-check-form" />,
}))

import { FreeCheckFormWrapper } from "@/components/check/FreeCheckFormWrapper"
import { CC_05 } from "@/lib/copy/canonical"

const LEGACY_ARGUMENT =
  "This property is over-assessed, resulting in an estimated overpayment of $1,420/year."

const HOSTILE_PARTIAL_V2 = {
  success: true,
  subject: {
    pin: "10-25-107-045-0000",
    address: "123 Main St",
    city: "Evanston",
    zipCode: "60201",
    township: "Evanston",
    neighborhoodCode: "70",
    taxYear: 2026,
    assessedTotalValue: 42500,
    marketValue: 425000,
  },
  compCount: 3,
  comps: [],
  avgComparableAssessedValue: 35100,
  equityRatio: 12.1,
  targetEquityRatio: 10,
  avgCompEquityRatio: 9.8,
  assessmentGap: 7400,
  potentialOverpaymentPerYear: 1420,
  potentialOverpayment3Year: 4260,
  appealArgumentText: LEGACY_ARGUMENT,
  appealWindowStatus: null,
  propertyCharacteristics: null,
  source: "Cook County Open Data",
  // Deliberately incomplete: no code, headline, allowCheckout, or reason.
  outcome: { showFigures: true },
}

describe("hostile partial freeCheckResult_v2 cache", () => {
  beforeEach(() => sessionStorage.clear())

  it("rejects the partial payload instead of restoring it", async () => {
    sessionStorage.setItem("freeCheckResult_v2", JSON.stringify(HOSTILE_PARTIAL_V2))
    const { container } = render(<FreeCheckFormWrapper />)

    await waitFor(() => expect(screen.getByTestId("free-check-form")).toBeTruthy())
    expect(container.textContent).not.toContain(CC_05)
    expect(container.textContent).not.toContain(LEGACY_ARGUMENT)
    expect(container.querySelector("textarea")).toBeNull()
  })
})
