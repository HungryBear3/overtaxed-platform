/**
 * Read-only funnel drop-off diagnostics: request contract, response
 * validation and a closed-schema report.
 *
 *   - `buildFunnelDropoffRequests` produces the exact GA4 Data API `runReport`
 *     requests for one property and date range: per slice (overall, or one
 *     breakdown), event counts and users per funnel event, plus — where the
 *     slice includes the checkout-attempt step — the de-duplicated users who
 *     emitted either `begin_checkout` or `checkout_blocked`. It sends nothing.
 *   - `evaluateFunnelDropoff` validates one response per request and builds a
 *     versioned report: per step users and events, conversion from the
 *     previous step and from the first, drop-off count and rate, and explicit
 *     insufficient-evidence states.
 *
 * Every label in the report is from a closed list. A dimension value GA4
 * returns — a source, a campaign, a landing page, a custom parameter — is
 * mapped to its governed value or to `other`, never echoed, so a hostile or
 * mistyped value that reached GA4 cannot reach the report.
 *
 * The steps are aggregate counts, not a path: a visitor can start checkout
 * without a free check, so a later step can exceed an earlier one, and that is
 * reported as such rather than as a negative drop-off. Nothing here supports a
 * causal claim. GA4 is behavioral evidence only; paid orders and revenue are
 * the Stripe/order ledger's, and no revenue figure appears in the report.
 *
 * Pure: no network, no credentials, no environment reads.
 */

import { isAllowlistedLanding } from "@/lib/attribution/landing-paths"
import { CHECKOUT_BLOCKED_REASONS } from "./checkout-funnel"
import { FREE_CHECK_OUTCOME_MATRIX } from "@/lib/free-check-outcome-contract"
import { CAMPAIGN_MEDIUMS, CAMPAIGN_SOURCES, campaignIssues, contentIssues } from "./campaign-governance"
import { FREE_CHECK_INPUT_MODES, FREE_CHECK_SURFACES } from "./free-check-funnel"
import { CHECKOUT_TIERS, FUNNEL_CONTRACT_VERSION } from "./funnel-contract"
import { referrerHostSource, UNLISTED_PAGE_PATH } from "./ga4"

export const FUNNEL_DROPOFF_REPORT_VERSION = "ot-funnel-dropoff-report-v1"

const DATA_API_READ_ONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const PROPERTY_ID_PATTERN = /^[1-9]\d{5,11}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const COUNT_PATTERN = /^(?:0|[1-9]\d{0,11})$/
const MAX_RANGE_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000
const ROW_LIMIT = 10_000

/** A rate is not stated over fewer users than this. */
export const MIN_USERS_FOR_RATE = 30

export const FUNNEL_STEPS = [
  { step: "landing_session", events: ["session_start"] },
  { step: "free_check_started", events: ["free_check_started"] },
  { step: "free_check_completed", events: ["free_check_completed"] },
  { step: "free_check_qualified", events: ["free_check_qualified"] },
  { step: "checkout_attempt", events: ["begin_checkout", "checkout_blocked"] },
  { step: "begin_checkout", events: ["begin_checkout"] },
  { step: "purchase", events: ["purchase"] },
] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]["step"]

const ATTEMPT_EVENTS = ["begin_checkout", "checkout_blocked"] as const

/** GA4 placeholder values, reported under their own names. */
const GA_SENTINELS = ["(not set)", "(direct)", "(none)", "(organic)", "(referral)"] as const

type Mapper = (raw: string) => string

const within = (values: readonly string[]): Mapper => (raw) =>
  values.includes(raw) || (GA_SENTINELS as readonly string[]).includes(raw) ? raw : "other"

const OUTCOME_CODES = Array.from(new Set(FREE_CHECK_OUTCOME_MATRIX.map((row) => row.code as string)))

type Breakdown = { key: string; dimension: string | null; steps: readonly FunnelStep[]; map: Mapper }

const ALL_STEPS: readonly FunnelStep[] = FUNNEL_STEPS.map((entry) => entry.step)

export const FUNNEL_BREAKDOWNS: readonly Breakdown[] = [
  { key: "overall", dimension: null, steps: ALL_STEPS, map: () => "all" },
  {
    key: "campaign_source",
    dimension: "sessionSource",
    steps: ALL_STEPS,
    // A referral's source is its host. Only allowlisted hosts (./ga4) are kept,
    // under their own name, so buckets are never merged across raw values.
    map: (raw) => (referrerHostSource(raw) ? raw : within(CAMPAIGN_SOURCES)(raw)),
  },
  { key: "campaign_medium", dimension: "sessionMedium", steps: ALL_STEPS, map: within(CAMPAIGN_MEDIUMS) },
  {
    key: "campaign_name",
    dimension: "sessionCampaignName",
    steps: ALL_STEPS,
    map: (raw) => (campaignIssues(raw, "owner_approved").length === 0 ? raw : within([])(raw)),
  },
  {
    key: "campaign_content",
    dimension: "sessionManualAdContent",
    steps: ALL_STEPS,
    map: (raw) => (contentIssues(raw).length === 0 ? raw : within([])(raw)),
  },
  {
    key: "landing_route",
    dimension: "landingPage",
    steps: ALL_STEPS,
    map: (raw) => (isAllowlistedLanding(raw) || raw === UNLISTED_PAGE_PATH ? raw : within([])(raw)),
  },
  {
    key: "device_category",
    dimension: "deviceCategory",
    steps: ALL_STEPS,
    map: within(["desktop", "mobile", "tablet", "smart tv"]),
  },
  {
    key: "free_check_surface",
    dimension: "customEvent:surface",
    steps: ["free_check_started", "free_check_completed", "free_check_qualified"],
    map: within(FREE_CHECK_SURFACES),
  },
  {
    key: "free_check_input_mode",
    dimension: "customEvent:input_mode",
    steps: ["free_check_started"],
    map: within(FREE_CHECK_INPUT_MODES),
  },
  {
    key: "free_check_outcome",
    dimension: "customEvent:outcome_code",
    steps: ["free_check_completed", "free_check_qualified"],
    map: within(OUTCOME_CODES),
  },
  {
    key: "checkout_plan",
    dimension: "customEvent:plan",
    steps: ["checkout_attempt", "begin_checkout"],
    map: within(CHECKOUT_TIERS),
  },
  {
    key: "checkout_blocked_reason",
    dimension: "customEvent:blocked_reason",
    steps: ["checkout_attempt"],
    map: within(CHECKOUT_BLOCKED_REASONS),
  },
]

/* ---------------------------------------------------------------- requests */

export type FunnelDropoffInput = { propertyId: string; startDate: string; endDate: string }

export type FunnelRequestEntry = {
  slice: string
  kind: "events" | "attempt_users"
  method: "POST"
  url: string
  body: Record<string, unknown>
}

export type FunnelDropoffRequestBundle = {
  contract: typeof FUNNEL_DROPOFF_REPORT_VERSION
  funnel_contract_version: typeof FUNNEL_CONTRACT_VERSION
  oauth_scope: typeof DATA_API_READ_ONLY_SCOPE
  input: FunnelDropoffInput
  requests: FunnelRequestEntry[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** Epoch ms of a real calendar date, or null. `2026-02-30` is not a date. */
function calendarDate(value: unknown): number | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null
  return ms
}

/**
 * Plain JSON, read exactly once. A getter, a Proxy, a cycle or a BigInt cannot
 * answer validation one way and the report another; unreadable input is null.
 */
function snapshot(value: unknown): unknown {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? null : JSON.parse(text)
  } catch {
    return null
  }
}

function stepEvents(steps: readonly FunnelStep[]): string[] {
  const events = new Set<string>()
  for (const entry of FUNNEL_STEPS) {
    if (steps.includes(entry.step)) entry.events.forEach((event) => events.add(event))
  }
  return Array.from(events).sort()
}

const METRICS = [{ name: "totalUsers" }, { name: "eventCount" }]

function reportBody(input: FunnelDropoffInput, dimensions: string[], events: readonly string[]): Json {
  return {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: METRICS,
    dimensionFilter: {
      filter: { fieldName: "eventName", inListFilter: { values: [...events].sort(), caseSensitive: true } },
    },
    keepEmptyRows: false,
    limit: ROW_LIMIT,
    returnPropertyQuota: false,
  }
}

export function buildFunnelDropoffRequests(
  input: unknown,
): { ok: true; bundle: FunnelDropoffRequestBundle } | { ok: false; violations: string[] } {
  const read = snapshot(input)
  if (!isObject(read)) return { ok: false, violations: ["NOT_AN_OBJECT"] }
  const violations: string[] = []
  if (Object.keys(read).some((key) => !["propertyId", "startDate", "endDate"].includes(key))) violations.push("UNKNOWN_FIELD")
  if (typeof read.propertyId !== "string" || !PROPERTY_ID_PATTERN.test(read.propertyId)) violations.push("INVALID_PROPERTY_ID")
  const start = calendarDate(read.startDate)
  const end = calendarDate(read.endDate)
  if (start === null || end === null || start > end || (end - start) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    violations.push("INVALID_DATE_RANGE")
  }
  if (violations.length > 0) return { ok: false, violations }

  const clean: FunnelDropoffInput = {
    propertyId: read.propertyId as string,
    startDate: read.startDate as string,
    endDate: read.endDate as string,
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${clean.propertyId}:runReport`
  const requests: FunnelRequestEntry[] = []
  for (const breakdown of FUNNEL_BREAKDOWNS) {
    const extra = breakdown.dimension ? [breakdown.dimension] : []
    requests.push({
      slice: breakdown.key,
      kind: "events",
      method: "POST",
      url,
      body: reportBody(clean, ["eventName", ...extra], stepEvents(breakdown.steps)),
    })
    if (breakdown.steps.includes("checkout_attempt")) {
      requests.push({ slice: breakdown.key, kind: "attempt_users", method: "POST", url, body: reportBody(clean, extra, ATTEMPT_EVENTS) })
    }
  }
  return {
    ok: true,
    bundle: {
      contract: FUNNEL_DROPOFF_REPORT_VERSION,
      funnel_contract_version: FUNNEL_CONTRACT_VERSION,
      oauth_scope: DATA_API_READ_ONLY_SCOPE,
      input: clean,
      requests,
    },
  }
}

/* ------------------------------------------------------------------ report */

export type StepState =
  | "OK"
  | "FIRST_STEP"
  | "INSUFFICIENT_EVIDENCE"
  | "STEP_EXCEEDS_PREVIOUS"
  | "USERS_NOT_ADDITIVE"
  | "SLICE_INCONCLUSIVE"

export type StepReport = {
  step: FunnelStep
  users: number | null
  events: number
  conversion_from_previous: number | null
  conversion_from_first: number | null
  dropoff_users: number | null
  dropoff_rate: number | null
  state: StepState
}

export type BucketReport = { bucket: string; steps: StepReport[] }

export type SliceReport = {
  breakdown: string
  evidence: "OK" | "INSUFFICIENT_EVIDENCE"
  evidence_reasons: string[]
  buckets: BucketReport[]
}

export type FunnelDropoffReport = {
  schema: "ot.funnel_dropoff_report"
  version: typeof FUNNEL_DROPOFF_REPORT_VERSION
  funnel_contract_version: typeof FUNNEL_CONTRACT_VERSION
  status: "OK" | "INCONCLUSIVE" | "INVALID_RESPONSE"
  reasons: string[]
  date_range: { start_date: string; end_date: string } | null
  evidence_class: "ga4_behavioral_observational"
  payment_authority: "stripe_order_ledger_not_included"
  causal_claims: "none"
  step_basis: "aggregate_counts_not_paths"
  min_users_for_rate: number
  steps: FunnelStep[]
  slices: SliceReport[]
}

const RESPONSE_FIELDS = new Set([
  "dimensionHeaders",
  "metricHeaders",
  "rows",
  "rowCount",
  "metadata",
  "kind",
  "propertyQuota",
  "totals",
  "maximums",
  "minimums",
])

const METRIC_HEADERS = JSON.stringify([
  { name: "totalUsers", type: "TYPE_INTEGER" },
  { name: "eventCount", type: "TYPE_INTEGER" },
])

type Counts = { users: number; events: number; merged: boolean }
type ParsedResponse = { rows: Array<{ event: string | null; bucket: string; users: number; events: number }>; quality: string[] }

class InvalidResponse extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function parseResponse(entry: FunnelRequestEntry, breakdown: Breakdown, response: unknown): ParsedResponse {
  if (!isObject(response)) throw new InvalidResponse("NOT_AN_OBJECT")
  if (Object.keys(response).some((key) => !RESPONSE_FIELDS.has(key))) throw new InvalidResponse("UNKNOWN_FIELD")
  const dimensions = (entry.body.dimensions as Array<{ name: string }>).map((d) => d.name)
  if (JSON.stringify(response.dimensionHeaders ?? []) !== JSON.stringify(dimensions.map((name) => ({ name })))) {
    throw new InvalidResponse("HEADERS")
  }
  if (JSON.stringify(response.metricHeaders) !== METRIC_HEADERS) throw new InvalidResponse("HEADERS")

  const rows = response.rows ?? []
  if (!Array.isArray(rows)) throw new InvalidResponse("ROWS")
  const rowCount = response.rowCount ?? rows.length
  if (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < rows.length) {
    throw new InvalidResponse("ROW_COUNT")
  }

  const filterEvents = (entry.body.dimensionFilter as { filter: { inListFilter: { values: string[] } } }).filter.inListFilter
    .values
  const hasEventDimension = dimensions[0] === "eventName"
  const seen = new Set<string>()
  const parsed: ParsedResponse["rows"] = []
  for (const row of rows) {
    if (!isObject(row) || Object.keys(row).some((key) => key !== "dimensionValues" && key !== "metricValues")) {
      throw new InvalidResponse("ROW_SHAPE")
    }
    const values = row.dimensionValues ?? []
    const metrics = row.metricValues
    if (!Array.isArray(values) || values.length !== dimensions.length || !Array.isArray(metrics) || metrics.length !== 2) {
      throw new InvalidResponse("ROW_SHAPE")
    }
    const raw = values.map((cell) => (isObject(cell) && typeof cell.value === "string" ? cell.value : null))
    if (raw.some((value) => value === null)) throw new InvalidResponse("ROW_SHAPE")
    const counts = metrics.map((cell) => (isObject(cell) && typeof cell.value === "string" ? cell.value : null))
    if (counts.some((value) => value === null || !COUNT_PATTERN.test(value))) throw new InvalidResponse("BAD_COUNT")

    const event = hasEventDimension ? (raw[0] as string) : null
    if (event !== null && !filterEvents.includes(event)) throw new InvalidResponse("FILTER_NOT_HONORED")
    const rawBucket = breakdown.dimension ? (raw[raw.length - 1] as string) : ""
    const identity = JSON.stringify([event, rawBucket])
    if (seen.has(identity)) throw new InvalidResponse("DUPLICATE_ROW")
    seen.add(identity)
    parsed.push({ event, bucket: breakdown.map(rawBucket), users: Number(counts[0]), events: Number(counts[1]) })
  }

  const metadata = isObject(response.metadata) ? response.metadata : {}
  const quality = [
    ...(metadata.subjectToThresholding === true ? ["THRESHOLDED"] : []),
    ...(Array.isArray(metadata.samplingMetadatas) && metadata.samplingMetadatas.length > 0 ? ["SAMPLED"] : []),
    ...(metadata.dataLossFromOtherRow === true ? ["OTHER_ROW"] : []),
    ...(rowCount > rows.length ? ["ROWS_TRUNCATED"] : []),
  ]
  return { rows: parsed, quality }
}

function add(map: Map<string, Counts>, key: string, users: number, events: number): void {
  const current = map.get(key)
  if (current) map.set(key, { users: current.users + users, events: current.events + events, merged: true })
  else map.set(key, { users, events, merged: false })
}

function rate(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

function buildSteps(
  steps: readonly FunnelStep[],
  counts: (step: FunnelStep) => { users: number | null; events: number },
  inconclusive: boolean,
): StepReport[] {
  const out: StepReport[] = []
  const first = counts(steps[0])
  steps.forEach((step, index) => {
    const current = counts(step)
    const previous = index > 0 ? counts(steps[index - 1]) : null
    const report: StepReport = {
      step,
      users: current.users,
      events: current.events,
      conversion_from_previous: null,
      conversion_from_first: null,
      dropoff_users: null,
      dropoff_rate: null,
      state: "OK",
    }
    if (current.users === null) report.state = "USERS_NOT_ADDITIVE"
    else if (inconclusive) report.state = "SLICE_INCONCLUSIVE"
    else if (!previous) report.state = "FIRST_STEP"
    else if (previous.users === null) report.state = "USERS_NOT_ADDITIVE"
    else if (previous.users < MIN_USERS_FOR_RATE) report.state = "INSUFFICIENT_EVIDENCE"
    else if (current.users > previous.users) {
      report.state = "STEP_EXCEEDS_PREVIOUS"
      report.conversion_from_previous = rate(current.users, previous.users)
    } else {
      report.conversion_from_previous = rate(current.users, previous.users)
      report.dropoff_users = previous.users - current.users
      report.dropoff_rate = rate(previous.users - current.users, previous.users)
    }
    if (
      index > 0 &&
      !inconclusive &&
      current.users !== null &&
      first.users !== null &&
      first.users >= MIN_USERS_FOR_RATE
    ) {
      report.conversion_from_first = rate(current.users, first.users)
    }
    out.push(report)
  })
  return out
}

function baseReport(): FunnelDropoffReport {
  return {
    schema: "ot.funnel_dropoff_report",
    version: FUNNEL_DROPOFF_REPORT_VERSION,
    funnel_contract_version: FUNNEL_CONTRACT_VERSION,
    status: "INVALID_RESPONSE",
    reasons: [],
    date_range: null,
    evidence_class: "ga4_behavioral_observational",
    payment_authority: "stripe_order_ledger_not_included",
    causal_claims: "none",
    step_basis: "aggregate_counts_not_paths",
    min_users_for_rate: MIN_USERS_FOR_RATE,
    steps: [...ALL_STEPS],
    slices: [],
  }
}

function invalid(...reasons: string[]): FunnelDropoffReport {
  return { ...baseReport(), reasons }
}

/**
 * Build the report from a request bundle and one response per request, in
 * order. A bundle this module did not produce, or any response the request
 * could not have produced, fails the whole report closed: no partial funnel.
 */
export function evaluateFunnelDropoff(bundle: unknown, responses: unknown): FunnelDropoffReport {
  const readBundle = snapshot(bundle)
  if (!isObject(readBundle)) return invalid("BUNDLE_NOT_FROM_CONTRACT")
  const rebuilt = buildFunnelDropoffRequests(readBundle.input)
  if (!rebuilt.ok || JSON.stringify(rebuilt.bundle) !== JSON.stringify(readBundle)) return invalid("BUNDLE_NOT_FROM_CONTRACT")
  const { requests, input } = rebuilt.bundle

  const readResponses = snapshot(responses)
  if (!Array.isArray(readResponses) || readResponses.length !== requests.length) return invalid("RESPONSE_COUNT")

  const slices: SliceReport[] = []
  const reportReasons = new Set<string>()
  for (const breakdown of FUNNEL_BREAKDOWNS) {
    const eventsCounts = new Map<string, Map<string, Counts>>() // bucket → event → counts
    const attemptUsers = new Map<string, Counts>() // bucket → counts
    const quality = new Set<string>()
    for (let index = 0; index < requests.length; index += 1) {
      const entry = requests[index]
      if (entry.slice !== breakdown.key) continue
      let parsed: ParsedResponse
      try {
        parsed = parseResponse(entry, breakdown, readResponses[index])
      } catch (error) {
        const code = error instanceof InvalidResponse ? error.code : "UNREADABLE"
        return invalid(`${code}:${breakdown.key}:${entry.kind}`)
      }
      parsed.quality.forEach((reason) => quality.add(reason))
      for (const row of parsed.rows) {
        if (entry.kind === "attempt_users") {
          add(attemptUsers, row.bucket, row.users, row.events)
        } else {
          const perEvent = eventsCounts.get(row.bucket) ?? new Map<string, Counts>()
          add(perEvent, row.event as string, row.users, row.events)
          eventsCounts.set(row.bucket, perEvent)
        }
      }
    }

    const buckets = new Set<string>([...eventsCounts.keys(), ...attemptUsers.keys()])
    const inconclusive = quality.size > 0
    quality.forEach((reason) => reportReasons.add(`${reason}:${breakdown.key}`))
    const bucketReports: BucketReport[] = Array.from(buckets)
      .sort()
      .map((bucket) => {
        const perEvent = eventsCounts.get(bucket) ?? new Map<string, Counts>()
        const counts = (step: FunnelStep): { users: number | null; events: number } => {
          const definition = FUNNEL_STEPS.find((entry) => entry.step === step)!
          if (step === "checkout_attempt") {
            const events = ATTEMPT_EVENTS.reduce((sum, event) => sum + (perEvent.get(event)?.events ?? 0), 0)
            const users = attemptUsers.get(bucket)
            return { users: users ? (users.merged ? null : users.users) : 0, events }
          }
          const found = perEvent.get(definition.events[0])
          if (!found) return { users: 0, events: 0 }
          return { users: found.merged ? null : found.users, events: found.events }
        }
        return { bucket, steps: buildSteps(breakdown.steps, counts, inconclusive) }
      })
    slices.push({
      breakdown: breakdown.key,
      evidence: inconclusive ? "INSUFFICIENT_EVIDENCE" : "OK",
      evidence_reasons: Array.from(quality).sort(),
      buckets: bucketReports,
    })
  }

  const reasons = Array.from(reportReasons).sort()
  return {
    ...baseReport(),
    status: reasons.length > 0 ? "INCONCLUSIVE" : "OK",
    reasons,
    date_range: { start_date: input.startDate, end_date: input.endDate },
    slices,
  }
}
