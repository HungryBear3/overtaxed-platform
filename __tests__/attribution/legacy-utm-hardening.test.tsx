/**
 * @jest-environment jsdom
 *
 * The legacy `utm_params` localStorage key predates the touch contract. It is
 * still written by the route tracker on navigation and read by the sign-up
 * enrichment, so it has to obey the same value contract: nothing it stores or
 * returns may be a value the touch contract would refuse, and a corrupted copy
 * must neither live forever nor block a fresh capture.
 */
import {
  captureFirstTouchUTM,
  captureUTMParams,
  getAttributionData,
  getStoredUTMParams,
} from "@/lib/analytics/utm-tracking"
import { analytics } from "@/lib/analytics/events"

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

const CAMPAIGN_URL =
  "/hoa?utm_source=property_manager&utm_medium=email&utm_campaign=hoa_resident_resource_20260723"

function storeLegacy(params: unknown, timestamp: string = String(NOW)) {
  localStorage.setItem("utm_params", typeof params === "string" ? params : JSON.stringify(params))
  localStorage.setItem("utm_timestamp", timestamp)
}

let nowSpy: jest.SpyInstance

beforeEach(() => {
  localStorage.clear()
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW)
  window.history.replaceState({}, "", "/")
})

afterEach(() => {
  nowSpy.mockRestore()
  delete (window as { gtag?: unknown }).gtag
})

describe("legacy utm_params reads obey the touch value contract", () => {
  it("returns only recognized keys whose values pass the contract", () => {
    storeLegacy({
      utm_source: "owner@example.com",
      utm_medium: "email",
      utm_campaign: "16-01-216-001-0000",
      utm_term: "Jane Q Homeowner",
      email: "owner@example.com",
    })

    expect(getStoredUTMParams()).toEqual({ utm_medium: "email" })
    expect(getAttributionData()).toEqual({ utmMedium: "email" })
  })

  it("returns nothing when no stored value passes the contract", () => {
    storeLegacy({ utm_source: "owner@example.com", evil: "x" })

    expect(getStoredUTMParams()).toBeNull()
  })

  it.each([
    ["an unparseable timestamp", "yesterday"],
    ["a future timestamp", String(NOW + 400 * DAY)],
    ["an expired timestamp", String(NOW - 31 * DAY)],
  ])("does not keep a stored value alive with %s", (_label, timestamp) => {
    storeLegacy({ utm_source: "property_manager" }, timestamp)

    expect(getStoredUTMParams()).toBeNull()
  })
})

describe("legacy capture", () => {
  it("does not let a stored object with no acceptable value suppress first-touch capture", () => {
    storeLegacy({ evil: "x" })
    window.history.replaceState({}, "", CAMPAIGN_URL)

    captureFirstTouchUTM()

    expect(getStoredUTMParams()).toEqual({
      utm_source: "property_manager",
      utm_medium: "email",
      utm_campaign: "hoa_resident_resource_20260723",
    })
  })

  it("never persists a value the contract refuses", () => {
    window.history.replaceState(
      {},
      "",
      "/check?utm_source=owner@example.com&utm_medium=email&utm_term=16-01-216-001-0000&pin=16012160010000",
    )

    expect(captureUTMParams()).toEqual({ utm_medium: "email" })
    const stored = localStorage.getItem("utm_params") ?? ""
    expect(JSON.parse(stored)).toEqual({ utm_medium: "email" })
    expect(stored).not.toContain("owner@example.com")
    expect(stored).not.toContain("16-01-216-001-0000")
    expect(stored).not.toContain("16012160010000")
  })
})

describe("sign-up enrichment", () => {
  it("forwards only contract-valid stored values to the vendor boundary", () => {
    storeLegacy({
      utm_source: "newsletter",
      utm_medium: "100 W Randolph St Apt 4B",
      utm_term: "owner@example.com",
    })
    const gtag = jest.fn()
    window.gtag = gtag

    analytics.signUp("email")

    const serialized = JSON.stringify(gtag.mock.calls)
    expect(serialized).toContain("newsletter")
    expect(serialized).not.toContain("Randolph")
    expect(serialized).not.toContain("owner@example.com")
  })
})
