/**
 * @jest-environment jsdom
 *
 * Browser capture of the immutable first touch and the last non-direct touch.
 *
 * Each `landInNewDocument` call loads a fresh copy of the store module, which
 * is what a full page load is: a new document, a new module instance, and the
 * same localStorage. A client-side navigation is the same module instance.
 */
import { render } from "@testing-library/react"

import { UtmFirstTouchCapture } from "@/components/analytics/utm-first-touch"

type Store = typeof import("@/lib/attribution/touch-store")

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000

const CAMPAIGN_URL =
  "/hoa?utm_source=property_manager&utm_medium=email&utm_campaign=hoa_resident_resource_20260723"
const CAMPAIGN_TOUCH = {
  source: "property_manager",
  medium: "email",
  campaign: "hoa_resident_resource_20260723",
  landing: "/hoa",
  at: NOW,
}

function freshStore(): Store {
  let store!: Store
  jest.isolateModules(() => {
    store = require("@/lib/attribution/touch-store") as Store
  })
  return store
}

function setReferrer(referrer: string) {
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer })
}

function landInNewDocument(url: string, referrer = ""): Store {
  window.history.replaceState({}, "", url)
  setReferrer(referrer)
  const store = freshStore()
  store.recordLandingTouch()
  return store
}

function storageDump(): string {
  const entries: Record<string, string | null> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)!
    entries[key] = localStorage.getItem(key)
  }
  return JSON.stringify(entries)
}

let nowSpy: jest.SpyInstance

beforeEach(() => {
  localStorage.clear()
  jest.restoreAllMocks()
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW)
  window.history.replaceState({}, "", "/")
  setReferrer("")
})

afterEach(() => {
  nowSpy.mockRestore()
})

describe("first touch and last non-direct touch", () => {
  it("records a campaign landing as both the first touch and the last non-direct touch", () => {
    const store = landInNewDocument(CAMPAIGN_URL, "https://mail.example.net/")

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: CAMPAIGN_TOUCH, last: CAMPAIGN_TOUCH },
    })
  })

  it("keeps the first touch and moves only the last non-direct touch on a later campaign landing", () => {
    landInNewDocument(CAMPAIGN_URL)
    nowSpy.mockReturnValue(NOW + DAY)
    const store = landInNewDocument(
      "/appeal-deadline/cicero?utm_source=facebook&utm_medium=paid_social&utm_campaign=ot_2026_cicero_deadline&utm_content=v1_video",
      "https://l.facebook.com/",
    )

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: {
        first: CAMPAIGN_TOUCH,
        last: {
          source: "facebook",
          medium: "paid_social",
          campaign: "ot_2026_cicero_deadline",
          content: "v1_video",
          landing: "/appeal-deadline/[slug]",
          at: NOW + DAY,
        },
      },
    })
  })

  it("changes neither touch on a later direct landing", () => {
    landInNewDocument(CAMPAIGN_URL)
    nowSpy.mockReturnValue(NOW + DAY)
    const store = landInNewDocument("/pricing")

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: CAMPAIGN_TOUCH, last: CAMPAIGN_TOUCH },
    })
  })

  it("records a direct first landing, and a later campaign landing becomes the last non-direct touch without replacing it", () => {
    landInNewDocument("/")
    nowSpy.mockReturnValue(NOW + DAY)
    const store = landInNewDocument(CAMPAIGN_URL)

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: {
        first: { landing: "/", at: NOW },
        last: { ...CAMPAIGN_TOUCH, at: NOW + DAY },
      },
    })
  })

  it.each([
    ["the same origin", "http://localhost/hoa"],
    ["the canonical apex host", "https://overtaxed-il.com/hoa"],
    ["the canonical www host", "https://www.overtaxed-il.com/hoa"],
  ])("does not treat an internal link from %s that re-tags UTMs as a touch", (_label, referrer) => {
    landInNewDocument(CAMPAIGN_URL)
    nowSpy.mockReturnValue(NOW + DAY)
    const store = landInNewDocument(
      "/check?utm_source=hoa&utm_medium=internal&utm_campaign=hoa_resident_notice_2026&utm_content=footer_check_link",
      referrer,
    )

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: CAMPAIGN_TOUCH, last: CAMPAIGN_TOUCH },
    })
  })

  it("records at most one landing per document", () => {
    const store = landInNewDocument(CAMPAIGN_URL)
    window.history.replaceState({}, "", "/check?utm_source=township_deadline_page&utm_medium=organic&utm_campaign=ot_2026_cicero_deadline")
    nowSpy.mockReturnValue(NOW + 1000)
    store.recordLandingTouch()

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: CAMPAIGN_TOUCH, last: CAMPAIGN_TOUCH },
    })
  })

  it("is recorded by the root-layout capture component on mount", () => {
    window.history.replaceState({}, "", CAMPAIGN_URL)
    render(<UtmFirstTouchCapture />)

    expect(freshStore().getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: CAMPAIGN_TOUCH, last: CAMPAIGN_TOUCH },
    })
  })
})

describe("stored touches are validated before they can suppress a recapture", () => {
  it.each([
    ["unparseable JSON", "not-json"],
    ["an unrecognized key", JSON.stringify({ at: NOW - DAY, email: "owner@example.com" })],
    ["a hostile value", JSON.stringify({ source: "owner@example.com", at: NOW - DAY })],
    ["a non-integer instant", JSON.stringify({ source: "partner", at: "yesterday" })],
    ["a future instant", JSON.stringify({ source: "partner", at: NOW + 60 * DAY })],
    ["an expired instant", JSON.stringify({ source: "partner", at: NOW - 31 * DAY })],
    ["an array", JSON.stringify([{ source: "partner", at: NOW }])],
  ])("replaces a stored first touch holding %s", (_label, stored) => {
    localStorage.setItem("ot_touch_first_v1", stored)
    const store = landInNewDocument(CAMPAIGN_URL)

    expect(store.getCheckoutAttributionForRequest().attribution?.first).toEqual(CAMPAIGN_TOUCH)
    expect(JSON.parse(localStorage.getItem("ot_touch_first_v1")!)).toEqual(CAMPAIGN_TOUCH)
  })

  it("keeps a valid stored first touch", () => {
    const stored = { source: "partner", medium: "referral", at: NOW - 2 * DAY }
    localStorage.setItem("ot_touch_first_v1", JSON.stringify(stored))
    const store = landInNewDocument(CAMPAIGN_URL)

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: { first: stored, last: CAMPAIGN_TOUCH },
    })
  })

  it("promotes a surviving last touch when the first touch has expired, so the first is never newer than the last", () => {
    localStorage.setItem("ot_touch_first_v1", JSON.stringify({ source: "partner", at: NOW - 31 * DAY }))
    localStorage.setItem("ot_touch_last_v1", JSON.stringify({ source: "newsletter", medium: "email", at: NOW - 5 * DAY }))
    const store = landInNewDocument("/pricing")

    expect(store.getCheckoutAttributionForRequest()).toEqual({
      attribution: {
        first: { source: "newsletter", medium: "email", at: NOW - 5 * DAY },
        last: { source: "newsletter", medium: "email", at: NOW - 5 * DAY },
      },
    })
  })

  it("forwards no tampered stored touch to checkout", () => {
    localStorage.setItem("ot_touch_first_v1", JSON.stringify({ source: "owner@example.com", at: NOW }))
    localStorage.setItem("ot_touch_last_v1", JSON.stringify({ campaign: "16-01-216-001-0000", at: NOW }))

    expect(freshStore().getCheckoutAttributionForRequest()).toEqual({})
  })

  it("forwards no stored direct touch as the last non-direct touch", () => {
    localStorage.setItem("ot_touch_last_v1", JSON.stringify({ landing: "/check", at: NOW }))

    expect(freshStore().getCheckoutAttributionForRequest()).toEqual({})
  })
})

describe("nothing outside the contract is persisted", () => {
  it("never persists the raw query, the fragment, a hostile value or an unlisted parameter", () => {
    const store = landInNewDocument(
      "/check?utm_source=owner@example.com&utm_medium=email&utm_campaign=ot_2026_cicero_deadline" +
        "&utm_content=100%20W%20Randolph&utm_term=16-01-216-001-0000&pin=16012160010000&email=owner%40example.com#result",
    )

    expect(store.getCheckoutAttributionForRequest().attribution?.first).toEqual({
      medium: "email",
      campaign: "ot_2026_cicero_deadline",
      landing: "/check",
      at: NOW,
    })
    const dump = storageDump()
    for (const forbidden of [
      "owner@example.com",
      "owner%40example.com",
      "Randolph",
      "16-01-216-001-0000",
      "16012160010000",
      "#result",
      "email=",
      "?",
    ]) {
      expect(dump).not.toContain(forbidden)
    }
  })

  it("stores no landing for an unlisted path", () => {
    const store = landInNewDocument("/clients/jane-doe-123-main-st?utm_source=partner")

    expect(store.getCheckoutAttributionForRequest().attribution?.first).toEqual({ source: "partner", at: NOW })
    expect(storageDump()).not.toContain("jane-doe")
  })

  it("treats a repeated UTM key as ambiguous", () => {
    const store = landInNewDocument("/check?utm_source=partner_a&utm_source=partner_b&utm_medium=email")

    expect(store.getCheckoutAttributionForRequest().attribution?.first).toEqual({
      medium: "email",
      landing: "/check",
      at: NOW,
    })
  })

  it("survives unavailable storage without throwing", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied")
    })
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied")
    })

    let store!: Store
    expect(() => {
      store = landInNewDocument(CAMPAIGN_URL)
    }).not.toThrow()
    expect(store.getCheckoutAttributionForRequest()).toEqual({})
  })
})
