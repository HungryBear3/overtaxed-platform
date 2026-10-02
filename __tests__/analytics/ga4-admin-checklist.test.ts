/** @jest-environment node */

/**
 * The checked-in GA4 Admin checklist and its readback verification contract.
 *
 * The checklist names the only event-scoped custom dimensions and key events
 * the OT property should carry, the Enhanced Measurement settings that must be
 * OFF on its web stream, and the settings whose posture the owner decides
 * (outbound clicks, form interactions, file downloads). The verifier compares
 * an operator-captured, read-only Admin API readback against it. Nothing here
 * calls an API: the readback is data handed in.
 */
import shipped from "@/data/analytics/ot-ga4-admin-checklist.v4.json"
import {
  validateGa4AdminChecklist,
  verifyGa4AdminReadback,
} from "@/lib/analytics/ga4-admin-checklist"

type Json = Record<string, unknown>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const OWNER_DECIDED = ["outbound_clicks", "form_interactions", "file_downloads"]

/** The shipped checklist with the owner's Enhanced Measurement posture recorded. */
function withOwnerPosture(posture: string): Json {
  const decided = clone(shipped) as unknown as Json
  ;(decided.readback as Json).enhanced_measurement_resource =
    "properties/123456789/dataStreams/987654321/enhancedMeasurementSettings"
  for (const item of decided.enhanced_measurement as Json[]) {
    if (OWNER_DECIDED.includes(item.setting as string)) item.owner_posture = posture
  }
  return decided
}

/** The checklist as it reads once the owner records the recommended posture: all OFF. */
const checklist = withOwnerPosture("off")

/**
 * The web stream's Enhanced Measurement settings with browser-history page
 * changes, site search, outbound clicks, form interactions and file downloads
 * OFF. The Admin API emits proto3 JSON, so a false boolean may also be omitted
 * entirely.
 */
function conformingEnhancedMeasurement(): Json {
  return {
    name: "properties/123456789/dataStreams/987654321/enhancedMeasurementSettings",
    streamEnabled: true,
    scrollsEnabled: true,
    outboundClicksEnabled: false,
    siteSearchEnabled: false,
    videoEngagementEnabled: true,
    fileDownloadsEnabled: false,
    pageChangesEnabled: false,
    formInteractionsEnabled: false,
    searchQueryParameter: "q,s,search,query,keyword",
  }
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
    customDimensionsEvidence: { request: "GET /v1beta/properties/123456789/customDimensions", complete: true },
    keyEventsEvidence: { request: "GET /v1beta/properties/123456789/keyEvents", complete: true },
    enhancedMeasurementSettings: conformingEnhancedMeasurement(),
    enhancedMeasurementEvidence: {
      request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings",
      complete: true,
    },
  }
}

describe("the checked-in checklist", () => {
  it("is valid and agrees with the funnel contract", () => {
    expect(validateGa4AdminChecklist(shipped)).toEqual({ ok: true })
  })

  it("registers exactly five event-scoped dimensions and purchase as the only key event, all pending", () => {
    expect(shipped.custom_dimensions.map((d) => [d.parameter_name, d.scope, d.status])).toEqual([
      ["surface", "EVENT", "pending"],
      ["input_mode", "EVENT", "pending"],
      ["outcome_code", "EVENT", "pending"],
      ["plan", "EVENT", "pending"],
      ["blocked_reason", "EVENT", "pending"],
    ])
    expect(shipped.key_events.map((k) => [k.event_name, k.counting_method, k.status])).toEqual([
      ["purchase", "ONCE_PER_EVENT", "pending"],
    ])
  })

  it("requires browser-history page changes and site search OFF, and records the owner's other three settings as OFF", () => {
    const c = shipped as unknown as Json
    expect(c.schema_version).toBe(4)
    expect(
      (c.enhanced_measurement as Json[]).map((s) => [s.setting, s.readback_field, s.required_value, s.owner_posture, s.status]),
    ).toEqual([
      ["browser_history", "pageChangesEnabled", false, undefined, "pending"],
      ["site_search", "siteSearchEnabled", false, undefined, "pending"],
      ["outbound_clicks", "outboundClicksEnabled", undefined, "off", "pending"],
      ["form_interactions", "formInteractionsEnabled", undefined, "off", "pending"],
      ["file_downloads", "fileDownloadsEnabled", undefined, "off", "pending"],
    ])
  })

  it("recommends OFF for every owner-decided setting", () => {
    for (const item of (shipped as unknown as { enhanced_measurement: Json[] }).enhanced_measurement) {
      if (OWNER_DECIDED.includes(item.setting as string)) expect(item.rationale).toMatch(/Recommended posture: OFF\./)
    }
  })

  it("accepts each recordable owner posture", () => {
    for (const posture of ["undecided", "off", "on_accepted"]) {
      expect(validateGa4AdminChecklist(withOwnerPosture(posture))).toEqual({ ok: true })
    }
  })

  it("reads the Enhanced Measurement settings back with a read-only GET", () => {
    const readback = (shipped as unknown as { readback: { calls: string[]; oauth_scope: string } }).readback
    expect(readback.calls).toEqual([
      "GET /v1beta/properties/{property_id}/customDimensions",
      "GET /v1beta/properties/{property_id}/keyEvents",
      "GET /v1alpha/properties/{property_id}/dataStreams/{data_stream_id}/enhancedMeasurementSettings",
    ])
    expect(readback.oauth_scope).toBe("https://www.googleapis.com/auth/analytics.readonly")
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
    ["the previous schema version", (c: Json) => (c.schema_version = 3), "SCHEMA"],
    ["no Enhanced Measurement section", (c: Json) => delete c.enhanced_measurement, "ENHANCED_MEASUREMENT_REQUIRED:browser_history"],
    [
      "a missing browser-history requirement",
      (c: Json) => (c.enhanced_measurement as Json[]).shift(),
      "ENHANCED_MEASUREMENT_REQUIRED:browser_history",
    ],
    [
      "a missing site-search requirement",
      (c: Json) => (c.enhanced_measurement = (c.enhanced_measurement as Json[]).filter((s) => s.setting !== "site_search")),
      "ENHANCED_MEASUREMENT_REQUIRED:site_search",
    ],
    [
      "browser-history page changes allowed ON",
      (c: Json) => ((c.enhanced_measurement as Json[])[0].required_value = true),
      "ENHANCED_MEASUREMENT_MUST_BE_OFF:browser_history",
    ],
    [
      "site search allowed ON",
      (c: Json) => ((c.enhanced_measurement as Json[])[1].required_value = true),
      "ENHANCED_MEASUREMENT_MUST_BE_OFF:site_search",
    ],
    [
      "a setting read from the wrong field",
      (c: Json) => ((c.enhanced_measurement as Json[])[0].readback_field = "siteSearchEnabled"),
      "ENHANCED_MEASUREMENT_FIELD:browser_history",
    ],
    ...OWNER_DECIDED.map((setting): [string, (c: Json) => void, string] => [
      `a missing ${setting} posture`,
      (c: Json) => (c.enhanced_measurement = (c.enhanced_measurement as Json[]).filter((s) => s.setting !== setting)),
      `ENHANCED_MEASUREMENT_REQUIRED:${setting}`,
    ]),
    [
      "an owner-decided setting with no posture",
      (c: Json) => delete (c.enhanced_measurement as Json[])[2].owner_posture,
      "INVALID_OWNER_POSTURE:outbound_clicks",
    ],
    [
      "an owner-decided setting with an unknown posture",
      (c: Json) => ((c.enhanced_measurement as Json[])[3].owner_posture = "on"),
      "INVALID_OWNER_POSTURE:form_interactions",
    ],
    [
      "an owner-decided setting written as a fixed requirement",
      (c: Json) => {
        const item = (c.enhanced_measurement as Json[])[4]
        delete item.owner_posture
        item.required_value = false
      },
      "UNKNOWN_KEY:required_value",
    ],
    [
      "a fixed setting given an owner posture",
      (c: Json) => ((c.enhanced_measurement as Json[])[1].owner_posture = "on_accepted"),
      "UNKNOWN_KEY:owner_posture",
    ],
    [
      "an owner-decided setting read from the wrong field",
      (c: Json) => ((c.enhanced_measurement as Json[])[3].readback_field = "fileDownloadsEnabled"),
      "ENHANCED_MEASUREMENT_FIELD:form_interactions",
    ],
    [
      "an owner-decided setting marked done without a readback",
      (c: Json) => ((c.enhanced_measurement as Json[])[4].status = "done"),
      "INVALID_STATUS:file_downloads",
    ],
    [
      "a setting marked done without a readback",
      (c: Json) => ((c.enhanced_measurement as Json[])[0].status = "done"),
      "INVALID_STATUS:browser_history",
    ],
    [
      "an unknown Enhanced Measurement setting",
      (c: Json) =>
        (c.enhanced_measurement as Json[]).push({
          setting: "scrolls",
          readback_field: "scrollsEnabled",
          required_value: false,
          status: "pending",
          rationale: "x",
        }),
      "UNKNOWN_ENHANCED_MEASUREMENT_SETTING:scrolls",
    ],
    [
      "a duplicated Enhanced Measurement setting",
      (c: Json) => (c.enhanced_measurement as Json[]).push(clone((c.enhanced_measurement as Json[])[1])),
      "DUPLICATE_ENHANCED_MEASUREMENT:site_search",
    ],
    [
      "an unknown key on an Enhanced Measurement setting",
      (c: Json) => ((c.enhanced_measurement as Json[])[0].verified_at = "2026-09-30"),
      "UNKNOWN_KEY:verified_at",
    ],
    [
      "a write scope on the readback",
      (c: Json) => ((c.readback as Json).oauth_scope = "https://www.googleapis.com/auth/analytics.edit"),
      "READBACK_SCOPE_NOT_READ_ONLY",
    ],
    [
      "a readback without the Enhanced Measurement call",
      (c: Json) => ((c.readback as Json).calls as string[]).pop(),
      "READBACK_CALLS",
    ],
  ])("rejects %s", (_label, mutate, violation) => {
    const candidate = clone(checklist) as unknown as Json
    mutate(candidate)

    const result = validateGa4AdminChecklist(candidate)

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.violations).toContain(violation)
  })
})

describe.each(["customDimensions", "keyEvents"])("list evidence: %s", (field) => {
  const request = (field: string) => `GET /v1beta/properties/123456789/${field}`

  it.each([
    undefined, null, [], {}, { complete: true, request: undefined }, { request: "GET" },
    ...[false, "true", null, 1].map((complete) => ({ complete })),
    ...["filter", "fields", "fieldMask", "partial", "partialResponse", "unknown"].map((key) => ({ complete: true, [key]: "private evidence" })),
  ])("rejects missing, malformed or annotated evidence %p", (evidence) => {
    const readback = conformingReadback()
    readback[`${field}Evidence`] = evidence && !Array.isArray(evidence) ? { request: request(field), ...evidence } : evidence
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each(["?filter=private", "?fields=name", "?fieldMask=name", "?pageToken=private", "?pageSize=200", " "])("rejects nonexact GET %s", (suffix) => {
    const readback = conformingReadback()
    readback[`${field}Evidence`] = { request: request(field) + suffix, complete: true }
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it("rejects retargeted body and evidence together", () => {
    const readback = conformingReadback()
    readback[`${field}Evidence`] = { request: `GET /v1beta/properties/999/${field}`, complete: true }
    for (const item of (readback[field] as Json)[field] as Json[]) item.name = `properties/999/${field}/123`
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each([undefined, null, 42, "", "properties/123456789/wrong/1", "properties/123456789/customDimensions/1?fields=name", `properties/123456789/${field}/1\n`])("rejects missing or malformed item resource %p", (name) => {
    const readback = conformingReadback()
    ;((readback[field] as Json)[field] as Json[])[0].name = name
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each([null, {}, "", false, 1])("rejects nonarray list %p", (value) => {
    const readback = conformingReadback()
    ;(readback[field] as Json)[field] = value
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each([null, false, 1, []])("rejects malformed pagination token %p", (value) => {
    const readback = conformingReadback()
    ;(readback[field] as Json).nextPageToken = value
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it("fails pagination closed without echoing the token", () => {
    const readback = conformingReadback()
    ;(readback[field] as Json).nextPageToken = "private token"
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: [`PAGINATION_INCOMPLETE:${field}`] })
  })

  it("accepts empty token and proto3 omission of optional item fields", () => {
    const readback = conformingReadback()
    ;(readback[field] as Json).nextPageToken = ""
    for (const item of (readback[field] as Json)[field] as Json[]) {
      for (const key of ["description", "disallowAdsPersonalization", "createTime", "deletable", "custom"]) delete item[key]
    }
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "PASS", findings: [] })
  })

  it("treats omitted proto3 list as empty, not as malformed", () => {
    const readback = conformingReadback()
    readback[field] = {}
    const result = verifyGa4AdminReadback(checklist, readback)
    expect(result.status).toBe("FAIL")
    expect(result.findings).not.toContain("MALFORMED_READBACK")
    expect(result.findings.every((finding) => finding.startsWith("MISSING_"))).toBe(true)
  })
  it("rejects wrong-property item names without echoing values", () => {
    const readback = conformingReadback()
    ;((readback[field] as Json)[field] as Json[])[0].name = `properties/999/${field}/123`
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each(["partial", "partialResponse", "fields", "fieldMask", "unknown"])("rejects envelope metadata %s", (key) => {
    const readback = conformingReadback()
    ;(readback[field] as Json)[key] = "private evidence"
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })
})

describe("readback evidence regressions", () => {
  it("requires an independently configured checklist target", () => {
    const unconfigured = clone(checklist)
    delete (unconfigured.readback as Json).enhanced_measurement_resource
    expect(validateGa4AdminChecklist(unconfigured)).toEqual({ ok: true })
    expect(verifyGa4AdminReadback(unconfigured, conformingReadback())).toEqual({
      status: "FAIL", findings: ["ENHANCED_MEASUREMENT_TARGET_REQUIRED"],
    })
  })

  it.each([null, "", "properties/1/dataStreams/2", "private target"])("rejects malformed configured target %p", (target) => {
    const invalid = clone(checklist)
    ;(invalid.readback as Json).enhanced_measurement_resource = target
    expect(verifyGa4AdminReadback(invalid, conformingReadback())).toEqual({ status: "FAIL", findings: ["INVALID_CHECKLIST"] })
  })

  it.each([
    undefined,
    { complete: false },
    { complete: "true" },
    { complete: true },
    { complete: false, request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings" },
    { complete: "true", request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings" },
    { request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings" },
    { complete: true, request: "GET /v1alpha/properties/1/dataStreams/2/enhancedMeasurementSettings" },
    { complete: true, request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings?fields=name" },
    { complete: true, request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings", fields: "name" },
    { complete: true, request: "GET /v1alpha/properties/123456789/dataStreams/987654321/enhancedMeasurementSettings", fieldMask: "name" },
  ])("requires complete unfiltered GET evidence %p", (evidence) => {
    const readback = conformingReadback()
    readback.enhancedMeasurementEvidence = evidence
    // Omitted false fields are not trustworthy without complete capture evidence.
    delete (readback.enhancedMeasurementSettings as Json).siteSearchEnabled
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it("does not accept a body and capture retargeted together", () => {
    const readback = conformingReadback()
    ;(readback.enhancedMeasurementSettings as Json).name = "properties/1/dataStreams/2/enhancedMeasurementSettings"
    ;(readback.enhancedMeasurementEvidence as Json).request = "GET /v1alpha/properties/1/dataStreams/2/enhancedMeasurementSettings"
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
  })

  it.each([
    ["name-only", { name: conformingEnhancedMeasurement().name }],
    ["unknown field", { ...conformingEnhancedMeasurement(), unexpected: "private evidence" }],
    ["partial response", { ...conformingEnhancedMeasurement(), partialResponse: true }],
    ["field mask", { ...conformingEnhancedMeasurement(), fieldMask: "name" }],
    ["fields selector", { ...conformingEnhancedMeasurement(), fields: "name" }],
    ["wrong property", { ...conformingEnhancedMeasurement(), name: "properties/1/dataStreams/987654321/enhancedMeasurementSettings" }],
    ["wrong stream", { ...conformingEnhancedMeasurement(), name: "properties/123456789/dataStreams/2/enhancedMeasurementSettings" }],
  ])("refuses %s without echoing evidence", (_label, body) => {
    const readback = conformingReadback()
    readback.enhancedMeasurementSettings = body
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
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
    dims.push({ name: "properties/123456789/customDimensions/9999", parameterName: "property_pin", displayName: "PIN", scope: "EVENT" })
    dims.push({ name: "properties/123456789/customDimensions/9999", parameterName: "jane doe 100 W Randolph", displayName: "x", scope: "EVENT" })
    dims.splice(2, 1)
    const keys = (readback.keyEvents as { keyEvents: Json[] }).keyEvents
    keys[0].countingMethod = "ONCE_PER_SESSION"
    keys.push({ name: "properties/123456789/keyEvents/9999", eventName: "begin_checkout", countingMethod: "ONCE_PER_EVENT" })
    keys.push({ name: "properties/123456789/keyEvents/9999", eventName: "free_check_qualified", countingMethod: "ONCE_PER_SESSION" })

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

  it.each([
    ["browser-history page changes", "pageChangesEnabled", "ENHANCED_MEASUREMENT_ON:browser_history"],
    ["site search", "siteSearchEnabled", "ENHANCED_MEASUREMENT_ON:site_search"],
  ])("fails a stream with %s ON", (_label, field, finding) => {
    const readback = conformingReadback()
    ;(readback.enhancedMeasurementSettings as Json)[field] = true
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: [finding] })
  })

  it("treats an omitted proto3 false as OFF", () => {
    const readback = conformingReadback()
    for (const field of ["pageChangesEnabled", "siteSearchEnabled", "outboundClicksEnabled", "formInteractionsEnabled", "fileDownloadsEnabled"]) {
      delete (readback.enhancedMeasurementSettings as Json)[field]
    }
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "PASS", findings: [] })
  })

  it("fails an undecided checklist closed even on an all-OFF stream", () => {
    expect(verifyGa4AdminReadback(withOwnerPosture("undecided"), conformingReadback())).toEqual({
      status: "FAIL",
      findings: [
        "ENHANCED_MEASUREMENT_POSTURE_UNDECIDED:file_downloads",
        "ENHANCED_MEASUREMENT_POSTURE_UNDECIDED:form_interactions",
        "ENHANCED_MEASUREMENT_POSTURE_UNDECIDED:outbound_clicks",
      ],
    })
  })

  it.each([
    ["outbound clicks", "outboundClicksEnabled", "outbound_clicks"],
    ["form interactions", "formInteractionsEnabled", "form_interactions"],
    ["file downloads", "fileDownloadsEnabled", "file_downloads"],
  ])("fails a stream with %s ON when the owner's posture is OFF", (_label, field, setting) => {
    const readback = conformingReadback()
    ;(readback.enhancedMeasurementSettings as Json)[field] = true
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({
      status: "FAIL",
      findings: [`ENHANCED_MEASUREMENT_ON:${setting}`],
    })
  })

  it("passes either value of a setting the owner accepted ON", () => {
    const accepted = withOwnerPosture("on_accepted")
    const on = conformingReadback()
    for (const field of ["outboundClicksEnabled", "formInteractionsEnabled", "fileDownloadsEnabled"]) {
      ;(on.enhancedMeasurementSettings as Json)[field] = true
    }
    expect(verifyGa4AdminReadback(accepted, on)).toEqual({ status: "PASS", findings: [] })
    expect(verifyGa4AdminReadback(accepted, conformingReadback())).toEqual({ status: "PASS", findings: [] })
  })

  it("still requires browser history and site search OFF when the owner accepted the others ON", () => {
    const readback = conformingReadback()
    ;(readback.enhancedMeasurementSettings as Json).pageChangesEnabled = true
    expect(verifyGa4AdminReadback(withOwnerPosture("on_accepted"), readback)).toEqual({
      status: "FAIL",
      findings: ["ENHANCED_MEASUREMENT_ON:browser_history"],
    })
  })

  it.each([
    ["no Enhanced Measurement readback", (r: Json) => delete r.enhancedMeasurementSettings],
    ["a non-boolean setting", (r: Json) => ((r.enhancedMeasurementSettings as Json).pageChangesEnabled = "false")],
    ["a null setting", (r: Json) => ((r.enhancedMeasurementSettings as Json).siteSearchEnabled = null)],
    ["a non-boolean outbound-clicks setting", (r: Json) => ((r.enhancedMeasurementSettings as Json).outboundClicksEnabled = 0)],
    ["a null form-interactions setting", (r: Json) => ((r.enhancedMeasurementSettings as Json).formInteractionsEnabled = null)],
    ["a string file-downloads setting", (r: Json) => ((r.enhancedMeasurementSettings as Json).fileDownloadsEnabled = "true")],
    ["a readback of another resource", (r: Json) => ((r.enhancedMeasurementSettings as Json).name = "properties/1/dataStreams/2")],
    ["a readback with no resource name", (r: Json) => delete (r.enhancedMeasurementSettings as Json).name],
    ["an array body", (r: Json) => (r.enhancedMeasurementSettings = [])],
  ])("fails closed on %s", (_label, mutate) => {
    const readback = conformingReadback()
    mutate(readback)
    expect(verifyGa4AdminReadback(checklist, readback)).toEqual({ status: "FAIL", findings: ["MALFORMED_READBACK"] })
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
