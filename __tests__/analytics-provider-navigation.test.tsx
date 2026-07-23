import React from "react"
import { render } from "@testing-library/react"
import { AnalyticsProvider } from "@/components/analytics/analytics-provider"
import { captureUTMParams } from "@/lib/analytics/utm-tracking"

let pathname = "/appeal-deadline/cicero"
let searchParams = new URLSearchParams()

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}))

jest.mock("@/lib/analytics/utm-tracking", () => ({
  captureUTMParams: jest.fn(),
}))

jest.mock("@/lib/analytics/events", () => ({
  trackGA4Event: jest.fn(),
}))

jest.mock("@/components/analytics/meta-pixel", () => ({
  MetaPixel: () => null,
}))

describe("AnalyticsProvider campaign navigation", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pathname = "/appeal-deadline/cicero"
    searchParams = new URLSearchParams()
  })

  it("recaptures attribution when client navigation changes search params", () => {
    const view = render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )
    expect(captureUTMParams).toHaveBeenCalledTimes(1)

    pathname = "/"
    searchParams = new URLSearchParams(
      "utm_campaign=ot_2026_cicero_deadline&utm_content=hero",
    )
    view.rerender(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(captureUTMParams).toHaveBeenCalledTimes(2)
  })
})
