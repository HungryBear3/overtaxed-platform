/**
 * @jest-environment jsdom
 */
import { analytics } from "@/lib/analytics/events"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

/**
 * Transport-level proof for the free-check funnel. These exercise the real
 * `trackEvent` path down to `window.gtag` — nothing in `lib/analytics` is
 * mocked — so an event that reaches the vendor boundary carrying a name, an
 * address, a PIN or a township fails here rather than in production.
 */
describe("free-check funnel transport", () => {
  let gtag: jest.Mock
  let fbq: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
    window.history.replaceState({}, "", "/check")
    gtag = jest.fn()
    fbq = jest.fn()
    window.gtag = gtag
    ;(window as unknown as { fbq?: unknown }).fbq = fbq
  })

  afterEach(() => {
    delete (window as { gtag?: unknown }).gtag
    delete (window as { fbq?: unknown }).fbq
  })

  function eventsNamed(name: string) {
    return gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === name)
  }

  it("sends exactly one free_check_started carrying only the surface and input mode", () => {
    analytics.freeCheckStarted({ surface: "check_page", inputMode: "pin" })

    const started = eventsNamed("free_check_started")
    expect(started).toHaveLength(1)
    expect(started[0][2]).toMatchObject({ surface: "check_page", input_mode: "pin" })
  })

  it("sends exactly one free_check_completed per authoritative result", () => {
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: canonicalFreeCheckOutcome("not_supportive", "below_evidence_threshold"),
      windowStatus: "open",
      preview: false,
    })

    const completed = eventsNamed("free_check_completed")
    expect(completed).toHaveLength(1)
    expect(completed[0][2]).toMatchObject({
      surface: "check_page",
      outcome_code: "not_supportive",
      outcome_reason: "below_evidence_threshold",
      allow_checkout: false,
      window_status: "open",
      qualified: false,
    })
  })

  it("pairs a supportive result with exactly one free_check_qualified", () => {
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(eventsNamed("free_check_completed")).toHaveLength(1)
    const qualified = eventsNamed("free_check_qualified")
    expect(qualified).toHaveLength(1)
    expect(qualified[0][2]).toMatchObject({
      surface: "home_hero",
      outcome_code: "supportive",
      allow_checkout: true,
      window_status: "open",
    })
  })

  it("sends no free_check_qualified for a non-supportive result", () => {
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: canonicalFreeCheckOutcome("unsupported_property", "outside_cook_county"),
      windowStatus: "unknown",
      preview: false,
    })

    expect(eventsNamed("free_check_completed")).toHaveLength(1)
    expect(eventsNamed("free_check_qualified")).toHaveLength(0)
  })

  it("sends nothing for a response whose outcome the shared matrix rejects", () => {
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: { code: "supportive", allowCheckout: true },
      windowStatus: "open",
      preview: false,
    })

    expect(gtag).not.toHaveBeenCalled()
  })

  it("sends nothing for a preview fixture", () => {
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: true,
    })

    expect(gtag).not.toHaveBeenCalled()
  })

  it("never reaches a second vendor transport", () => {
    analytics.freeCheckStarted({ surface: "home_hero", inputMode: "address" })
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(fbq).not.toHaveBeenCalled()
  })

  it("no longer carries the township name it used to send", () => {
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    const serialized = JSON.stringify(gtag.mock.calls)
    expect(serialized).not.toContain("township")
    for (const call of gtag.mock.calls) {
      expect(call[2]).not.toHaveProperty("township")
      expect(call[2]).not.toHaveProperty("savings_band")
    }
  })

  it("carries no identifying value from a result into the serialized payload", () => {
    window.history.replaceState({}, "", "/check?utm_campaign=ot_2026_stickney_deadline")

    analytics.freeCheckStarted({ surface: "check_page", inputMode: "address" })
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    const serialized = JSON.stringify(gtag.mock.calls)
    for (const forbidden of [
      "Stickney",
      "16-01-216-001-0000",
      "1601216001000",
      "100 W Randolph",
      "owner@example.com",
      "Chicago",
      "60601",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("emits only bounded primitives at the vendor boundary", () => {
    analytics.freeCheckStarted({ surface: "check_page", inputMode: "pin" })
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparables"),
      windowStatus: "closed",
      preview: false,
    })

    for (const call of gtag.mock.calls) {
      for (const [key, value] of Object.entries(call[2] as Record<string, unknown>)) {
        expect(["string", "boolean", "number"]).toContain(typeof value)
        if (key === "page_location" || key === "page_referrer") continue
        if (typeof value === "string") {
          expect(value).not.toContain("?")
          expect(value).not.toContain("#")
        }
      }
    }
  })

  it("keeps page_location and page_referrer at origin+pathname", () => {
    window.history.replaceState({}, "", "/check?pin=16012160010000#result")

    analytics.freeCheckStarted({ surface: "check_page", inputMode: "pin" })

    const params = eventsNamed("free_check_started")[0][2] as Record<string, string>
    expect(params.page_location).toBe("http://localhost/check")
    expect(params.page_location).not.toContain("16012160010000")
  })

  it("does not throw into the caller when the vendor boundary throws", () => {
    window.gtag = jest.fn(() => {
      throw new Error("gtag exploded")
    })

    expect(() => analytics.freeCheckStarted({ surface: "check_page", inputMode: "pin" })).not.toThrow()
    expect(() =>
      analytics.freeCheckCompleted({
        surface: "check_page",
        outcome: canonicalFreeCheckOutcome("supportive", null),
        windowStatus: "open",
        preview: false,
      }),
    ).not.toThrow()
  })

  it("no longer exposes the client-guessed qualified entry point", () => {
    expect((analytics as Record<string, unknown>).freeCheckQualified).toBeUndefined()
  })

  /**
   * Stored UTM values are not a trusted source.
   *
   * `getStoredUTMParams` JSON-parses whatever sits under the `utm_params`
   * localStorage key and returns it unvalidated — no key allow-list, no length
   * bound, no shape check. The values it carries originate as URL query
   * parameters, so any link, any partner, any redirect chain, and anyone who
   * can write localStorage decides them. An address, an email or a PIN in
   * `utm_content` contains neither `?` nor `#`, so `sanitizeGaEventParams` has
   * nothing to catch it by and forwards it verbatim.
   *
   * The free-check funnel is the one place where such a value would land next
   * to a qualification signal about a specific identified parcel, so it does
   * not attach stored attribution at all.
   */
  describe("stored UTM attribution is not attached to free-check events", () => {
    const HOSTILE_UTM = {
      utm_source: "owner@example.com",
      utm_medium: "100 W Randolph St Apt 4B",
      utm_campaign: "16-01-216-001-0000",
      utm_term: "Jane Q Homeowner",
      utm_content: "case-778341-order-99123",
    }

    beforeEach(() => {
      window.localStorage.setItem("utm_params", JSON.stringify(HOSTILE_UTM))
      window.localStorage.setItem("utm_timestamp", String(Date.now()))
    })

    it("attaches no stored UTM value to any free-check event", () => {
      analytics.freeCheckStarted({ surface: "home_hero", inputMode: "address" })
      analytics.freeCheckCompleted({
        surface: "home_hero",
        outcome: canonicalFreeCheckOutcome("supportive", null),
        windowStatus: "open",
        preview: false,
      })

      const serialized = JSON.stringify(gtag.mock.calls)
      for (const hostile of Object.values(HOSTILE_UTM)) {
        expect(serialized).not.toContain(hostile)
      }
      for (const call of gtag.mock.calls) {
        for (const key of Object.keys(call[2] as Record<string, unknown>)) {
          expect(key).not.toMatch(/^utm_/)
        }
      }
    })

    it("still emits the qualified event itself", () => {
      analytics.freeCheckCompleted({
        surface: "home_hero",
        outcome: canonicalFreeCheckOutcome("supportive", null),
        windowStatus: "open",
        preview: false,
      })

      expect(eventsNamed("free_check_qualified")).toHaveLength(1)
    })

    it("does not read stored attribution at all on the free-check path", () => {
      const readSpy = jest.spyOn(Storage.prototype, "getItem")

      analytics.freeCheckCompleted({
        surface: "check_page",
        outcome: canonicalFreeCheckOutcome("supportive", null),
        windowStatus: "open",
        preview: false,
      })

      expect(readSpy.mock.calls.flat()).not.toContain("utm_params")
      readSpy.mockRestore()
    })
  })
})
