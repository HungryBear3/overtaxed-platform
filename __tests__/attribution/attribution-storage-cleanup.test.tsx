/**
 * @jest-environment jsdom
 *
 * Expired and tampered attribution records are removed, not just ignored.
 *
 * Phase A refuses to USE a stored touch or legacy UTM record that fails its
 * contract. This carries its non-blocking follow-up: such a record is also
 * deleted from localStorage when it is read, so a hostile value does not sit at
 * rest indefinitely. Removal is compare-and-remove — a value another tab wrote
 * after it was read is left alone.
 */
import { getStoredUTMParams } from "@/lib/analytics/utm-tracking"

type Store = typeof import("@/lib/attribution/touch-store")

const NOW = Date.parse("2026-09-28T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000
const FIRST = "ot_touch_first_v1"
const LAST = "ot_touch_last_v1"

function freshStore(): Store {
  let store!: Store
  jest.isolateModules(() => {
    store = require("@/lib/attribution/touch-store") as Store
  })
  return store
}

let nowSpy: jest.SpyInstance

beforeEach(() => {
  localStorage.clear()
  jest.restoreAllMocks()
  nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW)
  window.history.replaceState({}, "", "/")
  Object.defineProperty(document, "referrer", { configurable: true, value: "" })
})

afterEach(() => {
  nowSpy.mockRestore()
})

describe("stored touches", () => {
  it.each([
    ["an expired touch", JSON.stringify({ source: "partner", at: NOW - 31 * DAY })],
    ["a touch from the future", JSON.stringify({ source: "partner", at: NOW + 60 * DAY })],
    ["an unrecognized key", JSON.stringify({ source: "partner", email: "owner@example.com", at: NOW })],
    ["a hostile value", JSON.stringify({ source: "owner@example.com", at: NOW })],
    ["unparseable JSON", "{not json"],
  ])("removes %s when checkout reads it", (_label, stored) => {
    localStorage.setItem(FIRST, stored)
    localStorage.setItem(LAST, stored)

    expect(freshStore().getCheckoutAttributionForRequest()).toEqual({})
    expect(localStorage.getItem(FIRST)).toBeNull()
    expect(localStorage.getItem(LAST)).toBeNull()
  })

  it("removes a direct touch stored as the last non-direct touch", () => {
    localStorage.setItem(LAST, JSON.stringify({ landing: "/check", at: NOW }))

    freshStore().getCheckoutAttributionForRequest()

    expect(localStorage.getItem(LAST)).toBeNull()
  })

  it("keeps valid touches byte-for-byte", () => {
    const first = JSON.stringify({ source: "partner", medium: "referral", at: NOW - 2 * DAY })
    const last = JSON.stringify({ source: "newsletter", medium: "email", at: NOW - DAY })
    localStorage.setItem(FIRST, first)
    localStorage.setItem(LAST, last)

    freshStore().getCheckoutAttributionForRequest()

    expect(localStorage.getItem(FIRST)).toBe(first)
    expect(localStorage.getItem(LAST)).toBe(last)
  })

  it("replaces an expired first touch on the next landing instead of leaving it behind", () => {
    localStorage.setItem(FIRST, JSON.stringify({ source: "partner", at: NOW - 31 * DAY }))
    window.history.replaceState({}, "", "/pricing")

    freshStore().recordLandingTouch()

    expect(JSON.parse(localStorage.getItem(FIRST)!)).toEqual({ landing: "/pricing", at: NOW })
  })

  it("leaves a value another tab wrote after the invalid one was read", () => {
    const hostile = JSON.stringify({ source: "owner@example.com", at: NOW })
    const replacement = JSON.stringify({ source: "partner", at: NOW })
    localStorage.setItem(FIRST, hostile)
    const realGetItem = Storage.prototype.getItem
    let reads = 0
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (key === FIRST) return ++reads === 1 ? hostile : replacement
      return realGetItem.call(this, key)
    })
    const removeSpy = jest.spyOn(Storage.prototype, "removeItem")

    freshStore().getCheckoutAttributionForRequest()

    expect(removeSpy).not.toHaveBeenCalledWith(FIRST)
  })

  it("survives storage that refuses removal", () => {
    localStorage.setItem(FIRST, "{not json")
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage denied")
    })

    expect(() => freshStore().getCheckoutAttributionForRequest()).not.toThrow()
  })
})

describe("the legacy utm_params record", () => {
  function store(params: string, timestamp: string | null = String(NOW)) {
    localStorage.setItem("utm_params", params)
    if (timestamp !== null) localStorage.setItem("utm_timestamp", timestamp)
  }

  it.each([
    ["unparseable JSON", "{not json"],
    ["no acceptable value", JSON.stringify({ utm_source: "owner@example.com", evil: "x" })],
    ["an array", JSON.stringify(["google"])],
  ])("removes a record holding %s", (_label, params) => {
    store(params)

    expect(getStoredUTMParams()).toBeNull()
    expect(localStorage.getItem("utm_params")).toBeNull()
    expect(localStorage.getItem("utm_timestamp")).toBeNull()
  })

  it("rewrites a partly hostile record to its valid values, keeping its timestamp", () => {
    store(JSON.stringify({ utm_source: "newsletter", utm_term: "Jane Q Homeowner", email: "owner@example.com" }))

    expect(getStoredUTMParams()).toEqual({ utm_source: "newsletter" })
    expect(JSON.parse(localStorage.getItem("utm_params")!)).toEqual({ utm_source: "newsletter" })
    expect(localStorage.getItem("utm_timestamp")).toBe(String(NOW))
  })

  it("removes a half-written record", () => {
    store(JSON.stringify({ utm_source: "newsletter" }), null)
    expect(getStoredUTMParams()).toBeNull()
    expect(localStorage.getItem("utm_params")).toBeNull()

    localStorage.setItem("utm_timestamp", String(NOW))
    expect(getStoredUTMParams()).toBeNull()
    expect(localStorage.getItem("utm_timestamp")).toBeNull()
  })

  it("keeps a valid record byte-for-byte", () => {
    const params = JSON.stringify({ utm_source: "newsletter", utm_medium: "email" })
    store(params)

    expect(getStoredUTMParams()).toEqual({ utm_source: "newsletter", utm_medium: "email" })
    expect(localStorage.getItem("utm_params")).toBe(params)
  })
})
