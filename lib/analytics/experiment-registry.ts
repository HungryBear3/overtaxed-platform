/**
 * The OT experiment registry: closed schema and linter.
 *
 * One entry is one experiment on exactly one governed segment — business,
 * source, medium, canonical campaign, content and Phase-A landing value (see
 * ./campaign-governance) — with its dates, status, an integer-minor-unit budget
 * in the registry's single currency, exactly one primary outcome from the
 * decision-packet vocabulary, a minimum denominator and event count, and the
 * owner's decision. Nothing else has a field: an unknown key is refused, and a
 * key that looks like a place for text, a URL, a search term or an identifier
 * is refused with a category that says so.
 *
 * Two experiments on the same segment may not share a day, whatever their
 * status. The offline decision-packet tool refuses such a registry outright,
 * and its readout could not tell the two apart.
 *
 * Findings are codes and JSON paths. No value is ever echoed.
 *
 * The checked-in registry is data/analytics/ot-experiment-registry.v1.json.
 */

import {
  GOVERNANCE_VERSION,
  type GovernanceOrigin,
  campaignIssues,
  contentIssues,
  forbiddenValueCode,
  landingIssues,
  mediumIssues,
  sourceIssues,
} from "./campaign-governance"

export const EXPERIMENT_REGISTRY_SCHEMA = "ot.experiment_registry"
export const OT_REGISTRY_CURRENCY = "USD"

/** ISO 4217 codes the decision-packet tool knows. OT registries use USD only. */
const KNOWN_CURRENCIES: ReadonlySet<string> = new Set(["USD", "CAD", "EUR", "GBP"])

export const EXPERIMENT_STATUSES = ["planned", "running", "paused", "completed", "cancelled"] as const
const OPEN_STATUSES: ReadonlySet<string> = new Set(["planned", "running", "paused"])
export const EXPERIMENT_DECISIONS = ["pending", "continue", "scale", "iterate", "stop"] as const
export const PRIMARY_OUTCOMES = [
  "qualified_action_rate",
  "checkout_start_rate",
  "paid_order_rate",
  "paid_per_qualified_rate",
  "net_revenue_per_session",
] as const
export type PrimaryOutcome = (typeof PRIMARY_OUTCOMES)[number]

/**
 * The evidence classes each primary outcome is read from, as the decision
 * packet computes it: sessions and checkout starts from GA4 behavior,
 * qualified actions from application outcomes, paid orders and revenue from
 * the payment ledger. No outcome reads Meta evidence.
 */
export const PRIMARY_OUTCOME_EVIDENCE: Readonly<Record<PrimaryOutcome, readonly string[]>> = Object.freeze({
  qualified_action_rate: ["app_outcomes", "ga4_behavior"],
  checkout_start_rate: ["ga4_behavior"],
  paid_order_rate: ["payment_ledger", "ga4_behavior"],
  paid_per_qualified_rate: ["payment_ledger", "app_outcomes"],
  net_revenue_per_session: ["payment_ledger", "ga4_behavior"],
})

const REGISTRY_ORIGINS: readonly GovernanceOrigin[] = ["owner_approved", "synthetic_fixture"]

const MAX_EXPERIMENTS = 500
const MAX_BUDGET_MINOR = 1_000_000_000_000
const MAX_COUNT = 1_000_000_000

const EXPERIMENT_ID = /^(ot|hsb)_exp_20[2-9]\d_\d{3}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type RegistryIssue = { code: string; path: string }
export type RegistryLint = { ok: true; experiments: number } | { ok: false; issues: RegistryIssue[] }

export type RegistryExperiment = {
  experiment_id: string
  business: "ot"
  status: (typeof EXPERIMENT_STATUSES)[number]
  start_date: string
  end_date: string
  source: string
  medium: string
  campaign: string
  content: string
  landing_path: string
  budget: { amount_minor: number; currency: string }
  primary_outcome: PrimaryOutcome
  evidence_threshold: { min_denominator: number; min_events: number }
  decision: (typeof EXPERIMENT_DECISIONS)[number]
}

export type ExperimentRegistry = {
  schema: typeof EXPERIMENT_REGISTRY_SCHEMA
  schema_version: 1
  registry_origin: GovernanceOrigin
  business: "ot"
  currency: typeof OT_REGISTRY_CURRENCY
  governance_version: typeof GOVERNANCE_VERSION
  experiments: RegistryExperiment[]
}

// Unknown keys are refused either way; the category only sharpens the finding.
// First match wins, so a search-term key is named before the URL family.
const KEY_CATEGORIES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ["EMAIL", new Set(["email", "mail", "emailaddress"])],
  ["PHONE", new Set(["phone", "telephone", "tel", "mobile", "sms"])],
  ["ADDRESS", new Set(["address", "street", "zip", "zipcode", "postal", "postcode", "city", "unit"])],
  [
    "PROPERTY",
    new Set(["pin", "pins", "parcel", "property", "apn", "township", "assessment", "assessed", "comparable", "comparables", "comp", "comps", "appeal"]),
  ],
  ["PROVIDER", new Set(["stripe", "charge", "paymentintent", "intent", "invoice", "payout", "checkout", "session", "price", "product"])],
  ["GA_IDENTIFIER", new Set(["client", "clientid", "cid", "pseudo", "userpseudoid", "gclid", "fbclid", "fbp", "fbc", "ga", "gaid"])],
  ["ORDER", new Set(["order", "orderid", "receipt", "transaction", "txn"])],
  ["CUSTOMER", new Set(["customer", "user", "userid", "account", "member", "buyer", "payer", "person", "owner", "homeowner"])],
  ["UTM_TERM", new Set(["term", "utmterm", "keyword", "keywords", "query", "search"])],
  ["URL", new Set(["url", "uri", "href", "link", "referrer", "referer", "location", "querystring", "utm", "hash", "fragment"])],
  ["FREE_TEXT", new Set(["note", "notes", "comment", "comments", "description", "message", "memo", "text", "hypothesis", "details", "remarks", "label"])],
  ["NAME", new Set(["name", "firstname", "lastname", "fullname", "surname"])],
]

function forbiddenKeyCode(key: string): string {
  const valueCode = forbiddenValueCode(key)
  if (valueCode) return `FORBIDDEN_KEY:${valueCode}`
  const lowered = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
  const tokens = new Set(lowered.match(/[a-z]+|[0-9]+/g) ?? [])
  tokens.add(lowered.replace(/[^a-z0-9]/g, ""))
  for (const [category, names] of KEY_CATEGORIES) {
    for (const token of tokens) if (names.has(token)) return `FORBIDDEN_KEY:${category}`
  }
  return "UNKNOWN_KEY"
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

class Findings {
  readonly issues: RegistryIssue[] = []
  add(code: string, path: string): void {
    if (!this.issues.some((issue) => issue.code === code && issue.path === path)) this.issues.push({ code, path })
  }
  addAll(codes: string[], path: string): void {
    for (const code of codes) this.add(code, path)
  }
}

/** Closed object: report unknown keys by category and missing own keys by name; nothing is read from a prototype. */
function closedObject(value: unknown, fields: readonly string[], path: string, out: Findings): value is Json {
  if (!isObject(value)) {
    out.add("TYPE_OBJECT", path)
    return false
  }
  for (const key of Object.keys(value)) if (!fields.includes(key)) out.add(forbiddenKeyCode(key), path)
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) out.add(`MISSING_KEY:${field}`, path)
  return true
}

function checkEnum(value: unknown, values: readonly string[], path: string, out: Findings): void {
  if (typeof value !== "string") out.add("TYPE_STRING", path)
  else if (forbiddenValueCode(value)) out.add(`FORBIDDEN_VALUE:${forbiddenValueCode(value)}`, path)
  else if (!values.includes(value)) out.add("INVALID_ENUM", path)
}

function checkInteger(value: unknown, low: number, high: number, path: string, out: Findings): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) out.add("TYPE_INTEGER", path)
  else if (value < low || value > high) out.add("INTEGER_OUT_OF_RANGE", path)
}

/**
 * Epoch day of a real calendar date, or null. The decision-packet tool's
 * calendar runs from 0001-01-01 to 9999-12-31; `Date` also knows a year zero
 * and round-trips it, so year zero is refused before the round trip.
 */
function calendarDay(value: unknown): number | null {
  if (typeof value !== "string" || !DATE.test(value) || value.startsWith("0000")) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null
  return ms / 86_400_000
}

const EXPERIMENT_FIELDS = [
  "experiment_id",
  "business",
  "status",
  "start_date",
  "end_date",
  "source",
  "medium",
  "campaign",
  "content",
  "landing_path",
  "budget",
  "primary_outcome",
  "evidence_threshold",
  "decision",
] as const

type Checked = { segment: string; start: number; end: number } | null

function lintExperiment(value: unknown, path: string, origin: GovernanceOrigin, currency: string | null, out: Findings): Checked {
  if (!closedObject(value, EXPERIMENT_FIELDS, path, out)) return null
  const before = out.issues.length

  const id = value.experiment_id
  if (typeof id !== "string") out.add("TYPE_STRING", `${path}.experiment_id`)
  else if (forbiddenValueCode(id)) out.add(`FORBIDDEN_VALUE:${forbiddenValueCode(id)}`, `${path}.experiment_id`)
  else if (!EXPERIMENT_ID.test(id)) out.add("EXPERIMENT_ID_FORMAT", `${path}.experiment_id`)
  else if (!id.startsWith("ot_")) out.add("EXPERIMENT_ID_BUSINESS_MISMATCH", `${path}.experiment_id`)

  if (value.business !== "ot") out.add("BUSINESS_NOT_OT", `${path}.business`)
  checkEnum(value.status, EXPERIMENT_STATUSES, `${path}.status`, out)
  checkEnum(value.decision, EXPERIMENT_DECISIONS, `${path}.decision`, out)
  if (typeof value.status === "string" && OPEN_STATUSES.has(value.status) && value.decision !== "pending") {
    out.add("DECISION_BEFORE_COMPLETION", `${path}.decision`)
  }

  const start = calendarDay(value.start_date)
  const end = calendarDay(value.end_date)
  if (start === null) out.add("INVALID_DATE", `${path}.start_date`)
  if (end === null) out.add("INVALID_DATE", `${path}.end_date`)
  if (start !== null && end !== null && start > end) out.add("EXPERIMENT_DATES_INVALID", path)

  out.addAll(sourceIssues(value.source), `${path}.source`)
  out.addAll(mediumIssues(value.medium), `${path}.medium`)
  out.addAll(campaignIssues(value.campaign, origin), `${path}.campaign`)
  if (value.content !== "none") out.addAll(contentIssues(value.content), `${path}.content`)
  out.addAll(landingIssues(value.landing_path), `${path}.landing_path`)

  if (closedObject(value.budget, ["amount_minor", "currency"], `${path}.budget`, out)) {
    const budget = value.budget as Json
    checkInteger(budget.amount_minor, 0, MAX_BUDGET_MINOR, `${path}.budget.amount_minor`, out)
    if (typeof budget.currency !== "string" || !KNOWN_CURRENCIES.has(budget.currency)) {
      out.add("UNKNOWN_CURRENCY", `${path}.budget.currency`)
    } else if (currency !== null && budget.currency !== currency) {
      out.add("MIXED_CURRENCY", `${path}.budget.currency`)
    }
  }

  if (Array.isArray(value.primary_outcome)) out.add("MULTIPLE_PRIMARY_OUTCOMES", `${path}.primary_outcome`)
  else checkEnum(value.primary_outcome, PRIMARY_OUTCOMES, `${path}.primary_outcome`, out)

  const thresholdPath = `${path}.evidence_threshold`
  if (closedObject(value.evidence_threshold, ["min_denominator", "min_events"], thresholdPath, out)) {
    const threshold = value.evidence_threshold as Json
    checkInteger(threshold.min_denominator, 1, MAX_COUNT, `${thresholdPath}.min_denominator`, out)
    checkInteger(threshold.min_events, 1, MAX_COUNT, `${thresholdPath}.min_events`, out)
  }

  if (out.issues.length !== before || start === null || end === null) return null
  const segment = JSON.stringify([value.business, value.source, value.medium, value.campaign, value.content, value.landing_path])
  return { segment, start, end }
}

const TOP_LEVEL_FIELDS = [
  "schema",
  "schema_version",
  "registry_origin",
  "business",
  "currency",
  "governance_version",
  "experiments",
] as const

/** Lint a parsed registry document. */
export function lintExperimentRegistry(doc: unknown): RegistryLint {
  const out = new Findings()
  if (!closedObject(doc, TOP_LEVEL_FIELDS, "$", out)) return { ok: false, issues: out.issues }

  if (doc.schema !== EXPERIMENT_REGISTRY_SCHEMA) out.add("SCHEMA", "$.schema")
  if (doc.schema_version !== 1) out.add("SCHEMA", "$.schema_version")
  if (doc.business !== "ot") out.add("BUSINESS_NOT_OT", "$.business")
  if (doc.governance_version !== GOVERNANCE_VERSION) out.add("GOVERNANCE_VERSION", "$.governance_version")
  if (doc.currency !== OT_REGISTRY_CURRENCY) out.add("INVALID_CURRENCY", "$.currency")
  checkEnum(doc.registry_origin, REGISTRY_ORIGINS, "$.registry_origin", out)

  // An unrecognized origin is judged as owner-approved: the stricter reading.
  const origin: GovernanceOrigin = doc.registry_origin === "synthetic_fixture" ? "synthetic_fixture" : "owner_approved"
  const currency = doc.currency === OT_REGISTRY_CURRENCY ? OT_REGISTRY_CURRENCY : null

  const experiments = doc.experiments
  if (!Array.isArray(experiments)) {
    out.add("TYPE_ARRAY", "$.experiments")
    return { ok: false, issues: out.issues }
  }
  if (experiments.length > MAX_EXPERIMENTS) out.add("TOO_MANY_ITEMS", "$.experiments")

  const seenIds = new Set<string>()
  const checked: Checked[] = []
  // Array.from visits holes (as undefined), which forEach would skip.
  Array.from(experiments.slice(0, MAX_EXPERIMENTS)).forEach((experiment, index) => {
    const path = `$.experiments[${index}]`
    const result = lintExperiment(experiment, path, origin, currency, out)
    const id = isObject(experiment) ? experiment.experiment_id : undefined
    if (typeof id === "string") {
      if (seenIds.has(id)) out.add("DUPLICATE_EXPERIMENT_ID", `${path}.experiment_id`)
      seenIds.add(id)
    }
    if (result && checked.some((earlier) => earlier && earlier.segment === result.segment && earlier.start <= result.end && result.start <= earlier.end)) {
      out.add("EXPERIMENT_OVERLAP", path)
    }
    checked.push(result)
  })

  return out.issues.length === 0 ? { ok: true, experiments: experiments.length } : { ok: false, issues: out.issues }
}

/**
 * True when every number literal in `text` is a plain integer. `JSON.parse`
 * turns `50000.0` and `5e4` into integers, so a budget written as a float
 * would otherwise pass as one. Strings are skipped, escapes included.
 */
function hasOnlyIntegerLiterals(text: string): boolean {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      index += 1
      while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1
      index += 1
      continue
    }
    if (char === "-" || (char >= "0" && char <= "9")) {
      const literal = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index))?.[0] ?? char
      if (!/^-?(?:0|[1-9]\d*)$/.test(literal)) return false
      index += literal.length
      continue
    }
    index += 1
  }
  return true
}

/** Lint registry file text: strict integer literals, then the parsed document. */
export function lintExperimentRegistryText(text: string): RegistryLint {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, issues: [{ code: "INVALID_JSON", path: "$" }] }
  }
  if (!hasOnlyIntegerLiterals(text)) return { ok: false, issues: [{ code: "NON_INTEGER_NUMBER_LITERAL", path: "$" }] }
  return lintExperimentRegistry(parsed)
}
