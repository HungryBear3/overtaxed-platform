/** @jest-environment node */

/**
 * The checked-in GA4 Admin checklist and its readback verification contract.
 *
 * The checklist names the only event-scoped custom dimensions and key events
 * the OT property should carry. The verifier compares an operator-captured,
 * read-only Admin API readback against it. Nothing here calls an API: the
 * readback is data handed in.
 */
import checklist from "@/data/analytics/ot-ga4-admin-checklist.v1.json"
import {
  validateGa4AdminChecklist,
  verifyGa4AdminReadback,
} from "@/lib/analytics/ga4-admin-checklist"

type Json = Record<string, unknown>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The exact readback a correctly configured property returns. */
function conformingReadback(): Json {
  return {
    customDimensions: {
      customDimensions: [
        {
          name: "properties/123456789/customDimensions/1001",
          parameterName: "surface",
          displayName: "OT free check surface",
          scope: "EVENT",
          description: "",
          disallowAdsPersonalization: false,
        },
        {
          name: "properties/123456789/customDimensions/1002",
          parameterName: "plan",
          displayName: "OT checkout plan",
          scope: "EVENT",
        },
      ],
    },
    keyEvents: {
      keyEvents: [
        {
          name: "properties/123456789/keyEvents/2001",
          eventName: "purchase",
          createTime: "2026-09-01T00:00:00Z",
          deletable: false,
          custom: false,
          countingMethod: "ONCE_PER_EVENT",
        },
        {
          name: "properties/123456789/keyEvents/2002",
          eventName: "free_check_qualified",
          createTime: "2026-09-01T00:00:00Z",
          deletable: true,
          custom: true,
          countingMethod: "ONCE_PER_SESSION",
        },
      ],
    },
  }
}

describe("the checked-in checklist", () => {
  it("is valid and agrees with the funnel contract", () => {
    expect(validateGa4AdminChecklist(checklist)).toEqual({ ok: true })
  })

  it("registers exactly two event-scoped dimensions and two key events", () => {
    expect(checklist.custom_dimensions.map((d) => [d.parameter_name, d.scope])).toEqual([
      ["surface", "EVENT"],
      ["plan", "EVENT"],
    ])
    expect(checklist.key_events.map((k) => [k.event_name, k.counting_method])).toEqual([
      ["free_check_qualified", "ONCE_PER_SESSION"],
      ["purchase", "ONCE_PER_EVENT"],
    ])
  })
})

describe("checklist validation refuses what is not decision-grade", () => {
  it.each([
    ["a user-scoped dimension", (c: Json) => ((c.custom_dimensions as Json[])[0].scope = "USER"), "INVALID_SCOPE:surface"],
    [
      "a parameter no listed event carries",
      (c: Json) => ((c.custom_dimensions as Json[])[0].parameter_name = "township"),
      "PARAMETER_NOT_IN_CONTRACT:township",
    ],
    [
      "a diagnostic-only parameter",
      (c: Json) => {
        const d = (c.custom_dimensions as Json[])[0]
        d.parameter_name = "input_mode"
        d.events = ["free_check_started"]
      },
      "EVENT_NOT_DECISION_GRADE:free_check_started",
    ],
    [
      "the transaction id as a dimension",
      (c: Json) => {
        const d = (c.custom_dimensions as Json[])[1]
        d.parameter_name = "transaction_id"
        d.events = ["purchase"]
      },
      "RESERVED_PARAMETER:transaction_id",
    ],
    [
      "the empty page context as a dimension",
      (c: Json) => ((c.custom_dimensions as Json[])[1].parameter_name = "page_location"),
      "RESERVED_PARAMETER:page_location",
    ],
    [
      "a key event for a diagnostic event",
      (c: Json) => ((c.key_events as Json[])[0].event_name = "free_check_started"),
      "EVENT_NOT_DECISION_GRADE:free_check_started",
    ],
    [
      "an unknown counting method",
      (c: Json) => ((c.key_events as Json[])[1].counting_method = "ONCE_PER_USER"),
      "INVALID_COUNTING_METHOD:purchase",
    ],
    [
      "a duplicated dimension",
      (c: Json) => (c.custom_dimensions as Json[]).push(clone((c.custom_dimensions as Json[])[0])),
      "DUPLICATE_DIMENSION:surface",
    ],
    ["an unknown top-level key", (c: Json) => (c.notes = "free text"), "UNKNOWN_KEY:notes"],
    ["a missing purchase key event", (c: Json) => (c.key_events as Json[]).pop(), "PURCHASE_KEY_EVENT_REQUIRED"],
    ["a wrong contract version", (c: Json) => (c.funnel_contract_version = "ot-funnel-contract-v0"), "CONTRACT_VERSION_MISMATCH"],
  ])("rejects %s", (_label, mutate, violation) => {
    const candidate = clone(checklist) as unknown as Json
    mutate(candidate)

    const result = validateGa4AdminChecklist(candidate)

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.violations).toContain(violation)
  })
})

describe("readback verification", () => {
  it("passes an exactly conforming property", () => {
    expect(verifyGa4AdminReadback(checklist, conformingReadback())).toEqual({ status: "PASS", findings: [] })
  })

  it("reports every divergence, sorted, without echoing unsafe names", () => {
    const readback = conformingReadback()
    const dims = (readback.customDimensions as { customDimensions: Json[] }).customDimensions
    dims[0].scope = "USER"
    dims[1].displayName = "Plan"
    dims.push({ parameterName: "property_pin", displayName: "PIN", scope: "EVENT" })
    dims.push({ parameterName: "jane doe 100 W Randolph", displayName: "x", scope: "EVENT" })
    const keys = (readback.keyEvents as { keyEvents: Json[] }).keyEvents
    keys[0].countingMethod = "ONCE_PER_SESSION"
    keys.splice(1, 1)
    keys.push({ eventName: "begin_checkout", countingMethod: "ONCE_PER_EVENT" })

    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({
      status: "FAIL",
      findings: [
        "MISSING_KEY_EVENT:free_check_qualified",
        "SENSITIVE_DIMENSION:property_pin",
        "UNEXPECTED_DIMENSION:[redacted]",
        "UNEXPECTED_DIMENSION:property_pin",
        "UNEXPECTED_KEY_EVENT:begin_checkout",
        "WRONG_COUNTING_METHOD:purchase",
        "WRONG_DISPLAY_NAME:plan",
        "WRONG_SCOPE:surface",
      ],
    })
  })

  it("fails closed on an incomplete or malformed readback", () => {
    const paged = conformingReadback()
    ;(paged.keyEvents as Json).nextPageToken = "page-2"
    expect(verifyGa4AdminReadback(checklist, paged)).toEqual({
      status: "FAIL",
      findings: ["PAGINATION_INCOMPLETE:keyEvents"],
    })

    expect(verifyGa4AdminReadback(checklist, { customDimensions: {} })).toEqual({
      status: "FAIL",
      findings: ["MALFORMED_READBACK"],
    })
    expect(verifyGa4AdminReadback(checklist, null)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it("reports a duplicated dimension registration", () => {
    const readback = conformingReadback()
    const dims = (readback.customDimensions as { customDimensions: Json[] }).customDimensions
    dims.push(clone(dims[0]))

    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({
      status: "FAIL",
      findings: ["DUPLICATE_DIMENSION:surface"],
    })
  })

  it("refuses to verify against an invalid checklist", () => {
    const broken = clone(checklist) as unknown as Json
    ;(broken.custom_dimensions as Json[])[0].scope = "USER"

    expect(verifyGa4AdminReadback(broken, conformingReadback())).toEqual({
      status: "FAIL",
      findings: ["INVALID_CHECKLIST"],
    })
  })

  it("is deterministic and does not mutate its inputs", () => {
    const readback = conformingReadback()
    const before = JSON.stringify(readback)
    const first = verifyGa4AdminReadback(checklist, readback)
    const second = verifyGa4AdminReadback(checklist, readback)

    expect(second).toEqual(first)
    expect(JSON.stringify(readback)).toBe(before)
  })
})
