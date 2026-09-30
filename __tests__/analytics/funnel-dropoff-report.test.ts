/** @jest-environment node */

/**
 * The read-only funnel drop-off report: exact GA4 Data API requests, hostile
 * and malformed responses, and the closed-schema report. Nothing here calls an
 * API: responses are data handed in.
 */
import {
  buildFunnelDropoffRequests,
  evaluateFunnelDropoff,
  FUNNEL_BREAKDOWNS,
  type FunnelDropoffRequestBundle,
  type FunnelRequestEntry,
  MIN_USERS_FOR_RATE,
} from "@/lib/analytics/funnel-dropoff-report"
import { main } from "@/scripts/ot-funnel-dropoff-report"

type Json = Record<string, unknown>
type Cell = [users: number, events: number]
/** raw bucket value → event → [users, events]; the "" bucket is the overall slice. */
type Data = Record<string, Record<string, Cell>>

const INPUT = { propertyId: "123456789", startDate: "2026-09-01", endDate: "2026-09-28" }
const HOSTILE = "jane doe 123 Main St 16-01-216-001-0000 jane@example.test cs_live_a1B2c3D4e5F6"

function bundle(): FunnelDropoffRequestBundle {
  const built = buildFunnelDropoffRequests(INPUT)
  if (!built.ok) throw new Error("fixture")
  return built.bundle
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** A response exactly as GA4 returns it for one request, from per-bucket data. */
function respond(entry: FunnelRequestEntry, data: Data, attemptUsers: Record<string, number>, metadata: Json = {}): Json {
  const dimensions = (entry.body.dimensions as Array<{ name: string }>).map((d) => d.name)
  const events = (entry.body.dimensionFilter as { filter: { inListFilter: { values: string[] } } }).filter.inListFilter.values
  const rows: Json[] = []
  for (const [bucket, perEvent] of Object.entries(data)) {
    if (entry.kind === "attempt_users") {
      const attemptEvents = (perEvent.begin_checkout?.[1] ?? 0) + (perEvent.checkout_blocked?.[1] ?? 0)
      if (attemptEvents === 0) continue
      rows.push({
        dimensionValues: dimensions.map(() => ({ value: bucket })),
        metricValues: [{ value: String(attemptUsers[bucket]) }, { value: String(attemptEvents) }],
      })
      continue
    }
    for (const [event, [users, count]] of Object.entries(perEvent)) {
      if (!events.includes(event)) continue
      rows.push({
        dimensionValues: dimensions.map((name) => ({ value: name === "eventName" ? event : bucket })),
        metricValues: [{ value: String(users) }, { value: String(count) }],
      })
    }
  }
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: [
      { name: "totalUsers", type: "TYPE_INTEGER" },
      { name: "eventCount", type: "TYPE_INTEGER" },
    ],
    rows,
    rowCount: rows.length,
    metadata: { currencyCode: "USD", timeZone: "America/Chicago", ...metadata },
    kind: "analyticsData#runReport",
  }
}

const OVERALL: Record<string, Cell> = {
  session_start: [1000, 1300],
  free_check_started: [400, 450],
  free_check_completed: [300, 330],
  free_check_qualified: [120, 125],
  begin_checkout: [40, 42],
  checkout_blocked: [25, 30],
  purchase: [20, 20],
}

/** One data set per slice. Unlisted slices get the overall numbers under a closed bucket. */
function responsesFor(
  b: FunnelDropoffRequestBundle,
  perSlice: Record<string, { data: Data; attempt: Record<string, number>; metadata?: Json }> = {},
): Json[] {
  const defaults: Record<string, string> = {
    overall: "",
    campaign_source: "google",
    campaign_medium: "cpc",
    campaign_name: "(not set)",
    campaign_content: "(not set)",
    landing_route: "/check",
    device_category: "mobile",
    free_check_surface: "check_page",
    free_check_input_mode: "pin",
    free_check_outcome: "supportive",
    checkout_plan: "T2",
    checkout_blocked_reason: "acknowledgment_required",
  }
  return b.requests.map((entry) => {
    const slice = perSlice[entry.slice] ?? { data: { [defaults[entry.slice]]: OVERALL }, attempt: { [defaults[entry.slice]]: 55 } }
    return respond(entry, slice.data, slice.attempt, slice.metadata)
  })
}

function slice(report: ReturnType<typeof evaluateFunnelDropoff>, key: string) {
  const found = report.slices.find((s) => s.breakdown === key)
  if (!found) throw new Error(`no slice ${key}`)
  return found
}

describe("request bundle", () => {
  it("is one events request per breakdown plus an attempt-users request where the attempt step applies", () => {
    const b = bundle()
    expect(b.contract).toBe("ot-funnel-dropoff-report-v1")
    expect(b.funnel_contract_version).toBe("ot-funnel-contract-v2")
    expect(b.oauth_scope).toBe("https://www.googleapis.com/auth/analytics.readonly")
    expect(b.requests.map((r) => `${r.slice}:${r.kind}`)).toEqual(
      FUNNEL_BREAKDOWNS.flatMap((breakdown) => [
        `${breakdown.key}:events`,
        ...(breakdown.steps.includes("checkout_attempt") ? [`${breakdown.key}:attempt_users`] : []),
      ]),
    )
    expect(b.requests).toHaveLength(21)
    for (const request of b.requests) {
      expect(request.method).toBe("POST")
      expect(request.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport")
    }
  })

  it("builds the exact overall and attempt requests", () => {
    const [overall, attempt] = bundle().requests
    expect(overall.body).toEqual({
      dateRanges: [{ startDate: "2026-09-01", endDate: "2026-09-28" }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "totalUsers" }, { name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: [
              "begin_checkout",
              "checkout_blocked",
              "free_check_completed",
              "free_check_qualified",
              "free_check_started",
              "purchase",
              "session_start",
            ],
            caseSensitive: true,
          },
        },
      },
      keepEmptyRows: false,
      limit: 10000,
      returnPropertyQuota: false,
    })
    expect(attempt.body.dimensions).toEqual([])
    expect(attempt.body.dimensionFilter).toEqual({
      filter: { fieldName: "eventName", inListFilter: { values: ["begin_checkout", "checkout_blocked"], caseSensitive: true } },
    })
  })

  it("asks only for the registered custom parameters and governed session dimensions", () => {
    const dims = new Set(bundle().requests.flatMap((r) => (r.body.dimensions as Array<{ name: string }>).map((d) => d.name)))
    expect(Array.from(dims).sort()).toEqual([
      "customEvent:blocked_reason",
      "customEvent:input_mode",
      "customEvent:outcome_code",
      "customEvent:plan",
      "customEvent:surface",
      "deviceCategory",
      "eventName",
      "landingPage",
      "sessionCampaignName",
      "sessionManualAdContent",
      "sessionMedium",
      "sessionSource",
    ])
  })

  it.each([
    ["a non-object", null, "NOT_AN_OBJECT"],
    ["an unknown field", { ...INPUT, note: HOSTILE }, "UNKNOWN_FIELD"],
    ["a malformed property", { ...INPUT, propertyId: "G-ABC123" }, "INVALID_PROPERTY_ID"],
    ["a rolled-over date", { ...INPUT, endDate: "2026-02-30" }, "INVALID_DATE_RANGE"],
    ["a reversed range", { ...INPUT, startDate: "2026-09-29" }, "INVALID_DATE_RANGE"],
    ["a range over a year", { ...INPUT, startDate: "2025-01-01" }, "INVALID_DATE_RANGE"],
  ])("refuses %s", (_label, input, violation) => {
    const built = buildFunnelDropoffRequests(input)
    expect(built.ok).toBe(false)
    expect(built.ok ? [] : built.violations).toContain(violation)
  })

  it("reads the input once, so a getter cannot pass validation and change the request", () => {
    let reads = 0
    const input = {
      ...INPUT,
      get propertyId() {
        reads += 1
        return reads === 1 ? "123456789" : "1/../../x"
      },
    }
    const built = buildFunnelDropoffRequests(input)
    expect(built.ok && built.bundle.requests[0].url).toBe(
      "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
    )
  })
})

describe("report", () => {
  it("computes per-step users, events, conversion and drop-off for the overall funnel", () => {
    const b = bundle()
    const report = evaluateFunnelDropoff(b, responsesFor(b))
    expect(report.status).toBe("OK")
    expect(report.reasons).toEqual([])
    expect(report.date_range).toEqual({ start_date: "2026-09-01", end_date: "2026-09-28" })
    expect(report.evidence_class).toBe("ga4_behavioral_observational")
    expect(report.payment_authority).toBe("stripe_order_ledger_not_included")
    expect(report.causal_claims).toBe("none")

    const steps = slice(report, "overall").buckets[0].steps
    expect(slice(report, "overall").buckets.map((bucket) => bucket.bucket)).toEqual(["all"])
    expect(steps.map((s) => [s.step, s.users, s.events, s.conversion_from_previous, s.dropoff_users, s.dropoff_rate, s.state])).toEqual([
      ["landing_session", 1000, 1300, null, null, null, "FIRST_STEP"],
      ["free_check_started", 400, 450, 0.4, 600, 0.6, "OK"],
      ["free_check_completed", 300, 330, 0.75, 100, 0.25, "OK"],
      ["free_check_qualified", 120, 125, 0.4, 180, 0.6, "OK"],
      ["checkout_attempt", 55, 72, 0.4583, 65, 0.5417, "OK"],
      ["begin_checkout", 40, 42, 0.7273, 15, 0.2727, "OK"],
      ["purchase", 20, 20, 0.5, 20, 0.5, "OK"],
    ])
    expect(steps.map((s) => s.conversion_from_first)).toEqual([null, 0.4, 0.3, 0.12, 0.055, 0.04, 0.02])
  })

  it("states insufficient evidence instead of a rate over too few users", () => {
    const b = bundle()
    const small: Record<string, Cell> = { ...OVERALL, free_check_qualified: [MIN_USERS_FOR_RATE - 1, 29], begin_checkout: [5, 5] }
    const report = evaluateFunnelDropoff(b, responsesFor(b, { overall: { data: { "": small }, attempt: { "": 7 } } }))
    const steps = slice(report, "overall").buckets[0].steps
    const attempt = steps.find((s) => s.step === "checkout_attempt")!
    expect(attempt.state).toBe("INSUFFICIENT_EVIDENCE")
    expect(attempt.conversion_from_previous).toBeNull()
    expect(attempt.dropoff_rate).toBeNull()
    const begin = steps.find((s) => s.step === "begin_checkout")!
    expect(begin.state).toBe("INSUFFICIENT_EVIDENCE")
  })

  it("reports a later step larger than an earlier one as aggregate counts, not a negative drop-off", () => {
    const b = bundle()
    const direct: Record<string, Cell> = { ...OVERALL, free_check_qualified: [40, 40] }
    const report = evaluateFunnelDropoff(b, responsesFor(b, { overall: { data: { "": direct }, attempt: { "": 55 } } }))
    const attempt = slice(report, "overall").buckets[0].steps.find((s) => s.step === "checkout_attempt")!
    expect(attempt.state).toBe("STEP_EXCEEDS_PREVIOUS")
    expect(attempt.dropoff_users).toBeNull()
    expect(report.step_basis).toBe("aggregate_counts_not_paths")
  })

  it("maps every GA4 dimension value to a closed bucket and never echoes a hostile one", () => {
    const b = bundle()
    const hostileData: Data = {
      google: OVERALL,
      "l.facebook.com": OVERALL,
      [HOSTILE]: OVERALL,
      "partner.example.test": OVERALL,
      "(direct)": OVERALL,
    }
    const attempt = { google: 55, "l.facebook.com": 55, [HOSTILE]: 55, "partner.example.test": 55, "(direct)": 55 }
    const landing: Data = { "/check": OVERALL, "/(other)": OVERALL, "/clients/jane-doe-123-main-st": OVERALL, "(not set)": OVERALL }
    const landingAttempt = { "/check": 55, "/(other)": 55, "/clients/jane-doe-123-main-st": 55, "(not set)": 55 }
    const campaign: Data = { ot_202610_acq_synthappeal: OVERALL, [HOSTILE]: OVERALL }
    const report = evaluateFunnelDropoff(
      b,
      responsesFor(b, {
        campaign_source: { data: hostileData, attempt },
        landing_route: { data: landing, attempt: landingAttempt },
        campaign_name: { data: campaign, attempt: { ot_202610_acq_synthappeal: 55, [HOSTILE]: 55 } },
        free_check_surface: { data: { check_page: OVERALL, [HOSTILE]: OVERALL }, attempt: {} },
      }),
    )
    expect(report.status).toBe("OK")
    expect(slice(report, "campaign_source").buckets.map((bucket) => bucket.bucket)).toEqual([
      "(direct)",
      "google",
      "l.facebook.com",
      "other",
    ])
    expect(slice(report, "landing_route").buckets.map((bucket) => bucket.bucket)).toEqual([
      "(not set)",
      "/(other)",
      "/check",
      "other",
    ])
    // A synthetic slug is not an owner-approved campaign.
    expect(slice(report, "campaign_name").buckets.map((bucket) => bucket.bucket)).toEqual(["other"])
    expect(slice(report, "free_check_surface").buckets.map((bucket) => bucket.bucket)).toEqual(["check_page", "other"])

    // Two raw values merged into "other": users are not additive, events are.
    const other = slice(report, "campaign_source").buckets.find((bucket) => bucket.bucket === "other")!
    const started = other.steps.find((s) => s.step === "free_check_started")!
    expect(started.users).toBeNull()
    expect(started.events).toBe(900)
    expect(started.state).toBe("USERS_NOT_ADDITIVE")

    const text = JSON.stringify(report).toLowerCase()
    for (const marker of ["jane", "main st", "16-01-216", "example", "cs_live", "partner", "synthappeal"]) {
      expect(text).not.toContain(marker)
    }
  })

  it("limits each breakdown to the steps its parameter is carried on", () => {
    const b = bundle()
    const report = evaluateFunnelDropoff(b, responsesFor(b))
    const stepsOf = (key: string) => slice(report, key).buckets[0].steps.map((s) => s.step)
    expect(stepsOf("free_check_surface")).toEqual(["free_check_started", "free_check_completed", "free_check_qualified"])
    expect(stepsOf("free_check_input_mode")).toEqual(["free_check_started"])
    expect(stepsOf("free_check_outcome")).toEqual(["free_check_completed", "free_check_qualified"])
    expect(stepsOf("checkout_plan")).toEqual(["checkout_attempt", "begin_checkout"])
    expect(stepsOf("checkout_blocked_reason")).toEqual(["checkout_attempt"])
  })

  it.each([
    ["thresholded", { subjectToThresholding: true }, "THRESHOLDED"],
    ["sampled", { samplingMetadatas: [{ samplesReadCount: "1", samplingSpaceSize: "2" }] }, "SAMPLED"],
    ["(other)-collapsed", { dataLossFromOtherRow: true }, "OTHER_ROW"],
  ])("marks a %s slice INCONCLUSIVE and states no rates for it", (_label, metadata, reason) => {
    const b = bundle()
    const report = evaluateFunnelDropoff(
      b,
      responsesFor(b, { device_category: { data: { mobile: OVERALL }, attempt: { mobile: 55 }, metadata } }),
    )
    expect(report.status).toBe("INCONCLUSIVE")
    expect(report.reasons).toEqual([`${reason}:device_category`])
    const device = slice(report, "device_category")
    expect(device.evidence).toBe("INSUFFICIENT_EVIDENCE")
    for (const step of device.buckets[0].steps) {
      expect(step.conversion_from_previous).toBeNull()
      expect(step.conversion_from_first).toBeNull()
      expect(step.state).toBe("SLICE_INCONCLUSIVE")
    }
    expect(slice(report, "overall").evidence).toBe("OK")
  })

  it("marks a truncated response INCONCLUSIVE", () => {
    const b = bundle()
    const responses = responsesFor(b)
    responses[0].rowCount = 100
    const report = evaluateFunnelDropoff(b, responses)
    expect(report.status).toBe("INCONCLUSIVE")
    expect(report.reasons).toEqual(["ROWS_TRUNCATED:overall"])
  })

  it("carries no revenue, value, identifier or free-text field", () => {
    const b = bundle()
    const report = evaluateFunnelDropoff(b, responsesFor(b))
    expect(Object.keys(report).sort()).toEqual([
      "causal_claims",
      "date_range",
      "evidence_class",
      "funnel_contract_version",
      "min_users_for_rate",
      "payment_authority",
      "reasons",
      "schema",
      "slices",
      "status",
      "step_basis",
      "steps",
      "version",
    ])
    expect(JSON.stringify(report)).not.toMatch(/revenue|"value"|transaction|123456789|client_id|session_id/)
  })
})

describe("hostile and malformed responses fail the whole report closed", () => {
  function mutated(mutate: (responses: Json[], b: FunnelDropoffRequestBundle) => unknown) {
    const b = bundle()
    const responses = responsesFor(b)
    const replaced = mutate(responses, b)
    return evaluateFunnelDropoff(b, replaced === undefined ? responses : replaced)
  }

  const rows = (response: Json) => response.rows as Json[]

  it.each([
    ["an unknown response field", (r: Json[]) => void (r[0].debug = HOSTILE), "UNKNOWN_FIELD:overall:events"],
    ["wrong dimension headers", (r: Json[]) => void (r[0].dimensionHeaders = [{ name: "pagePath" }]), "HEADERS:overall:events"],
    ["wrong metric headers", (r: Json[]) => void (r[0].metricHeaders = [{ name: "totalRevenue", type: "TYPE_CURRENCY" }]), "HEADERS:overall:events"],
    ["a fractional count", (r: Json[]) => void ((rows(r[0])[0].metricValues as Json[])[0] = { value: "1.5" }), "BAD_COUNT:overall:events"],
    ["a negative count", (r: Json[]) => void ((rows(r[0])[0].metricValues as Json[])[1] = { value: "-3" }), "BAD_COUNT:overall:events"],
    ["an exponent count", (r: Json[]) => void ((rows(r[0])[0].metricValues as Json[])[1] = { value: "1e9" }), "BAD_COUNT:overall:events"],
    ["an unrequested event", (r: Json[]) => void ((rows(r[0])[0].dimensionValues as Json[])[0] = { value: "refund" }), "FILTER_NOT_HONORED:overall:events"],
    [
      "a duplicated row",
      (r: Json[]) => {
        rows(r[0]).push(clone(rows(r[0])[0]))
        r[0].rowCount = rows(r[0]).length
      },
      "DUPLICATE_ROW:overall:events",
    ],
    ["an extra row key", (r: Json[]) => void (rows(r[0])[0].note = HOSTILE), "ROW_SHAPE:overall:events"],
    ["a non-string dimension value", (r: Json[]) => void ((rows(r[2])[0].dimensionValues as Json[])[1] = { value: 7 }), "ROW_SHAPE:campaign_source:events"],
    ["a short row", (r: Json[]) => void ((rows(r[2])[0].dimensionValues as Json[]).pop()), "ROW_SHAPE:campaign_source:events"],
    ["a row count below the rows returned", (r: Json[]) => void (r[0].rowCount = 0), "ROW_COUNT:overall:events"],
    ["a non-object response", (r: Json[]) => void (r[1] = [] as unknown as Json), "NOT_AN_OBJECT:overall:attempt_users"],
    ["one response too few", (r: Json[]) => r.slice(1), "RESPONSE_COUNT"],
    ["not an array", () => ({ 0: {} }), "RESPONSE_COUNT"],
  ])("refuses %s", (_label, mutate, reason) => {
    const report = mutated(mutate as (responses: Json[], b: FunnelDropoffRequestBundle) => unknown)
    expect(report.status).toBe("INVALID_RESPONSE")
    expect(report.reasons).toEqual([reason])
    expect(report.slices).toEqual([])
    expect(JSON.stringify(report)).not.toContain("jane")
  })

  /** Apply one mutation to every response, as a lossy save tool would. */
  const everyResponse = (mutate: (response: Json) => void) => (r: Json[]) => void r.forEach(mutate)
  const setMetadata = (key: string, value: unknown) =>
    everyResponse((response) => void ((response.metadata as Json)[key] = value))

  // B1: the quality evidence is the only input that decides whether a rate may
  // be stated, so any shape GA4 could not have sent refuses the whole report.
  it.each([
    ["a string subjectToThresholding", setMetadata("subjectToThresholding", "true"), "METADATA_THRESHOLDING"],
    ["a numeric subjectToThresholding", setMetadata("subjectToThresholding", 1), "METADATA_THRESHOLDING"],
    ["a null subjectToThresholding", setMetadata("subjectToThresholding", null), "METADATA_THRESHOLDING"],
    ["an object samplingMetadatas", setMetadata("samplingMetadatas", { samplesReadCount: "1" }), "METADATA_SAMPLING"],
    ["a string samplingMetadatas", setMetadata("samplingMetadatas", "sampled"), "METADATA_SAMPLING"],
    ["a non-object sampling entry", setMetadata("samplingMetadatas", ["1"]), "METADATA_SAMPLING"],
    ["an empty sampling entry", setMetadata("samplingMetadatas", [{}]), "METADATA_SAMPLING"],
    ["a sampling entry missing its space size", setMetadata("samplingMetadatas", [{ samplesReadCount: "1" }]), "METADATA_SAMPLING"],
    ["a numeric sampling count", setMetadata("samplingMetadatas", [{ samplesReadCount: 1, samplingSpaceSize: "2" }]), "METADATA_SAMPLING"],
    ["a non-decimal sampling count", setMetadata("samplingMetadatas", [{ samplesReadCount: "1e3", samplingSpaceSize: "2000" }]), "METADATA_SAMPLING"],
    ["more samples read than the space", setMetadata("samplingMetadatas", [{ samplesReadCount: "30", samplingSpaceSize: "4" }]), "METADATA_SAMPLING"],
    ["an unknown sampling key", setMetadata("samplingMetadatas", [{ samplesReadCount: "1", samplingSpaceSize: "2", note: HOSTILE }]), "METADATA_SAMPLING"],
    ["a string dataLossFromOtherRow", setMetadata("dataLossFromOtherRow", "true"), "METADATA_OTHER_ROW"],
    ["a numeric dataLossFromOtherRow", setMetadata("dataLossFromOtherRow", 1), "METADATA_OTHER_ROW"],
    ["absent metadata", everyResponse((response) => void delete response.metadata), "METADATA_SHAPE"],
    ["null metadata", everyResponse((response) => void (response.metadata = null)), "METADATA_SHAPE"],
    ["array metadata", everyResponse((response) => void (response.metadata = [])), "METADATA_SHAPE"],
    ["string metadata", everyResponse((response) => void (response.metadata = "{}")), "METADATA_SHAPE"],
    ["an unknown metadata key", setMetadata("zzz", 1), "METADATA_UNKNOWN_FIELD"],
    ["a renamed thresholding key", setMetadata("subject_to_thresholding", true), "METADATA_UNKNOWN_FIELD"],
    ["a lowercase currency code", setMetadata("currencyCode", "usd"), "METADATA_CURRENCY"],
    ["a numeric currency code", setMetadata("currencyCode", 840), "METADATA_CURRENCY"],
    ["a malformed time zone", setMetadata("timeZone", "America/Chicago; DROP"), "METADATA_TIME_ZONE"],
    ["an empty time zone", setMetadata("timeZone", ""), "METADATA_TIME_ZONE"],
    ["a non-string time zone", setMetadata("timeZone", -5), "METADATA_TIME_ZONE"],
    ["a non-string emptyReason", setMetadata("emptyReason", true), "METADATA_EMPTY_REASON"],
    ["an emptyReason on a response with rows", setMetadata("emptyReason", "DATA_NOT_AVAILABLE"), "METADATA_EMPTY_REASON"],
    ["a non-object schemaRestrictionResponse", setMetadata("schemaRestrictionResponse", "none"), "METADATA_SCHEMA_RESTRICTION"],
    [
      "an active metric restriction",
      setMetadata("schemaRestrictionResponse", { activeMetricRestrictions: [{ metricName: "eventCount", restrictedMetricTypes: ["REVENUE_DATA"] }] }),
      "METADATA_SCHEMA_RESTRICTION",
    ],
    ["a non-array metric restriction list", setMetadata("schemaRestrictionResponse", { activeMetricRestrictions: {} }), "METADATA_SCHEMA_RESTRICTION"],
    ["an unknown schema restriction key", setMetadata("schemaRestrictionResponse", { zzz: [] }), "METADATA_SCHEMA_RESTRICTION"],
    ["an absent rowCount with rows", everyResponse((response) => void delete response.rowCount), "ROW_COUNT"],
    ["a string rowCount", everyResponse((response) => void (response.rowCount = String(response.rowCount))), "ROW_COUNT"],
    ["a foreign kind", everyResponse((response) => void (response.kind = "evil")), "KIND"],
    ["a non-string kind", everyResponse((response) => void (response.kind = 1)), "KIND"],
    ["a property quota although none was requested", everyResponse((response) => void (response.propertyQuota = { tokensPerDay: { consumed: 1 } })), "PROPERTY_QUOTA"],
    ["an empty property quota object", everyResponse((response) => void (response.propertyQuota = {})), "PROPERTY_QUOTA"],
    ["totals although no aggregation was requested", everyResponse((response) => void (response.totals = [{ junk: "jane@example.com" }])), "AGGREGATES"],
    ["maximums although no aggregation was requested", everyResponse((response) => void (response.maximums = [{}])), "AGGREGATES"],
    ["minimums although no aggregation was requested", everyResponse((response) => void (response.minimums = [{}])), "AGGREGATES"],
    ["non-array totals", everyResponse((response) => void (response.totals = {})), "AGGREGATES"],
    ["null totals", everyResponse((response) => void (response.totals = null)), "AGGREGATES"],
    [
      "the reviewed kind + totals + quota combination",
      everyResponse((response) => {
        response.kind = "evil"
        response.totals = [{ junk: "jane@example.com" }]
        response.propertyQuota = { tokensPerDay: { consumed: 1 } }
      }),
      "KIND",
    ],
  ])("refuses %s", (_label, mutate, code) => {
    const report = mutated(mutate as (responses: Json[], b: FunnelDropoffRequestBundle) => unknown)
    expect(report.status).toBe("INVALID_RESPONSE")
    expect(report.reasons).toEqual([`${code}:overall:events`])
    expect(report.slices).toEqual([])
    expect(report.date_range).toBeNull()
    expect(JSON.stringify(report)).not.toMatch(/jane|conversion|dropoff_rate/)
  })

  it("refuses malformed quality evidence on a later response too, not only the first", () => {
    const report = mutated((r) => void ((r[r.length - 1].metadata as Json).subjectToThresholding = "true"))
    expect(report.status).toBe("INVALID_RESPONSE")
    expect(report.reasons).toEqual(["METADATA_THRESHOLDING:checkout_blocked_reason:attempt_users"])
    expect(report.slices).toEqual([])
  })

  it("does not let a stringified thresholding flag state rates for a slice", () => {
    // The B1 reproduction: the slice GA4 thresholded must never come back OK.
    const b = bundle()
    const responses = responsesFor(b, {
      device_category: { data: { mobile: OVERALL }, attempt: { mobile: 55 }, metadata: { subjectToThresholding: "true" } },
    })
    const report = evaluateFunnelDropoff(b, responses)
    expect(report.status).toBe("INVALID_RESPONSE")
    expect(report.reasons).toEqual(["METADATA_THRESHOLDING:device_category:events"])
    expect(report.slices).toEqual([])
  })
  it("refuses a bundle this module did not produce", () => {
    const b = clone(bundle())
    ;(b.requests[0].body as Json).dimensions = [{ name: "eventName" }, { name: "pagePathPlusQueryString" }]
    expect(evaluateFunnelDropoff(b, responsesFor(bundle())).reasons).toEqual(["BUNDLE_NOT_FROM_CONTRACT"])
    expect(evaluateFunnelDropoff(null, []).reasons).toEqual(["BUNDLE_NOT_FROM_CONTRACT"])
  })

  it("reads responses once: a getter cannot answer validation and the report differently", () => {
    const b = bundle()
    const responses = responsesFor(b)
    const row = rows(responses[0])[0]
    let reads = 0
    Object.defineProperty(row, "metricValues", {
      enumerable: true,
      get() {
        reads += 1
        return reads === 1 ? [{ value: "400" }, { value: "450" }] : [{ value: HOSTILE }, { value: "x" }]
      },
    })
    const report = evaluateFunnelDropoff(b, responses)
    expect(report.status).toBe("OK")
    expect(JSON.stringify(report)).not.toContain("jane")
  })

  it("reads responses once: a metadata getter cannot hide thresholding from the quality check", () => {
    const b = bundle()
    const responses = responsesFor(b)
    let reads = 0
    Object.defineProperty(responses[0], "metadata", {
      enumerable: true,
      get() {
        reads += 1
        return reads === 1 ? { subjectToThresholding: true } : {}
      },
    })
    const report = evaluateFunnelDropoff(b, responses)
    expect(report.status).toBe("INCONCLUSIVE")
    expect(report.reasons).toEqual(["THRESHOLDED:overall"])
  })

  it("refuses a throwing getter as unreadable input", () => {
    const b = bundle()
    const responses = responsesFor(b)
    Object.defineProperty(responses[0], "rows", {
      enumerable: true,
      get() {
        throw new Error(HOSTILE)
      },
    })
    const report = evaluateFunnelDropoff(b, responses)
    expect(report.status).toBe("INVALID_RESPONSE")
    expect(JSON.stringify(report)).not.toContain("jane")
  })

  it("treats a __proto__ dimension value as an ordinary unknown value", () => {
    const b = bundle()
    const report = evaluateFunnelDropoff(
      b,
      responsesFor(b, { campaign_source: { data: { ["__proto__"]: OVERALL }, attempt: { ["__proto__"]: 55 } } }),
    )
    expect(report.status).toBe("OK")
    expect(slice(report, "campaign_source").buckets.map((bucket) => bucket.bucket)).toEqual(["other"])
  })
})

describe("official GA4 response shapes the request can produce are accepted", () => {
  function evaluated(mutate: (response: Json, index: number) => void) {
    const b = bundle()
    const responses = responsesFor(b)
    responses.forEach(mutate)
    return evaluateFunnelDropoff(b, responses)
  }

  it.each([
    ["the currency and time zone GA4 always sends", () => undefined],
    ["an empty metadata object", (r: Json) => void (r.metadata = {})],
    [
      "every clean metadata field with default values written out",
      (r: Json) =>
        void (r.metadata = {
          currencyCode: "EUR",
          timeZone: "America/Argentina/Buenos_Aires",
          subjectToThresholding: false,
          samplingMetadatas: [],
          dataLossFromOtherRow: false,
          emptyReason: "",
          schemaRestrictionResponse: {},
        }),
    ],
    ["an empty metric restriction list", (r: Json) => void ((r.metadata as Json).schemaRestrictionResponse = { activeMetricRestrictions: [] })],
    ["a UTC time zone", (r: Json) => void ((r.metadata as Json).timeZone = "UTC")],
    ["an Etc offset time zone", (r: Json) => void ((r.metadata as Json).timeZone = "Etc/GMT+5")],
    ["an absent kind", (r: Json) => void delete r.kind],
    ["a null property quota", (r: Json) => void (r.propertyQuota = null)],
    [
      "empty totals, maximums and minimums",
      (r: Json) => {
        r.totals = []
        r.maximums = []
        r.minimums = []
      },
    ],
  ])("accepts %s as clean evidence", (_label, mutate) => {
    const report = evaluated(mutate as (response: Json, index: number) => void)
    expect(report.status).toBe("OK")
    expect(report.reasons).toEqual([])
    const steps = slice(report, "overall").buckets[0].steps
    expect(steps.find((s) => s.step === "free_check_started")!.conversion_from_previous).toBe(0.4)
  })

  it("marks a sampled slice INCONCLUSIVE when the sampling entry is well formed", () => {
    const report = evaluated((r, index) => {
      if (index === 0) (r.metadata as Json).samplingMetadatas = [{ samplesReadCount: "4", samplingSpaceSize: "4" }]
    })
    expect(report.status).toBe("INCONCLUSIVE")
    expect(report.reasons).toEqual(["SAMPLED:overall"])
  })

  it.each([
    ["with rows and rowCount omitted", (r: Json) => {
      delete r.rows
      delete r.rowCount
    }],
    ["with an empty rows array and rowCount 0", (r: Json) => {
      r.rows = []
      r.rowCount = 0
    }],
    ["with an empty rows array and no rowCount", (r: Json) => {
      r.rows = []
      delete r.rowCount
    }],
  ])("accepts a valid empty response %s", (_label, mutate) => {
    const report = evaluated(mutate as (response: Json, index: number) => void)
    expect(report.status).toBe("OK")
    expect(report.reasons).toEqual([])
    for (const s of report.slices) {
      expect(s.evidence).toBe("OK")
      expect(s.buckets).toEqual([])
    }
  })

  it("treats an empty response with a stated empty reason as inconclusive, not as zero", () => {
    const report = evaluated((r, index) => {
      if (index !== 0) return
      delete r.rows
      delete r.rowCount
      ;(r.metadata as Json).emptyReason = "DATA_NOT_AVAILABLE"
    })
    expect(report.status).toBe("INCONCLUSIVE")
    expect(report.reasons).toEqual(["EMPTY_REASON:overall"])
    expect(slice(report, "overall").evidence).toBe("INSUFFICIENT_EVIDENCE")
    expect(JSON.stringify(report)).not.toContain("DATA_NOT_AVAILABLE")
  })
})

describe("CLI", () => {
  function io(files: Record<string, string> = {}) {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      io: {
        out: (text: string) => out.push(text),
        err: (text: string) => err.push(text),
        readFile: (path: string) => {
          if (!(path in files)) throw new Error("ENOENT")
          return files[path]
        },
      },
    }
  }

  it("prints the request bundle and turns saved responses into the report", () => {
    const first = io()
    expect(main(["requests", "--property-id", "123456789", "--start", "2026-09-01", "--end", "2026-09-28"], first.io)).toBe(0)
    const printed = JSON.parse(first.out.join(""))
    expect(printed).toEqual(bundle())

    const second = io({ "bundle.json": first.out.join(""), "responses.json": JSON.stringify(responsesFor(bundle())) })
    expect(main(["report", "--bundle", "bundle.json", "--responses", "responses.json"], second.io)).toBe(0)
    expect(JSON.parse(second.out.join("")).status).toBe("OK")
  })

  it("exits non-zero on invalid input, unreadable files and bad usage", () => {
    const bad = io()
    expect(main(["requests", "--property-id", "x", "--start", "2026-09-01", "--end", "2026-09-28"], bad.io)).toBe(2)
    const missing = io()
    expect(main(["report", "--bundle", "nope.json", "--responses", "nope.json"], missing.io)).toBe(2)
    expect(JSON.parse(missing.out.join("")).status).toBe("INVALID_RESPONSE")
    expect(main(["report", "--bundle", "a"], io().io)).toBe(64)
    expect(main(["requests", "--property-id", "1", "--property-id", "2", "--start", "x"], io().io)).toBe(64)
    expect(main(["write"], io().io)).toBe(64)
  })
})
