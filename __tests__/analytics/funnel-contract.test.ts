/**
 * @jest-environment jsdom
 *
 * The decision-grade funnel contract, executed against the real emitters.
 *
 * Nothing in lib/analytics is mocked: every assertion reads what actually
 * reached `window.gtag`. The contract is the closed definition of what each
 * sensitive funnel event may carry; these tests fail if an emitter drifts from
 * it, if the page URL or referrer can leak into one, or if a browser path can
 * write a purchase.
 */
import { analytics, trackEvent, trackGA4Event } from "@/lib/analytics/events"
import {
  DECISION_FUNNEL_EVENTS,
  isServerOnlyEventName,
  validateBrowserFunnelEvent,
} from "@/lib/analytics/funnel-contract"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

const HOSTILE_PATH = "/check/jane-doe-100-w-randolph?pin=16-01-216-001-0000&email=jane@example.test&address=100+W+Randolph#result-cs_live_a1B2c3"
const HOSTILE_REFERRER = "https://partner.example.test/clients/jane-doe-100-w-randolph/parcel-16012160010000?order=ord_123"
const HOSTILE_MARKERS = [
  /jane/i,
  /randolph/i,
  /16-01-216-001-0000/,
  /16012160010000/,
  /example\.test/,
  /partner/,
  /cs_live/,
  /ord_123/,
  /result/,
  /localhost/,
  /\/check/,
]

let gtag: jest.Mock

function setReferrer(referrer: string) {
  Object.defineProperty(document, "referrer", { configurable: true, value: referrer })
}

function eventCalls(name: string): Array<Record<string, unknown>> {
  return gtag.mock.calls.filter((call) => call[0] === "event" && call[1] === name).map((call) => call[2])
}

beforeEach(() => {
  gtag = jest.fn()
  window.gtag = gtag
  window.history.replaceState({}, "", HOSTILE_PATH)
  setReferrer(HOSTILE_REFERRER)
})

afterEach(() => {
  delete (window as { gtag?: unknown }).gtag
  window.history.replaceState({}, "", "/")
  setReferrer("")
})

describe("the contract names exactly the decision-grade funnel", () => {
  it("promotes free_check_completed, one qualified outcome, begin_checkout and purchase — nothing else", () => {
    expect([...DECISION_FUNNEL_EVENTS]).toEqual([
      "free_check_completed",
      "free_check_qualified",
      "begin_checkout",
      "purchase",
    ])
  })

  it("treats free_check_started as diagnostic: closed, but not decision-grade", () => {
    expect(
      validateBrowserFunnelEvent("free_check_started", {
        surface: "check_page",
        input_mode: "pin",
        page_location: "",
        page_referrer: "",
      }),
    ).toEqual({ ok: true, grade: "diagnostic" })
  })
})

describe("contract validation of a browser funnel event", () => {
  const completed = {
    surface: "check_page",
    outcome_code: "not_supportive",
    outcome_reason: "below_evidence_threshold",
    allow_checkout: false,
    window_status: "open",
    qualified: false,
    page_location: "",
    page_referrer: "",
  }

  it("accepts a canonical free_check_completed with explicit empty page context", () => {
    expect(validateBrowserFunnelEvent("free_check_completed", completed)).toEqual({ ok: true, grade: "decision" })
  })

  it.each([
    ["an omitted page_location", { page_location: undefined }, "MISSING_PARAM:page_location"],
    ["an omitted page_referrer", { page_referrer: undefined }, "MISSING_PARAM:page_referrer"],
    ["a sanitized-but-present page_location", { page_location: "https://www.overtaxed-il.com/check" }, "INVALID_VALUE:page_location"],
    ["a referrer origin", { page_referrer: "https://partner.example.test" }, "INVALID_VALUE:page_referrer"],
    ["an unknown surface", { surface: "partner_widget" }, "INVALID_VALUE:surface"],
    ["a township", { township: "Jefferson" }, "UNKNOWN_PARAM:township"],
    ["a PIN", { pin: "16012160010000" }, "UNKNOWN_PARAM:pin"],
    ["a qualified flag that disagrees with the outcome", { qualified: true }, "INCONSISTENT_OUTCOME"],
    ["an outcome tuple outside the matrix", { outcome_reason: "window_not_open" }, "INCONSISTENT_OUTCOME"],
    ["a string boolean", { allow_checkout: "false" }, "INVALID_VALUE:allow_checkout"],
  ])("rejects %s", (_label, change, violation) => {
    const params: Record<string, unknown> = { ...completed, ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete params[key]

    const result = validateBrowserFunnelEvent("free_check_completed", params)

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.violations).toContain(violation)
  })

  it("accepts free_check_qualified only for a supportive outcome", () => {
    const qualified = {
      surface: "home_hero",
      outcome_code: "supportive",
      outcome_reason: "window_not_open",
      allow_checkout: false,
      window_status: "closed",
      page_location: "",
      page_referrer: "",
    }
    expect(validateBrowserFunnelEvent("free_check_qualified", qualified)).toEqual({ ok: true, grade: "decision" })

    const notSupportive = { ...qualified, outcome_code: "not_supportive", outcome_reason: "below_evidence_threshold" }
    const result = validateBrowserFunnelEvent("free_check_qualified", notSupportive)
    expect(result.ok ? [] : result.violations).toContain("NOT_A_QUALIFIED_OUTCOME")
  })

  it.each([
    [{ plan: "T2", value: 69, page_location: "", page_referrer: "" }, true],
    [{ page_location: "", page_referrer: "" }, true],
    [{ plan: "T9", value: 69, page_location: "", page_referrer: "" }, false],
    [{ plan: "T2", value: 0, page_location: "", page_referrer: "" }, false],
    [{ plan: "T2", value: 10_001, page_location: "", page_referrer: "" }, false],
    [{ plan: "T2", value: 69, currency: "USD", page_location: "", page_referrer: "" }, false],
    [{ plan: "T2", value: 69 }, false],
  ])("begin_checkout %j is accepted: %s", (params, accepted) => {
    expect(validateBrowserFunnelEvent("begin_checkout", params).ok).toBe(accepted)
  })

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])(
    "refuses a parameter named after an inherited object member: %s",
    (key) => {
      // JSON.parse makes `__proto__` an own, enumerable key, as it would be off the wire.
      const params = JSON.parse(`{"page_location":"","page_referrer":"",${JSON.stringify(key)}:"jane-doe-123-main-st"}`)

      expect(validateBrowserFunnelEvent("begin_checkout", params)).toEqual({ ok: false, violations: [`UNKNOWN_PARAM:${key}`] })
    },
  )

  it("does not count a required parameter inherited through a prototype as present", () => {
    const params = Object.assign(Object.create({ page_location: "" }), { page_referrer: "" })

    expect(validateBrowserFunnelEvent("begin_checkout", params)).toEqual({ ok: false, violations: ["MISSING_PARAM:page_location"] })
  })

  it("refuses purchase and refund as browser events", () => {
    for (const name of ["purchase", "refund"]) {
      const result = validateBrowserFunnelEvent(name, { transaction_id: "cs_test_synthetic0001", value: 69 })
      expect(result.ok ? [] : result.violations).toEqual(["SERVER_ONLY_EVENT"])
      expect(isServerOnlyEventName(name)).toBe(true)
    }
  })

  it("refuses an event the contract does not know", () => {
    const result = validateBrowserFunnelEvent("appeal_started", { property_id: "prop_1" })
    expect(result.ok ? [] : result.violations).toEqual(["UNKNOWN_EVENT"])
  })
})

describe("the real emitters conform to the contract under a hostile URL and referrer", () => {
  it("sends free_check_completed and free_check_qualified with explicit empty page context and nothing else", () => {
    analytics.freeCheckCompleted({
      surface: "check_page",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(eventCalls("free_check_completed")).toEqual([
      {
        surface: "check_page",
        outcome_code: "supportive",
        outcome_reason: "none",
        allow_checkout: true,
        window_status: "open",
        qualified: true,
        page_location: "",
        page_referrer: "",
      },
    ])
    expect(eventCalls("free_check_qualified")).toEqual([
      {
        surface: "check_page",
        outcome_code: "supportive",
        outcome_reason: "none",
        allow_checkout: true,
        window_status: "open",
        page_location: "",
        page_referrer: "",
      },
    ])
  })

  it("every gtag call the funnel makes validates and carries no hostile marker", () => {
    analytics.freeCheckStarted({ surface: "home_hero", inputMode: "address" })
    analytics.freeCheckCompleted({
      surface: "home_hero",
      outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_comparables"),
      windowStatus: "unknown",
      preview: false,
    })
    analytics.freeCheckCompleted({
      surface: "sticky_bar",
      outcome: canonicalFreeCheckOutcome("supportive", "window_unverified"),
      windowStatus: "surprise",
      preview: false,
    })
    analytics.checkoutStarted("T3", 149)

    expect(gtag).toHaveBeenCalledTimes(5)
    for (const [command, name, params] of gtag.mock.calls) {
      expect(command).toBe("event")
      expect(validateBrowserFunnelEvent(name, params)).toMatchObject({ ok: true })
    }
    const serialized = JSON.stringify(gtag.mock.calls)
    for (const marker of HOSTILE_MARKERS) expect(serialized).not.toMatch(marker)
  })
})

describe("the sensitive boundary enforces the contract at runtime", () => {
  // Surface and input mode are closed only by TypeScript. An untyped caller
  // can pass any string; the boundary must refuse the event rather than
  // forward text the contract does not list.
  it("sends nothing for a surface or input mode outside the closed sets", () => {
    const untyped = analytics as unknown as {
      freeCheckStarted: (params: Record<string, unknown>) => void
      freeCheckCompleted: (params: Record<string, unknown>) => void
    }

    untyped.freeCheckStarted({ surface: "jane@example.test", inputMode: "pin" })
    untyped.freeCheckStarted({ surface: "check_page", inputMode: "16-01-216-001-0000" })
    untyped.freeCheckCompleted({
      surface: "partner/jane-doe-100-w-randolph",
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(gtag).not.toHaveBeenCalled()
  })
})

describe("no browser purchase writer", () => {
  it.each([
    ["trackGA4Event purchase", () => trackGA4Event("purchase", { transaction_id: "cs_test_synthetic0001", value: 69, currency: "USD" })],
    ["trackEvent purchase", () => trackEvent("purchase", { transaction_id: "cs_test_synthetic0001", value: 69, currency: "USD" })],
    ["trackGA4Event refund", () => trackGA4Event("refund", { transaction_id: "cs_test_synthetic0001", value: 69 })],
  ])("%s never reaches gtag", (_label, emit) => {
    emit()

    expect(gtag).not.toHaveBeenCalled()
  })

  it("still sends an ordinary generic event", () => {
    trackGA4Event("deadline_map_view", { officialCount: 3 })

    expect(eventCalls("deadline_map_view")).toHaveLength(1)
  })
})
