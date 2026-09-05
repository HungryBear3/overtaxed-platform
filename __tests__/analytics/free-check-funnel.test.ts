import {
  deriveFreeCheckOutcomeParams,
  isPreviewFreeCheckResponse,
  FREE_CHECK_INPUT_MODES,
  FREE_CHECK_SURFACES,
} from "@/lib/analytics/free-check-funnel"
import { canonicalFreeCheckOutcome } from "@/lib/free-check-outcome-contract"

/**
 * The derivation layer between the route's authoritative outcome tuple and the
 * bounded GA4 parameter set. Every property it produces has to be a primitive
 * drawn from a closed set — that is the whole reason it exists as a separate,
 * directly testable unit rather than as a literal at each call site.
 */
describe("deriveFreeCheckOutcomeParams", () => {
  it("marks a supportive outcome qualified", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "open",
      preview: false,
    })

    expect(params).toEqual({
      outcome_code: "supportive",
      outcome_reason: "none",
      allow_checkout: true,
      window_status: "open",
      qualified: true,
    })
  })

  it("keeps a supportive outcome qualified when the appeal window is not open", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome("supportive", "window_not_open"),
      windowStatus: "closed",
      preview: false,
    })

    expect(params).toMatchObject({
      outcome_code: "supportive",
      outcome_reason: "window_not_open",
      allow_checkout: false,
      window_status: "closed",
      qualified: true,
    })
  })

  it("does not mark a not-supportive outcome qualified", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome("not_supportive", "below_evidence_threshold"),
      windowStatus: "open",
      preview: false,
    })

    expect(params).toMatchObject({ outcome_code: "not_supportive", qualified: false })
  })

  it.each([
    ["insufficient_evidence", "no_comparables"],
    ["unsupported_property", "outside_cook_county"],
  ] as const)("does not mark %s qualified", (code, reason) => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome(code, reason),
      windowStatus: "unknown",
      preview: false,
    })

    expect(params).toMatchObject({ outcome_code: code, qualified: false })
  })

  it("resolves an unrecognized window status to unknown rather than the permissive value", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome("supportive", null),
      windowStatus: "wide_open_forever",
      preview: false,
    })

    expect(params?.window_status).toBe("unknown")
  })

  it("returns null for an outcome the shared matrix rejects", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: { code: "supportive", allowCheckout: true, headline: "hand-crafted" },
      windowStatus: "open",
      preview: false,
    })

    expect(params).toBeNull()
  })

  it("returns null when the response carried no outcome at all", () => {
    expect(
      deriveFreeCheckOutcomeParams({ outcome: null, windowStatus: "open", preview: false }),
    ).toBeNull()
  })

  it("returns null for a preview fixture, which is not an authoritative result", () => {
    expect(
      deriveFreeCheckOutcomeParams({
        outcome: canonicalFreeCheckOutcome("supportive", null),
        windowStatus: "open",
        preview: true,
      }),
    ).toBeNull()
  })

  it("emits only bounded primitives drawn from closed sets", () => {
    const params = deriveFreeCheckOutcomeParams({
      outcome: canonicalFreeCheckOutcome("insufficient_evidence", "no_assessed_value"),
      windowStatus: "upcoming",
      preview: false,
    })

    expect(params).not.toBeNull()
    for (const value of Object.values(params!)) {
      expect(["string", "boolean"]).toContain(typeof value)
    }
    expect(["open", "closed", "upcoming", "unknown"]).toContain(params!.window_status)
  })

  it("exposes closed surface and input-mode vocabularies", () => {
    expect(FREE_CHECK_SURFACES).toEqual(["home_hero", "check_page"])
    expect(FREE_CHECK_INPUT_MODES).toEqual(["pin", "address"])
  })
})

/**
 * Both surfaces have to agree on what a preview fixture is. When each carried
 * its own predicate, one of them would eventually recognize a marker the other
 * did not and report the static sample as a real Cook County lookup.
 */
describe("isPreviewFreeCheckResponse", () => {
  it.each([
    ["the preview flag", { preview: true }],
    ["the preview_noop mode", { mode: "preview_noop" }],
    ["the preview-noop source", { source: "preview-noop" }],
  ])("recognizes %s", (_label, response) => {
    expect(isPreviewFreeCheckResponse(response)).toBe(true)
  })

  it("does not treat a real county response as a preview", () => {
    expect(isPreviewFreeCheckResponse({ source: "cook-county", preview: false })).toBe(false)
  })

  it("does not treat a missing response as a preview", () => {
    expect(isPreviewFreeCheckResponse(null)).toBe(false)
    expect(isPreviewFreeCheckResponse(undefined)).toBe(false)
  })
})
