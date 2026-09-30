/**
 * Source-side export contract for the offline decision-packet tool.
 *
 * The tool (a separate, standard-library-only Python repository) accepts
 * closed, versioned JSON documents: GA4 behavior, application outcomes, a
 * payment ledger and an experiment registry. It must stay separate from this
 * app, so the coupling here is a versioned mapping contract, not an import:
 * DOWNSTREAM_VOCABULARY is a snapshot of the tool's `decision_packet/vocab.py`
 * at DECISION_PACKET_TOOL.commit, and every exported value is drawn from it.
 *
 * Raw GA4 dimension values are untrusted text. Each is mapped into the closed
 * vocabulary or one of the tool's fixed sentinels — `other`, `not_set`,
 * `none` — and no raw string is ever passed through: an email, a PIN, a URL
 * or a partner's path in a GA4 row becomes `other`, never itself. A campaign
 * or content value survives only when it is canonical under
 * ./campaign-governance AND the tool's vocabulary already knows it; a landing
 * survives only as a Phase-A landing value the tool already knows.
 *
 * What ships:
 *   - `buildGa4BehaviorDocument` — pivoted GA4 Data API rows (sessions and
 *     begin_checkout / purchase event counts per day and session segment) to
 *     a `decision_packet.ga4_behavior` document, enforcing the tool's own
 *     semantic rules so an export is never silently refused downstream.
 *   - `projectExperimentRegistry` — the linted OT registry to the tool's
 *     registry, refusing any experiment the tool cannot yet represent.
 *   - `generateSyntheticDecisionFixtures` — a deterministic synthetic set of
 *     all four documents, checked in under fixtures/analytics/decision-packet.
 *
 * Application outcomes and the payment ledger for real OT orders are NOT
 * exported here: both need operator-keyed `conversion_ref` MACs and a
 * read-only order/ledger source, which are held for an owner decision.
 *
 * Pure: no I/O, no network, no environment reads.
 */

import { allowlistedLandingValues, normalizeLandingPath } from "@/lib/attribution/landing-paths"
import { campaignIssues, contentIssues, type GovernanceOrigin } from "./campaign-governance"
import { lintExperimentRegistry, type ExperimentRegistry, type RegistryIssue } from "./experiment-registry"

export const DECISION_EXPORT_CONTRACT_VERSION = "ot-decision-export-v1"

/** The decision-packet release this contract was written and verified against. */
export const DECISION_PACKET_TOOL = Object.freeze({
  commit: "d64d095f361dc10b939289a8787f25dc6d5d925c",
  schema_version: 1,
})

export const DOWNSTREAM_VOCABULARY = Object.freeze({
  sources: [
    "direct", "google", "bing", "duckduckgo", "yahoo", "facebook", "instagram", "tiktok", "pinterest", "youtube",
    "linkedin", "reddit", "x", "nextdoor", "newsletter", "chatgpt", "perplexity", "referral_other", "other", "not_set",
  ],
  mediums: [
    "none", "organic", "cpc", "paid_social", "social", "email", "referral", "display", "affiliate", "sms", "qr",
    "other", "not_set",
  ],
  campaignSlugs: ["fallbooks", "synthalpha", "synthbeta", "synthgamma", "synthappeal", "synthreminder", "ab"],
  contentVariants: ["a", "b", "b2", "v2"],
  landingPaths: [
    "/", "/fall-books", "/books/fall-2026", "/a/b/c/d", "/synthetic-offer-a", "/synthetic-offer-b",
    "/synthetic-offer-c", "/synthetic-appeal-check", "/synthetic-guide", "/synthetic-deadline",
  ],
  timezones: ["UTC", "America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles"],
  dataOrigins: ["synthetic_fixture", "operator_export"],
} as const)

export type ExportOrigin = "synthetic_fixture" | "operator_export"
type DownstreamSource = (typeof DOWNSTREAM_VOCABULARY.sources)[number]
type DownstreamMedium = (typeof DOWNSTREAM_VOCABULARY.mediums)[number]

const SOURCE_ALIASES: Readonly<Record<string, DownstreamSource>> = {
  "(direct)": "direct",
  "google.com": "google",
  "www.google.com": "google",
  "bing.com": "bing",
  "www.bing.com": "bing",
  "duckduckgo.com": "duckduckgo",
  "yahoo.com": "yahoo",
  "search.yahoo.com": "yahoo",
  fb: "facebook",
  "facebook.com": "facebook",
  "m.facebook.com": "facebook",
  "l.facebook.com": "facebook",
  "lm.facebook.com": "facebook",
  ig: "instagram",
  "instagram.com": "instagram",
  "l.instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "pinterest.com": "pinterest",
  "youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "linkedin.com": "linkedin",
  "lnkd.in": "linkedin",
  "reddit.com": "reddit",
  "old.reddit.com": "reddit",
  twitter: "x",
  "twitter.com": "x",
  "x.com": "x",
  "t.co": "x",
  "nextdoor.com": "nextdoor",
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "perplexity.ai": "perplexity",
  "www.perplexity.ai": "perplexity",
}

const MEDIUM_ALIASES: Readonly<Record<string, DownstreamMedium>> = {
  "(none)": "none",
  ppc: "cpc",
  paidsearch: "cpc",
  paid_search: "cpc",
  paidsocial: "paid_social",
  "paid-social": "paid_social",
  "social-network": "social",
  social_network: "social",
  "e-mail": "email",
  e_mail: "email",
  banner: "display",
  cpm: "display",
}

/** GA4 placeholders meaning "this session had no campaign". */
const NO_CAMPAIGN = new Set(["(organic)", "(direct)", "(referral)", "(none)"])

function isUnset(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === "" || raw === "(not set)"
}

function isKnown<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** An alias table's own entry. `constructor` or `__proto__` is raw text, not a key of Object.prototype. */
function ownAlias<T extends string>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return hasOwn(table, key) ? table[key] : undefined
}

export function mapMedium(raw: unknown): DownstreamMedium {
  if (isUnset(raw)) return "not_set"
  if (typeof raw !== "string") return "other"
  const value = raw.trim().toLowerCase()
  if (value === "(other)") return "other"
  if (isKnown(DOWNSTREAM_VOCABULARY.mediums, value) && value !== "not_set") return value
  return ownAlias(MEDIUM_ALIASES, value) ?? "other"
}

export function mapSource(raw: unknown, medium: DownstreamMedium): DownstreamSource {
  if (isUnset(raw)) return "not_set"
  if (typeof raw !== "string") return "other"
  const value = raw.trim().toLowerCase()
  if (value === "(other)") return "other"
  const known = isKnown(DOWNSTREAM_VOCABULARY.sources, value) && !["referral_other", "not_set"].includes(value)
  const mapped = known ? (value as DownstreamSource) : ownAlias(SOURCE_ALIASES, value)
  if (mapped) return mapped
  return medium === "referral" ? "referral_other" : "other"
}

function governanceOrigin(origin: ExportOrigin): GovernanceOrigin {
  return origin === "synthetic_fixture" ? "synthetic_fixture" : "owner_approved"
}

/** Canonical under OT governance and already known to the tool, or a sentinel. */
export function mapCampaign(raw: unknown, origin: ExportOrigin): string {
  if (isUnset(raw)) return "not_set"
  if (typeof raw !== "string") return "other"
  if (NO_CAMPAIGN.has(raw)) return "none"
  if (campaignIssues(raw, governanceOrigin(origin)).length > 0) return "other"
  return isKnown(DOWNSTREAM_VOCABULARY.campaignSlugs, raw.split("_")[3]) ? raw : "other"
}

export function mapContent(raw: unknown): string {
  if (isUnset(raw)) return "none"
  if (typeof raw !== "string" || contentIssues(raw).length > 0) return "other"
  return isKnown(DOWNSTREAM_VOCABULARY.contentVariants, raw.split("_")[1]) ? raw : "other"
}

/** The Phase-A landing value when the tool already knows it, else a sentinel. */
export function mapLanding(raw: unknown): string {
  if (isUnset(raw)) return "not_set"
  const landing = normalizeLandingPath(raw)
  return landing !== null && isKnown(DOWNSTREAM_VOCABULARY.landingPaths, landing) ? landing : "other"
}

export type Ga4BehaviorRow = {
  date: string
  source: string
  medium: string
  campaign: string
  content: string
  landing_path: string
  sessions: number
  checkout_starts: number
  purchase_events: number
}

export type DecisionDocument = Record<string, unknown> & { schema: string; data_origin: string }
export type ExportIssue = RegistryIssue
export type ExportResult = { ok: true; document: DecisionDocument } | { ok: false; issues: ExportIssue[] }

type Json = Record<string, unknown>

const RAW_ROW_FIELDS = [
  "date",
  "session_source",
  "session_medium",
  "session_campaign",
  "session_content",
  "landing_page",
  "sessions",
  "checkout_starts",
  "purchase_events",
] as const
const INPUT_FIELDS = [
  "data_origin",
  "generated_at",
  "timezone",
  "coverage",
  "attested_complete_ranges",
  "quality",
  "rows",
]
const MAX_ROWS = 250_000
const MAX_RANGES = 400
const MAX_COVERAGE_DAYS = 400
const MAX_COUNT = 1_000_000_000
const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const GA4_DATE = /^\d{8}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The input as plain JSON, read exactly once, or null if it cannot be. Every
 * check and every exported byte then comes from this one read: a getter or
 * Proxy cannot answer one value to validation and another to the document,
 * an array hole becomes `null` (refused by the checks, never skipped), and
 * inherited or non-enumerable fields are simply absent. A cycle, a BigInt or
 * a throwing getter refuses the whole input without echoing anything.
 */
function readOnce(input: unknown): { value: unknown } | null {
  try {
    const text = JSON.stringify(input)
    return text === undefined ? null : { value: JSON.parse(text) }
  } catch {
    return null
  }
}

function unreadable(): ExportResult {
  return { ok: false, issues: [{ code: "TYPE_OBJECT", path: "$" }] }
}

/**
 * Epoch ms of midnight UTC for a real calendar date, or null. `Date.parse`
 * rolls an impossible day over (`2026-02-30` is March 2) and knows a year
 * zero; the tool's calendar does neither, so both are refused.
 */
function isoDay(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_DATE.test(value) || value.startsWith("0000")) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null
}

/** Epoch ms for an exact `YYYY-MM-DDTHH:MM:SSZ` instant that exists on that calendar, or null. */
function isoInstant(value: unknown): number | null {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || value.startsWith("0000")) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === `${value.slice(0, 19)}.000Z` ? ms : null
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Epoch ms of a proleptic-Gregorian UTC wall time. `Date.UTC` reads years
 * 0-99 as 1900-1999; `setUTCFullYear` takes the year as given, so 0001-0099
 * stay on the tool's calendar.
 */
function utcWallMs(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const wall = new Date(0)
  wall.setUTCFullYear(year, month - 1, day)
  wall.setUTCHours(hour, minute, second, 0)
  return wall.getTime()
}

/** The Gregorian year a formatted date names: 1 BC is year 0, the day before 0001-01-01. */
function astronomicalYear(era: string | undefined, year: string | undefined): number {
  if (era === "AD") return Number(year)
  if (era === "BC") return 1 - Number(year)
  return NaN
}

/** The UTC instant at which `day` begins in `timeZone`; NaN if the zone data yields none. */
function zonedDayStart(dayMs: number, timeZone: string): number {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    const wall = utcWallMs(astronomicalYear(parts.era, parts.year), Number(parts.month), Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    return wall - instant
  }
  const guess = dayMs - offsetAt(dayMs)
  // Formatting an invalid Date throws; NaN refuses instead.
  return Number.isFinite(guess) ? dayMs - offsetAt(guess) : NaN
}

/** Hours the tool waits after a GA4 day ends before it counts as settled (`SETTLE_HOURS` in its evidence.py). */
const GA4_SETTLE_MS = 48 * 3_600_000
/** The tool's last instant: Python's `datetime.max`, 9999-12-31T23:59:59.999999, in UTC. */
const TOOL_LAST_INSTANT_MS = Date.parse("9999-12-31T23:59:59.999Z")

/**
 * Whether the tool can compute the settlement instant of an attested day. For
 * every attested day it evaluates `day_start_utc(day + 1 day, tz) + 48h` and
 * raises OverflowError when that lies past its calendar, whatever generated_at
 * says. In every packet timezone the last such day is 9999-12-28. A NaN
 * instant compares false and refuses.
 */
function settlementComputable(dayMs: number, timeZone: string): boolean {
  return zonedDayStart(dayMs + DAY_MS, timeZone) + GA4_SETTLE_MS <= TOOL_LAST_INSTANT_MS
}

function closedKeys(value: Json, fields: readonly string[], path: string, issues: ExportIssue[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key))) issues.push({ code: "UNKNOWN_FIELD", path })
  for (const field of fields) if (!hasOwn(value, field)) issues.push({ code: `MISSING_KEY:${field}`, path })
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT
}

/**
 * Build a `decision_packet.ga4_behavior` document from pivoted GA4 rows.
 *
 * Each raw row is one GA4 day (native `YYYYMMDD`) and session segment with its
 * sessions and its begin_checkout and purchase event counts. Segments are
 * normalized, rows that normalize to the same day and segment are summed, and
 * the result is sorted, so row order never changes the output bytes.
 */
export function buildGa4BehaviorDocument(raw: unknown): ExportResult {
  const snapshot = readOnce(raw)
  if (!snapshot) return unreadable()
  const input = snapshot.value
  if (!isObject(input)) return { ok: false, issues: [{ code: "TYPE_OBJECT", path: "$" }] }
  const issues: ExportIssue[] = []
  closedKeys(input, INPUT_FIELDS, "$", issues)

  const origin = input.data_origin
  if (!isKnown(DOWNSTREAM_VOCABULARY.dataOrigins, origin)) issues.push({ code: "INVALID_DATA_ORIGIN", path: "$.data_origin" })
  const timeZone = input.timezone
  if (!isKnown(DOWNSTREAM_VOCABULARY.timezones, timeZone)) issues.push({ code: "INVALID_TIMEZONE", path: "$.timezone" })
  const generatedAt = isoInstant(input.generated_at) ?? NaN
  if (!Number.isFinite(generatedAt)) issues.push({ code: "INVALID_TIMESTAMP", path: "$.generated_at" })

  const coverage = isObject(input.coverage) ? input.coverage : {}
  const start = isoDay(coverage.start)
  const end = isoDay(coverage.end)
  if (start === null || end === null || !isObject(input.coverage)) {
    issues.push({ code: "INVALID_DATE", path: "$.coverage" })
  } else if (start > end) {
    issues.push({ code: "COVERAGE_RANGE_INVALID", path: "$.coverage" })
  } else if ((end - start) / DAY_MS + 1 > MAX_COVERAGE_DAYS) {
    issues.push({ code: "COVERAGE_TOO_LONG", path: "$.coverage" })
  } else if (Number.isFinite(generatedAt) && isKnown(DOWNSTREAM_VOCABULARY.timezones, timeZone) && !(zonedDayStart(end, timeZone) < generatedAt)) {
    issues.push({ code: "COVERAGE_AFTER_GENERATED_AT", path: "$.coverage.end" })
  }

  const ranges = Array.isArray(input.attested_complete_ranges) ? input.attested_complete_ranges : null
  if (!ranges || ranges.length > MAX_RANGES) issues.push({ code: "INVALID_RANGES", path: "$.attested_complete_ranges" })
  let previousEnd: number | null = null
  ;(ranges ?? []).forEach((range, index) => {
    const rangeStart = isObject(range) ? isoDay(range.start) : null
    const rangeEnd = isObject(range) ? isoDay(range.end) : null
    const valid =
      isObject(range) &&
      Object.keys(range).sort().join(",") === "end,start" &&
      rangeStart !== null &&
      rangeEnd !== null &&
      start !== null &&
      end !== null &&
      rangeStart <= rangeEnd &&
      rangeStart >= start &&
      rangeEnd <= end &&
      (previousEnd === null || rangeStart > previousEnd)
    if (!valid) {
      issues.push({ code: "ATTESTED_RANGE_INVALID", path: `$.attested_complete_ranges[${index}]` })
      return
    }
    previousEnd = rangeEnd
    // Settlement is monotone in the day, so the range's last day decides it.
    if (isKnown(DOWNSTREAM_VOCABULARY.timezones, timeZone) && !settlementComputable(rangeEnd, timeZone)) {
      issues.push({ code: "ATTESTED_RANGE_UNSETTLEABLE", path: `$.attested_complete_ranges[${index}]` })
    }
  })

  const quality = input.quality
  if (!isObject(quality)) {
    issues.push({ code: "TYPE_OBJECT", path: "$.quality" })
  } else {
    closedKeys(quality, ["sampled", "thresholded", "other_row"], "$.quality", issues)
    for (const flag of ["sampled", "thresholded", "other_row"]) {
      if (hasOwn(quality, flag) && typeof quality[flag] !== "boolean") issues.push({ code: "TYPE_BOOLEAN", path: `$.quality.${flag}` })
    }
  }

  const rows = Array.isArray(input.rows) ? input.rows : null
  if (!rows || rows.length > MAX_ROWS) {
    issues.push({ code: "INVALID_ROWS", path: "$.rows" })
    return { ok: false, issues }
  }

  const exportOrigin: ExportOrigin = origin === "synthetic_fixture" ? "synthetic_fixture" : "operator_export"
  const totals = new Map<string, Ga4BehaviorRow>()
  let otherRow = false
  rows.forEach((raw, index) => {
    const path = `$.rows[${index}]`
    if (!isObject(raw)) {
      issues.push({ code: "TYPE_OBJECT", path })
      return
    }
    const before = issues.length
    closedKeys(raw, RAW_ROW_FIELDS, path, issues)
    const rawDate = raw.date
    const day = typeof rawDate === "string" && GA4_DATE.test(rawDate) ? isoDay(`${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`) : null
    if (day === null) issues.push({ code: "INVALID_DATE", path: `${path}.date` })
    else if (start !== null && end !== null && (day < start || day > end)) issues.push({ code: "ROW_OUTSIDE_COVERAGE", path: `${path}.date` })
    for (const metric of ["sessions", "checkout_starts", "purchase_events"] as const) {
      if (!isCount(raw[metric])) issues.push({ code: "INVALID_COUNT", path: `${path}.${metric}` })
    }
    if (issues.length !== before || day === null) return

    const dimensions = [raw.session_source, raw.session_medium, raw.session_campaign, raw.session_content, raw.landing_page]
    if (dimensions.includes("(other)")) otherRow = true
    const medium = mapMedium(raw.session_medium)
    const row: Ga4BehaviorRow = {
      date: isoFromMs(day),
      source: mapSource(raw.session_source, medium),
      medium,
      campaign: mapCampaign(raw.session_campaign, exportOrigin),
      content: mapContent(raw.session_content),
      landing_path: mapLanding(raw.landing_page),
      sessions: raw.sessions as number,
      checkout_starts: raw.checkout_starts as number,
      purchase_events: raw.purchase_events as number,
    }
    const key = JSON.stringify([row.date, row.source, row.medium, row.campaign, row.content, row.landing_path])
    const existing = totals.get(key)
    if (!existing) {
      totals.set(key, row)
      return
    }
    existing.sessions += row.sessions
    existing.checkout_starts += row.checkout_starts
    existing.purchase_events += row.purchase_events
  })

  const outputRows = Array.from(totals.entries())
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, row]) => row)
  if (outputRows.some((row) => row.checkout_starts > row.sessions || row.purchase_events > row.sessions)) {
    issues.push({ code: "METRIC_INVARIANT", path: "$.rows" })
  }
  if (outputRows.some((row) => row.sessions > MAX_COUNT)) issues.push({ code: "INVALID_COUNT", path: "$.rows" })
  if (issues.length > 0) return { ok: false, issues }

  const flags = quality as Json
  return {
    ok: true,
    document: {
      schema: "decision_packet.ga4_behavior",
      schema_version: DECISION_PACKET_TOOL.schema_version,
      data_origin: origin as ExportOrigin,
      business: "ot",
      timezone: timeZone as string,
      generated_at: input.generated_at as string,
      coverage: { start: isoFromMs(start as number), end: isoFromMs(end as number) },
      attested_complete_ranges: (ranges as Json[]).map((range) => ({ start: range.start, end: range.end })),
      quality: { sampled: flags.sampled, thresholded: flags.thresholded, other_row: flags.other_row === true || otherRow },
      rows: outputRows,
    },
  }
}

/**
 * The OT registry as the tool's registry. Every experiment must lint clean and
 * be representable downstream as it stands — its landing, campaign slug and
 * content variant already in the tool's vocabulary. Nothing is mapped to a
 * sentinel here: the tool's registry has no sentinels, and an experiment on
 * `other` would describe no segment at all.
 */
export function projectExperimentRegistry(raw: unknown): ExportResult {
  const snapshot = readOnce(raw)
  if (!snapshot) return unreadable()
  const registry = snapshot.value
  const lint = lintExperimentRegistry(registry)
  if (!lint.ok) return { ok: false, issues: lint.issues }
  const valid = registry as ExperimentRegistry

  const issues: ExportIssue[] = []
  valid.experiments.forEach((experiment, index) => {
    const path = `$.experiments[${index}]`
    if (!isKnown(DOWNSTREAM_VOCABULARY.landingPaths, experiment.landing_path)) {
      issues.push({ code: "DOWNSTREAM_VOCABULARY_EXTENSION_REQUIRED", path: `${path}.landing_path` })
    }
    if (!isKnown(DOWNSTREAM_VOCABULARY.campaignSlugs, experiment.campaign.split("_")[3])) {
      issues.push({ code: "DOWNSTREAM_VOCABULARY_EXTENSION_REQUIRED", path: `${path}.campaign` })
    }
    if (experiment.content !== "none" && !isKnown(DOWNSTREAM_VOCABULARY.contentVariants, experiment.content.split("_")[1])) {
      issues.push({ code: "DOWNSTREAM_VOCABULARY_EXTENSION_REQUIRED", path: `${path}.content` })
    }
  })
  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    document: {
      schema: "decision_packet.experiment_registry",
      schema_version: DECISION_PACKET_TOOL.schema_version,
      data_origin: valid.registry_origin === "synthetic_fixture" ? "synthetic_fixture" : "operator_export",
      experiments: valid.experiments.map((experiment) => ({
        experiment_id: experiment.experiment_id,
        business: experiment.business,
        status: experiment.status,
        start_date: experiment.start_date,
        end_date: experiment.end_date,
        source: experiment.source,
        medium: experiment.medium,
        campaign: experiment.campaign,
        content: experiment.content,
        landing_path: experiment.landing_path,
        budget: { amount_minor: experiment.budget.amount_minor, currency: experiment.budget.currency },
        primary_outcome: experiment.primary_outcome,
        evidence_threshold: {
          min_denominator: experiment.evidence_threshold.min_denominator,
          min_events: experiment.evidence_threshold.min_events,
        },
        decision: experiment.decision,
      })),
    },
  }
}

/** Canonical bytes: two-space JSON and a trailing newline. */
export function serializeDecisionDocument(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

/** The mapping contract, as checked in at data/analytics/ot-decision-export-mapping.v1.json. */
export function buildDecisionExportMappingContract() {
  const landings = allowlistedLandingValues()
  return {
    schema: "ot.decision_export_mapping",
    schema_version: 1,
    contract_version: DECISION_EXPORT_CONTRACT_VERSION,
    decision_packet_tool: { commit: DECISION_PACKET_TOOL.commit, schema_version: DECISION_PACKET_TOOL.schema_version },
    raw_values_passed_through: false,
    sentinels: {
      unset: "not_set",
      unknown: "other",
      no_campaign_or_content: "none",
      ga4_other_row_sets_quality_flag: "other_row",
    },
    source: {
      exact: DOWNSTREAM_VOCABULARY.sources.filter((value) => !["referral_other", "other", "not_set"].includes(value)),
      aliases: SOURCE_ALIASES,
      unknown_with_referral_medium: "referral_other",
      unknown_otherwise: "other",
    },
    medium: {
      exact: DOWNSTREAM_VOCABULARY.mediums.filter((value) => !["other", "not_set"].includes(value)),
      aliases: MEDIUM_ALIASES,
      unknown: "other",
    },
    campaign: {
      rule: "canonical under ot-campaign-governance-v1 and slug known downstream, else other",
      no_campaign_placeholders: Array.from(NO_CAMPAIGN),
    },
    content: { rule: "canonical <format>_<variant> with variant known downstream, else other; unset is none" },
    landing: {
      rule: "Phase-A landing value known downstream, else other; never a raw path",
      represented: landings.filter((value) => isKnown(DOWNSTREAM_VOCABULARY.landingPaths, value)),
      pending_downstream_extension: landings.filter((value) => !isKnown(DOWNSTREAM_VOCABULARY.landingPaths, value)),
    },
    documents: {
      ga4_behavior: "buildGa4BehaviorDocument",
      experiment_registry: "projectExperimentRegistry",
      app_outcomes: "HOLD: needs an owner-defined OT qualified action and operator-keyed conversion_ref MACs",
      payment_ledger: "HOLD: needs a read-only Stripe/order ledger source and operator-keyed conversion_ref MACs",
    },
  }
}

// ── Synthetic fixtures ─────────────────────────────────────────────────────

const FIXTURE_GENERATED_AT = "2026-09-30T12:00:00Z"
const FIXTURE_COVERAGE = { start: "2026-08-19", end: "2026-09-27" }

function fixtureDays(): string[] {
  const days: string[] = []
  const start = isoDay(FIXTURE_COVERAGE.start) as number
  const end = isoDay(FIXTURE_COVERAGE.end) as number
  for (let day = start; day <= end; day += DAY_MS) days.push(isoFromMs(day))
  return days
}

/** `cr1_k01_` + 26 Crockford base32 characters, visibly synthetic. */
function syntheticRef(index: number): string {
  return `cr1_k01_SYNTHPHB${String(index).padStart(18, "0")}`
}

const SYNTHETIC_REGISTRY: ExperimentRegistry = {
  schema: "ot.experiment_registry",
  schema_version: 1,
  registry_origin: "synthetic_fixture",
  business: "ot",
  currency: "USD",
  governance_version: "ot-campaign-governance-v1",
  experiments: [
    {
      experiment_id: "ot_exp_2026_001",
      business: "ot",
      status: "running",
      start_date: "2026-08-20",
      end_date: "2026-10-15",
      source: "google",
      medium: "cpc",
      campaign: "ot_202608_season_synthappeal",
      content: "srch_a",
      landing_path: "/",
      budget: { amount_minor: 300000, currency: "USD" },
      primary_outcome: "paid_per_qualified_rate",
      evidence_threshold: { min_denominator: 5, min_events: 3 },
      decision: "pending",
    },
    {
      experiment_id: "ot_exp_2026_002",
      business: "ot",
      status: "planned",
      start_date: "2026-10-05",
      end_date: "2026-11-30",
      source: "newsletter",
      medium: "email",
      campaign: "ot_202610_ret_synthreminder",
      content: "eml_a",
      landing_path: "/",
      budget: { amount_minor: 50000, currency: "USD" },
      primary_outcome: "checkout_start_rate",
      evidence_threshold: { min_denominator: 500, min_events: 20 },
      decision: "pending",
    },
  ],
}

type OutcomeSeed = { ref: number; date: string; paid?: { date: string; amount: number }; refund?: { date: string; amount: number }; campaign: boolean; classification?: string }

const OUTCOME_SEEDS: readonly OutcomeSeed[] = [
  { ref: 1, date: "2026-09-26", campaign: true, paid: { date: "2026-09-26", amount: 6900 } },
  { ref: 2, date: "2026-09-25", campaign: true, paid: { date: "2026-09-25", amount: 9700 }, refund: { date: "2026-09-27", amount: 4850 } },
  { ref: 3, date: "2026-09-24", campaign: false, paid: { date: "2026-09-24", amount: 6900 } },
  { ref: 4, date: "2026-09-21", campaign: true },
  { ref: 5, date: "2026-09-15", campaign: false, paid: { date: "2026-09-16", amount: 6900 } },
  { ref: 6, date: "2026-09-01", campaign: true, paid: { date: "2026-09-02", amount: 9700 } },
  { ref: 7, date: "2026-08-25", campaign: false },
  { ref: 8, date: "2026-09-22", campaign: true, paid: { date: "2026-09-22", amount: 6900 }, classification: "test" },
]

function fixtureHeader(schema: string) {
  return {
    schema,
    schema_version: DECISION_PACKET_TOOL.schema_version,
    data_origin: "synthetic_fixture",
    business: "ot",
    timezone: "America/Chicago",
    generated_at: FIXTURE_GENERATED_AT,
    coverage: { ...FIXTURE_COVERAGE },
    attested_complete_ranges: [{ ...FIXTURE_COVERAGE }],
  }
}

function segment(campaign: boolean) {
  return campaign
    ? { source: "google", medium: "cpc", campaign: "ot_202608_season_synthappeal", content: "srch_a", landing_path: "/" }
    : { source: "google", medium: "organic", campaign: "none", content: "none", landing_path: "/" }
}

/**
 * A deterministic synthetic OT evidence set. The GA4 document is produced by
 * running the real adapter over GA4-shaped raw rows — including raw aliases,
 * GA4 placeholders and landings the tool cannot represent yet — so the fixture
 * exercises the export path, not a hand-written copy of its output.
 */
export function generateSyntheticDecisionFixtures() {
  const rawRows = fixtureDays().flatMap((day) => {
    const date = day.replace(/-/g, "")
    return [
      { date, session_source: "google", session_medium: "organic", session_campaign: "(organic)", session_content: "(not set)", landing_page: "/", sessions: 44, checkout_starts: 3, purchase_events: 1 },
      { date, session_source: "google", session_medium: "cpc", session_campaign: "ot_202608_season_synthappeal", session_content: "srch_a", landing_page: "/", sessions: 30, checkout_starts: 4, purchase_events: 2 },
      { date, session_source: "l.facebook.com", session_medium: "referral", session_campaign: "(referral)", session_content: "(not set)", landing_page: "/check", sessions: 6, checkout_starts: 1, purchase_events: 0 },
      { date, session_source: "(direct)", session_medium: "(none)", session_campaign: "(direct)", session_content: "(not set)", landing_page: "/townships/cicero", sessions: 5, checkout_starts: 0, purchase_events: 0 },
    ]
  })
  const ga4 = buildGa4BehaviorDocument({
    data_origin: "synthetic_fixture",
    generated_at: FIXTURE_GENERATED_AT,
    timezone: "America/Chicago",
    coverage: { ...FIXTURE_COVERAGE },
    attested_complete_ranges: [{ ...FIXTURE_COVERAGE }],
    quality: { sampled: false, thresholded: false, other_row: false },
    rows: rawRows,
  })
  const registry = projectExperimentRegistry(SYNTHETIC_REGISTRY)
  if (!ga4.ok || !registry.ok) throw new Error("synthetic decision fixtures failed their own contract")

  const outcomes = {
    ...fixtureHeader("decision_packet.app_outcomes"),
    conversion_ref_key_id: "k01",
    rows: OUTCOME_SEEDS.map((seed) => ({
      conversion_ref: syntheticRef(seed.ref),
      outcome: "qualified_action",
      date: seed.date,
      ...segment(seed.campaign),
      classification: seed.classification ?? "customer",
    })),
  }

  const ledger = {
    ...fixtureHeader("decision_packet.payment_ledger"),
    currency: "USD",
    conversion_ref_key_id: "k01",
    rows: OUTCOME_SEEDS.flatMap((seed) => [
      ...(seed.paid
        ? [{ conversion_ref: syntheticRef(seed.ref), event: "charge", event_seq: 1, date: seed.paid.date, amount_minor: seed.paid.amount, currency: "USD", classification: seed.classification ?? "customer" }]
        : []),
      ...(seed.refund
        ? [{ conversion_ref: syntheticRef(seed.ref), event: "refund", event_seq: 1, date: seed.refund.date, amount_minor: seed.refund.amount, currency: "USD", classification: seed.classification ?? "customer" }]
        : []),
    ]),
  }

  return {
    ot_ga4_behavior: ga4.document,
    ot_app_outcomes: outcomes as DecisionDocument,
    ot_payment_ledger: ledger as DecisionDocument,
    ot_experiment_registry: registry.document,
  }
}
