/**
 * The GA4 Admin checklist for the OT property, and the read-only readback
 * verification that proves a property matches it.
 *
 * The checklist (data/analytics/ot-ga4-admin-checklist.v3.json) names the only
 * event-scoped custom dimensions and key events the property should carry.
 * `purchase` is the only permitted key event. It also names the web stream's
 * Enhanced Measurement settings that must be OFF: browser-history page changes
 * (the app sends its own governed SPA page_view, and the automatic one
 * duplicates it with the raw URL) and site search (it lifts raw query values
 * into events). Every item is an owner action
 * whose status is `pending`: nothing in this repository writes to GA4, so no
 * item can be marked done here — a matching readback is the only evidence.
 * Each must trace to a decision-grade event in the funnel contract
 * (./funnel-contract): a dimension may register only a parameter that every
 * event it lists actually carries, and never a reserved parameter — the empty
 * page context, the Checkout Session transaction id, the GA session fields or
 * the built-in ecommerce fields. Registering one of those would either
 * duplicate a built-in or promote an identifier into a reporting column.
 *
 * Verification compares an operator-captured readback of two read-only Admin
 * API list calls against the checklist as exact sets, and one read-only GET of
 * the web stream's Enhanced Measurement settings against the required OFF
 * values. It makes no request and
 * reads no credential: the readback is data handed in, and an incomplete
 * (paginated) or malformed readback fails closed rather than passing on what
 * it happened to contain.
 */

import { FUNNEL_CONTRACT_VERSION, funnelEventGrade, funnelEventParameters } from "./funnel-contract"

export const GA4_ADMIN_READ_ONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"

const READBACK_CALLS = [
  "GET /v1beta/properties/{property_id}/customDimensions",
  "GET /v1beta/properties/{property_id}/keyEvents",
  "GET /v1alpha/properties/{property_id}/dataStreams/{data_stream_id}/enhancedMeasurementSettings",
]

/**
 * The Enhanced Measurement settings the checklist must require OFF, each bound
 * to the one field of the EnhancedMeasurementSettings resource that reads it.
 * Closed: the checklist may name no other setting.
 */
const ENHANCED_MEASUREMENT_FIELDS: Readonly<Record<string, string>> = {
  browser_history: "pageChangesEnabled",
  site_search: "siteSearchEnabled",
}

const ENHANCED_MEASUREMENT_RESOURCE = /^properties\/\d+\/dataStreams\/\d+\/enhancedMeasurementSettings$/

const RESERVED_PARAMETERS: ReadonlySet<string> = new Set([
  "page_location",
  "page_referrer",
  "value",
  "currency",
  "transaction_id",
  "price",
  "quantity",
  "items",
  "item_name",
  "item_category",
  "item_variant",
  "ga_session_id",
  "ga_session_number",
])

const COUNTING_METHODS: ReadonlySet<string> = new Set(["ONCE_PER_EVENT", "ONCE_PER_SESSION"])

/** Only the server-owned, ledger-backed purchase may be a key event. */
const PERMITTED_KEY_EVENTS: ReadonlySet<string> = new Set(["purchase"])

/** A parameter name safe to echo in a finding. Anything else is redacted. */
const SAFE_TOKEN = /^[a-z][a-z0-9_]{0,39}$/
const DISPLAY_NAME = /^[A-Za-z][A-Za-z0-9 _]{0,81}$/
const SENSITIVE_NAME =
  /pin|parcel|property|address|street|email|phone|name|customer|user|client|order|transaction|session|stripe|payment|intent|appeal|assessment|comparable|township|location|referrer|url|query|gclid|fbclid/

export type ChecklistValidation = { ok: true } | { ok: false; violations: string[] }
export type ReadbackVerification = { status: "PASS" | "FAIL"; findings: string[] }

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function label(value: unknown): string {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : "[redacted]"
}

function closedKeys(value: Json, allowed: readonly string[], violations: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) violations.push(`UNKNOWN_KEY:${label(key)}`)
  }
}

function isRationale(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 400
}

function validateDimension(dimension: unknown, violations: string[]): string | null {
  if (!isObject(dimension)) {
    violations.push("MALFORMED_DIMENSION")
    return null
  }
  closedKeys(dimension, ["parameter_name", "display_name", "scope", "events", "status", "rationale"], violations)
  const parameter = dimension.parameter_name
  if (typeof parameter !== "string" || !SAFE_TOKEN.test(parameter)) {
    violations.push("INVALID_PARAMETER_NAME")
    return null
  }
  if (RESERVED_PARAMETERS.has(parameter)) violations.push(`RESERVED_PARAMETER:${parameter}`)
  if (dimension.scope !== "EVENT") violations.push(`INVALID_SCOPE:${parameter}`)
  if (typeof dimension.display_name !== "string" || !DISPLAY_NAME.test(dimension.display_name)) {
    violations.push(`INVALID_DISPLAY_NAME:${parameter}`)
  }
  if (!isRationale(dimension.rationale)) violations.push(`INVALID_RATIONALE:${parameter}`)
  if (dimension.status !== "pending") violations.push(`INVALID_STATUS:${parameter}`)

  const events = dimension.events
  if (!Array.isArray(events) || events.length === 0 || new Set(events).size !== events.length) {
    violations.push(`INVALID_EVENTS:${parameter}`)
    return parameter
  }
  for (const event of events) {
    if (funnelEventGrade(event) !== "decision") {
      violations.push(`EVENT_NOT_DECISION_GRADE:${label(event)}`)
    } else if (!funnelEventParameters(event).includes(parameter)) {
      violations.push(`PARAMETER_NOT_IN_CONTRACT:${parameter}`)
    }
  }
  return parameter
}

function validateKeyEvent(keyEvent: unknown, violations: string[]): string | null {
  if (!isObject(keyEvent)) {
    violations.push("MALFORMED_KEY_EVENT")
    return null
  }
  closedKeys(keyEvent, ["event_name", "counting_method", "status", "rationale"], violations)
  const name = keyEvent.event_name
  if (funnelEventGrade(name) !== "decision") {
    violations.push(`EVENT_NOT_DECISION_GRADE:${label(name)}`)
    return null
  }
  const eventName = name as string
  if (!PERMITTED_KEY_EVENTS.has(eventName)) violations.push(`KEY_EVENT_NOT_PERMITTED:${eventName}`)
  if (typeof keyEvent.counting_method !== "string" || !COUNTING_METHODS.has(keyEvent.counting_method)) {
    violations.push(`INVALID_COUNTING_METHOD:${eventName}`)
  }
  if (!isRationale(keyEvent.rationale)) violations.push(`INVALID_RATIONALE:${eventName}`)
  if (keyEvent.status !== "pending") violations.push(`INVALID_STATUS:${eventName}`)
  return eventName
}

function validateEnhancedMeasurement(settings: unknown, violations: string[]): void {
  const seen = new Set<string>()
  for (const item of Array.isArray(settings) ? settings : []) {
    if (!isObject(item)) {
      violations.push("MALFORMED_ENHANCED_MEASUREMENT")
      continue
    }
    closedKeys(item, ["setting", "readback_field", "required_value", "status", "rationale"], violations)
    const setting = item.setting
    if (typeof setting !== "string" || !Object.hasOwn(ENHANCED_MEASUREMENT_FIELDS, setting)) {
      violations.push(`UNKNOWN_ENHANCED_MEASUREMENT_SETTING:${label(setting)}`)
      continue
    }
    if (seen.has(setting)) violations.push(`DUPLICATE_ENHANCED_MEASUREMENT:${setting}`)
    seen.add(setting)
    if (item.readback_field !== ENHANCED_MEASUREMENT_FIELDS[setting]) {
      violations.push(`ENHANCED_MEASUREMENT_FIELD:${setting}`)
    }
    if (item.required_value !== false) violations.push(`ENHANCED_MEASUREMENT_MUST_BE_OFF:${setting}`)
    if (!isRationale(item.rationale)) violations.push(`INVALID_RATIONALE:${setting}`)
    if (item.status !== "pending") violations.push(`INVALID_STATUS:${setting}`)
  }
  if (settings !== undefined && !Array.isArray(settings)) violations.push("MALFORMED_ENHANCED_MEASUREMENT")
  for (const setting of Object.keys(ENHANCED_MEASUREMENT_FIELDS)) {
    if (!seen.has(setting)) violations.push(`ENHANCED_MEASUREMENT_REQUIRED:${setting}`)
  }
}

function validateReadbackSection(readback: unknown, violations: string[]): void {
  if (!isObject(readback)) {
    violations.push("MALFORMED_READBACK_CONTRACT")
    return
  }
  closedKeys(readback, ["api", "oauth_scope", "calls", "match"], violations)
  if (readback.api !== "analyticsadmin.googleapis.com") violations.push("READBACK_API")
  if (readback.oauth_scope !== GA4_ADMIN_READ_ONLY_SCOPE) violations.push("READBACK_SCOPE_NOT_READ_ONLY")
  if (JSON.stringify(readback.calls) !== JSON.stringify(READBACK_CALLS)) violations.push("READBACK_CALLS")
  if (readback.match !== "exact_set") violations.push("READBACK_MATCH")
}

/** Validate a checklist document against its own schema and the funnel contract. */
export function validateGa4AdminChecklist(checklist: unknown): ChecklistValidation {
  if (!isObject(checklist)) return { ok: false, violations: ["NOT_AN_OBJECT"] }
  const violations: string[] = []
  closedKeys(
    checklist,
    [
      "schema",
      "schema_version",
      "business",
      "funnel_contract_version",
      "custom_dimensions",
      "key_events",
      "enhanced_measurement",
      "readback",
    ],
    violations,
  )
  if (checklist.schema !== "ot.ga4_admin_checklist" || checklist.schema_version !== 3) violations.push("SCHEMA")
  if (checklist.business !== "ot") violations.push("BUSINESS")
  if (checklist.funnel_contract_version !== FUNNEL_CONTRACT_VERSION) violations.push("CONTRACT_VERSION_MISMATCH")

  const seenDimensions = new Set<string>()
  for (const dimension of Array.isArray(checklist.custom_dimensions) ? checklist.custom_dimensions : [null]) {
    const parameter = validateDimension(dimension, violations)
    if (parameter && seenDimensions.has(parameter)) violations.push(`DUPLICATE_DIMENSION:${parameter}`)
    if (parameter) seenDimensions.add(parameter)
  }

  const seenKeyEvents = new Set<string>()
  for (const keyEvent of Array.isArray(checklist.key_events) ? checklist.key_events : [null]) {
    const eventName = validateKeyEvent(keyEvent, violations)
    if (eventName && seenKeyEvents.has(eventName)) violations.push(`DUPLICATE_KEY_EVENT:${eventName}`)
    if (eventName) seenKeyEvents.add(eventName)
  }
  if (!seenKeyEvents.has("purchase")) violations.push("PURCHASE_KEY_EVENT_REQUIRED")

  validateEnhancedMeasurement(checklist.enhanced_measurement, violations)

  validateReadbackSection(checklist.readback, violations)
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}

type ReadbackList = { items: Json[]; paged: boolean } | null

/** One list response. The Admin API omits the list field when it is empty. */
function readList(response: unknown, field: string, required: readonly string[]): ReadbackList {
  if (!isObject(response)) return null
  const list = response[field] ?? []
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (!isObject(item) || required.some((key) => typeof item[key] !== "string")) return null
  }
  const token = response.nextPageToken
  if (token !== undefined && typeof token !== "string") return null
  return { items: list as Json[], paged: typeof token === "string" && token.length > 0 }
}

/**
 * One Enhanced Measurement settings body. The Admin API emits proto3 JSON, so a
 * false boolean may be omitted; anything present must be a real boolean, and
 * the resource name must be a web stream's settings resource.
 */
function readEnhancedMeasurement(response: unknown): Record<string, boolean> | null {
  if (!isObject(response)) return null
  if (typeof response.name !== "string" || !ENHANCED_MEASUREMENT_RESOURCE.test(response.name)) return null
  const values: Record<string, boolean> = {}
  for (const field of Object.values(ENHANCED_MEASUREMENT_FIELDS)) {
    const value = response[field]
    if (value !== undefined && typeof value !== "boolean") return null
    values[field] = value === true
  }
  return values
}

/**
 * Compare a readback — `{ customDimensions, keyEvents, enhancedMeasurementSettings }`,
 * each the exact body of its read-only call — against a valid checklist: the
 * two lists as exact sets, and each required Enhanced Measurement setting OFF.
 */
export function verifyGa4AdminReadback(checklist: unknown, readback: unknown): ReadbackVerification {
  if (!validateGa4AdminChecklist(checklist).ok) return { status: "FAIL", findings: ["INVALID_CHECKLIST"] }
  const expected = checklist as {
    custom_dimensions: Array<{ parameter_name: string; display_name: string }>
    key_events: Array<{ event_name: string; counting_method: string }>
  }

  if (
    !isObject(readback) ||
    Object.keys(readback).sort().join(",") !== "customDimensions,enhancedMeasurementSettings,keyEvents"
  ) {
    return { status: "FAIL", findings: ["MALFORMED_READBACK"] }
  }
  const dimensions = readList(readback.customDimensions, "customDimensions", ["parameterName", "displayName", "scope"])
  const keyEvents = readList(readback.keyEvents, "keyEvents", ["eventName", "countingMethod"])
  const enhancedMeasurement = readEnhancedMeasurement(readback.enhancedMeasurementSettings)
  if (!dimensions || !keyEvents || !enhancedMeasurement) return { status: "FAIL", findings: ["MALFORMED_READBACK"] }

  const incomplete = [
    ...(dimensions.paged ? ["PAGINATION_INCOMPLETE:customDimensions"] : []),
    ...(keyEvents.paged ? ["PAGINATION_INCOMPLETE:keyEvents"] : []),
  ]
  if (incomplete.length > 0) return { status: "FAIL", findings: incomplete }

  const findings = new Set<string>()
  const seen = new Set<string>()
  for (const actual of dimensions.items) {
    const parameter = actual.parameterName as string
    const name = label(parameter)
    if (seen.has(parameter)) findings.add(`DUPLICATE_DIMENSION:${name}`)
    seen.add(parameter)
    const want = expected.custom_dimensions.find((dimension) => dimension.parameter_name === parameter)
    if (!want) {
      findings.add(`UNEXPECTED_DIMENSION:${name}`)
      if (name !== "[redacted]" && SENSITIVE_NAME.test(name)) findings.add(`SENSITIVE_DIMENSION:${name}`)
      continue
    }
    if (actual.scope !== "EVENT") findings.add(`WRONG_SCOPE:${name}`)
    if (actual.displayName !== want.display_name) findings.add(`WRONG_DISPLAY_NAME:${name}`)
  }
  for (const want of expected.custom_dimensions) {
    if (!seen.has(want.parameter_name)) findings.add(`MISSING_DIMENSION:${want.parameter_name}`)
  }

  const seenEvents = new Set<string>()
  for (const actual of keyEvents.items) {
    const eventName = actual.eventName as string
    const name = label(eventName)
    if (seenEvents.has(eventName)) findings.add(`DUPLICATE_KEY_EVENT:${name}`)
    seenEvents.add(eventName)
    const want = expected.key_events.find((keyEvent) => keyEvent.event_name === eventName)
    if (!want) findings.add(`UNEXPECTED_KEY_EVENT:${name}`)
    else if (actual.countingMethod !== want.counting_method) findings.add(`WRONG_COUNTING_METHOD:${name}`)
  }
  for (const want of expected.key_events) {
    if (!seenEvents.has(want.event_name)) findings.add(`MISSING_KEY_EVENT:${want.event_name}`)
  }

  for (const [setting, field] of Object.entries(ENHANCED_MEASUREMENT_FIELDS)) {
    if (enhancedMeasurement[field]) findings.add(`ENHANCED_MEASUREMENT_ON:${setting}`)
  }

  const sorted = Array.from(findings).sort()
  return { status: sorted.length === 0 ? "PASS" : "FAIL", findings: sorted }
}
