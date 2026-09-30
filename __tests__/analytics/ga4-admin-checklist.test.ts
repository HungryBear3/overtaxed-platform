/** @jest-environment node */

/**
 * The checked-in GA4 Admin checklist and its readback verification contract.
 *
 * The checklist names the only event-scoped custom dimensions and key events
 * the OT property should carry. The verifier compares an operator-captured,
 * read-only Admin API readback against it. Nothing here calls an API: the
 * readback is data handed in.
 */
import checklist from "@/data/analytics/ot-ga4-admin-checklist.v2.json"
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
  const dimension = (id: number, parameterName: string, displayName: string) => ({
    name: `properties/123456789/customDimensions/${id}`,
    parameterName,
    displayName,
    scope: "EVENT",
  })
  return {
    customDimensions: {
      customDimensions: [
        { ...dimension(1001, "surface", "OT free check surface"), description: "", disallowAdsPersonalization: false },
        dimension(1002, "plan", "OT checkout plan"),
        dimension(1003, "input_mode", "OT free check input mode"),
        dimension(1004, "outcome_code", "OT free check outcome"),
        dimension(1005, "blocked_reason", "OT checkout blocked reason"),
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
      ],
    },
  }
}

describe("the checked-in checklist", () => {
  it("is valid and agrees with the funnel contract", () => {
    expect(validateGa4AdminChecklist(checklist)).toEqual({ ok: true })
  })

  it("registers exactly five event-scoped dimensions and purchase as the only key event, all pending", () => {
    expect(checklist.custom_dimensions.map((d) => [d.parameter_name, d.scope, d.status])).toEqual([
      ["surface", "EVENT", "pending"],
      ["input_mode", "EVENT", "pending"],
      ["outcome_code", "EVENT", "pending"],
      ["plan", "EVENT", "pending"],
      ["blocked_reason", "EVENT", "pending"],
    ])
    expect(checklist.key_events.map((k) => [k.event_name, k.counting_method, k.status])).toEqual([
      ["purchase", "ONCE_PER_EVENT", "pending"],
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
      "an event the contract does not know",
      (c: Json) => ((c.custom_dimensions as Json[])[0].events = ["page_view"]),
      "EVENT_NOT_DECISION_GRADE:page_view",
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
      "a browser event as a key event",
      (c: Json) =>
        (c.key_events as Json[]).push({
          event_name: "free_check_qualified",
          counting_method: "ONCE_PER_SESSION",
          status: "pending",
          rationale: "x",
        }),
      "KEY_EVENT_NOT_PERMITTED:free_check_qualified",
    ],
    [
      "begin_checkout as a key event",
      (c: Json) => ((c.key_events as Json[])[0].event_name = "begin_checkout"),
      "KEY_EVENT_NOT_PERMITTED:begin_checkout",
    ],
    [
      "an unknown counting method",
      (c: Json) => ((c.key_events as Json[])[0].counting_method = "ONCE_PER_USER"),
      "INVALID_COUNTING_METHOD:purchase",
    ],
    [
      "a dimension marked done without a readback",
      (c: Json) => ((c.custom_dimensions as Json[])[0].status = "done"),
      "INVALID_STATUS:surface",
    ],
    [
      "a key event with no status",
      (c: Json) => delete (c.key_events as Json[])[0].status,
      "INVALID_STATUS:purchase",
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
    dims.splice(2, 1)
    const keys = (readback.keyEvents as { keyEvents: Json[] }).keyEvents
    keys[0].countingMethod = "ONCE_PER_SESSION"
    keys.push({ eventName: "begin_checkout", countingMethod: "ONCE_PER_EVENT" })
    keys.push({ eventName: "free_check_qualified", countingMethod: "ONCE_PER_SESSION" })

    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({
      status: "FAIL",
      findings: [
        "MISSING_DIMENSION:input_mode",
        "SENSITIVE_DIMENSION:property_pin",
        "UNEXPECTED_DIMENSION:[redacted]",
        "UNEXPECTED_DIMENSION:property_pin",
        "UNEXPECTED_KEY_EVENT:begin_checkout",
        "UNEXPECTED_KEY_EVENT:free_check_qualified",
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
