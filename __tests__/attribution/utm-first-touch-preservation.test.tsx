/**
 * @jest-environment jsdom
 *
 * Regression coverage for the property-manager HOA pilot campaign URL:
 *   https://www.overtaxed-il.com/hoa?utm_source=property_manager&utm_medium=email&utm_campaign=hoa_resident_resource_20260723
 *
 * These prove the campaign's utm_source/utm_medium/utm_campaign are captured on
 * the landing visit and survive the funnel — specifically that /hoa's own
 * outbound links, which re-tag onward traffic as utm_source=hoa, do NOT clobber
 * the original campaign source once first-touch capture is in place.
 */
import { render } from "@testing-library/react"

import {
  captureFirstTouchUTM,
  captureUTMParams,
  getStoredUTMParams,
  getAttributionData,
  clearUTMParams,
} from "@/lib/analytics/utm-tracking"
import { UtmFirstTouchCapture } from "@/components/analytics/utm-first-touch"

const CAMPAIGN_URL =
  "https://www.overtaxed-il.com/hoa?utm_source=property_manager&utm_medium=email&utm_campaign=hoa_resident_resource_20260723"

// The internal re-tag /hoa applies to its own /check and /deadlines links.
const INTERNAL_HOA_CHECK_URL =
  "https://www.overtaxed-il.com/check?utm_source=hoa&utm_medium=internal&utm_campaign=hoa_resident_notice_2026&utm_content=footer_check_link"

function setUrl(url: string) {
  // Same-origin navigation via history so jsdom updates window.location.search
  // (jsdom's window.location itself is not redefinable).
  const u = new URL(url)
  window.history.replaceState({}, "", u.pathname + u.search)
}

beforeEach(() => {
  localStorage.clear()
  clearUTMParams()
})

describe("campaign UTM capture", () => {
  it("captures the exact pilot campaign source/medium/campaign on landing", () => {
    setUrl(CAMPAIGN_URL)
    captureFirstTouchUTM()

    expect(getStoredUTMParams()).toMatchObject({
      utm_source: "property_manager",
      utm_medium: "email",
      utm_campaign: "hoa_resident_resource_20260723",
    })
    expect(getAttributionData()).toMatchObject({
      utmSource: "property_manager",
      utmMedium: "email",
      utmCampaign: "hoa_resident_resource_20260723",
    })
  })

  it("stores nothing when the URL carries no UTM parameters", () => {
    setUrl("https://www.overtaxed-il.com/check")
    expect(captureFirstTouchUTM()).toEqual({})
    expect(getStoredUTMParams()).toBeNull()
  })
})

describe("first-touch preservation through the funnel", () => {
  it("keeps the campaign source when a later internal /hoa link re-tags traffic", () => {
    // 1. Land on /hoa with the campaign UTM.
    setUrl(CAMPAIGN_URL)
    captureFirstTouchUTM()

    // 2. Click a /hoa on-page link -> /check?utm_source=hoa... and capture again.
    setUrl(INTERNAL_HOA_CHECK_URL)
    captureFirstTouchUTM()

    // Attribution downstream is STILL the original campaign, not "hoa".
    expect(getAttributionData()).toMatchObject({
      utmSource: "property_manager",
      utmMedium: "email",
      utmCampaign: "hoa_resident_resource_20260723",
    })
  })

  it("regression guard: plain captureUTMParams() WOULD clobber first-touch (why the new fn exists)", () => {
    setUrl(CAMPAIGN_URL)
    captureUTMParams()
    setUrl(INTERNAL_HOA_CHECK_URL)
    captureUTMParams() // overwrites — this is the behaviour first-touch avoids

    expect(getStoredUTMParams()).toMatchObject({ utm_source: "hoa" })
  })
})

describe("UtmFirstTouchCapture component", () => {
  it("captures on mount from the landing URL", () => {
    setUrl(CAMPAIGN_URL)
    render(<UtmFirstTouchCapture />)

    expect(getStoredUTMParams()).toMatchObject({
      utm_source: "property_manager",
      utm_medium: "email",
      utm_campaign: "hoa_resident_resource_20260723",
    })
  })

  it("renders nothing", () => {
    setUrl(CAMPAIGN_URL)
    const { container } = render(<UtmFirstTouchCapture />)
    expect(container.firstChild).toBeNull()
  })
})
