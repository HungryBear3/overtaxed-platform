import React from "react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"

jest.mock("next/script", () => ({
  __esModule: true,
  default: ({ src, id, children }: { src?: string; id?: string; children?: React.ReactNode }) => (
    <div data-testid={id ?? "script"} data-src={src}>
      {children}
    </div>
  ),
}))

const metaPixelMock = jest.fn((_props?: unknown) => <div data-testid="meta-pixel" />)

jest.mock("@/components/analytics/meta-pixel", () => ({
  MetaPixel: (props: unknown) => metaPixelMock(props),
}))

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock("@/lib/analytics/utm-tracking", () => ({
  captureUTMParams: jest.fn(),
}))

jest.mock("@/lib/analytics/events", () => ({
  trackGA4Event: jest.fn(),
}))

import { GoogleAnalytics } from "@/components/analytics/google-analytics"
import { AnalyticsProvider } from "@/components/analytics/analytics-provider"

describe("client analytics host gate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not let googleAdsId bypass the host gate when mounted directly on a noncanonical host", () => {
    render(<GoogleAnalytics measurementId="G-TEST123" googleAdsId="AW-123456" />)

    expect(screen.queryByTestId("gtag-init")).toBeNull()
    expect(screen.queryByTestId("script")).toBeNull()
  })

  it("declares every hook before the host-gated early return", () => {
    const source = readFileSync(
      resolve(__dirname, "../../components/analytics/google-analytics.tsx"),
      "utf8",
    )
    const readinessHook = source.indexOf("useEffect(() => {", source.indexOf("const primaryId"))
    const gatedReturn = source.indexOf("if (!liveMarketing ||")

    expect(readinessHook).toBeGreaterThan(-1)
    expect(readinessHook).toBeLessThan(gatedReturn)
  })

  it("does not mount Meta Pixel through AnalyticsProvider on a noncanonical host", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "123456789"

    render(
      <AnalyticsProvider>
        <div>child</div>
      </AnalyticsProvider>,
    )

    expect(screen.queryByTestId("meta-pixel")).toBeNull()
    expect(metaPixelMock).not.toHaveBeenCalled()
  })
})
