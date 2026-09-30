/**
 * The decision-grade OT funnel contract.
 *
 * Six events are the funnel: `free_check_started` (a reader submitted a check
 * that passed the surface's own validation), `free_check_completed` (a live
 * lookup produced an authoritative outcome), `free_check_qualified` (that
 * outcome was `supportive` — the one qualified outcome, derived from the
 * canonical outcome matrix, never from page arithmetic, never from the preview
 * fixture), `begin_checkout` (the server returned a hosted checkout URL for one
 * intent), `checkout_blocked` (it did not, for one closed reason — see
 * ./checkout-funnel) and `purchase` (the signed webhook settled the payment and
 * persisted PAID). One checkout intent ends in exactly one of `begin_checkout`
 * and `checkout_blocked`, so their sum is the number of checkout attempts.
 *
 * Browser events are closed: every parameter is listed below with its only
 * acceptable values, and `page_location`/`page_referrer` must be present and
 * EMPTY. Omitting them is not enough — gtag falls back to the browser's own
 * URL and referrer, which are text somebody else wrote.
 *
 * `purchase` and `refund` are server-only. No browser path may write them; the
 * purchase is a Measurement Protocol payload from the webhook winner, and its
 * shape is validated here too. GA4 is behavioral evidence. Paid revenue is
 * whatever the Stripe/order records say, never a GA4 number.
 *
 * Pure: no I/O, no framework, no environment reads.
 */

import { FREE_CHECK_OUTCOME_MATRIX } from "@/lib/free-check-outcome-contract"
import { sanitizeAnonymousGaIdentifiers } from "./ga4"
import { CHECKOUT_BLOCKED_REASONS } from "./checkout-funnel"
import { FREE_CHECK_INPUT_MODES, FREE_CHECK_SURFACES, FREE_CHECK_WINDOW_STATUSES } from "./free-check-funnel"

export const FUNNEL_CONTRACT_VERSION = "ot-funnel-contract-v2"

export const DECISION_FUNNEL_EVENTS = [
  "free_check_started",
  "free_check_completed",
  "free_check_qualified",
  "begin_checkout",
  "checkout_blocked",
  "purchase",
] as const
export type DecisionFunnelEvent = (typeof DECISION_FUNNEL_EVENTS)[number]

const SERVER_ONLY_EVENTS: ReadonlySet<string> = new Set(["purchase", "refund"])

/** Checkout tier codes: the only plans and purchase items. */
export const CHECKOUT_TIERS = ["T2", "T3"] as const

/** No offered checkout approaches this; a larger number is not a price. */
export const MAX_CHECKOUT_VALUE = 10_000

/**
 * The deterministic transaction id is the Stripe Checkout Session id. Its
 * shape is a sanity bound, not the privacy control: the value comes from the
 * signed webhook, never from a browser.
 */
export const CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]{1,200}$/

export type EventGrade = "decision" | "diagnostic"

export type BrowserValidation =
  | { ok: true; grade: EventGrade }
  | { ok: false; violations: string[] }

export type ServerValidation = { ok: true } | { ok: false; violations: string[] }

type Rule = (value: unknown) => boolean

const oneOf = (values: readonly unknown[]): Rule => (value) => values.includes(value)
const isBoolean: Rule = (value) => typeof value === "boolean"
const isEmptyString: Rule = (value) => value === ""

/** A positive whole-cent amount no larger than any offered checkout. */
const isAmount: Rule = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= MAX_CHECKOUT_VALUE &&
  Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

const OUTCOME_CODES = Array.from(new Set(FREE_CHECK_OUTCOME_MATRIX.map((row) => row.code)))
const OUTCOME_REASONS = [
  "none",
  ...Array.from(new Set(FREE_CHECK_OUTCOME_MATRIX.flatMap((row) => (row.reason ? [row.reason] : [])))),
]

const PAGE_CONTEXT: Record<string, Rule> = { page_location: isEmptyString, page_referrer: isEmptyString }

const OUTCOME_PARAMS: Record<string, Rule> = {
  surface: oneOf(FREE_CHECK_SURFACES),
  outcome_code: oneOf(OUTCOME_CODES),
  outcome_reason: oneOf(OUTCOME_REASONS),
  allow_checkout: isBoolean,
  window_status: oneOf(FREE_CHECK_WINDOW_STATUSES),
}

type BrowserEventSpec = {
  grade: EventGrade
  required: Record<string, Rule>
  optional: Record<string, Rule>
  /** Cross-field rule, run only once every field passed on its own. */
  coherent?: (params: Record<string, unknown>) => string | null
}

function matrixRow(params: Record<string, unknown>) {
  const reason = params.outcome_reason === "none" ? null : params.outcome_reason
  return FREE_CHECK_OUTCOME_MATRIX.find(
    (row) => row.code === params.outcome_code && row.reason === reason && row.allowCheckout === params.allow_checkout,
  )
}

const BROWSER_EVENTS: Readonly<Record<string, BrowserEventSpec>> = {
  free_check_started: {
    grade: "decision",
    required: { surface: oneOf(FREE_CHECK_SURFACES), input_mode: oneOf(FREE_CHECK_INPUT_MODES), ...PAGE_CONTEXT },
    optional: {},
  },
  free_check_completed: {
    grade: "decision",
    required: { ...OUTCOME_PARAMS, qualified: isBoolean, ...PAGE_CONTEXT },
    optional: {},
    coherent: (params) => {
      const row = matrixRow(params)
      if (!row || params.qualified !== (row.code === "supportive")) return "INCONSISTENT_OUTCOME"
      return null
    },
  },
  free_check_qualified: {
    grade: "decision",
    required: { ...OUTCOME_PARAMS, ...PAGE_CONTEXT },
    optional: {},
    coherent: (params) => {
      const row = matrixRow(params)
      if (!row) return "INCONSISTENT_OUTCOME"
      return row.code === "supportive" ? null : "NOT_A_QUALIFIED_OUTCOME"
    },
  },
  begin_checkout: {
    grade: "decision",
    required: { ...PAGE_CONTEXT },
    optional: { plan: oneOf(CHECKOUT_TIERS), value: isAmount },
  },
  checkout_blocked: {
    grade: "decision",
    required: { plan: oneOf(CHECKOUT_TIERS), blocked_reason: oneOf(CHECKOUT_BLOCKED_REASONS), ...PAGE_CONTEXT },
    optional: {},
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Own keys only: `constructor` or `__proto__` is a parameter name, not a member of Object.prototype. */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function checkFields(
  params: Record<string, unknown>,
  required: Record<string, Rule>,
  optional: Record<string, Rule>,
  unknownCode: string,
): string[] {
  const violations: string[] = []
  for (const key of Object.keys(params)) {
    if (!hasOwn(required, key) && !hasOwn(optional, key)) violations.push(`${unknownCode}:${key}`)
  }
  for (const [key, rule] of Object.entries(required)) {
    if (!hasOwn(params, key) || params[key] === undefined) violations.push(`MISSING_PARAM:${key}`)
    else if (!rule(params[key])) violations.push(`INVALID_VALUE:${key}`)
  }
  for (const [key, rule] of Object.entries(optional)) {
    if (hasOwn(params, key) && !rule(params[key])) violations.push(`INVALID_VALUE:${key}`)
  }
  return violations
}

export function isServerOnlyEventName(name: unknown): boolean {
  return typeof name === "string" && SERVER_ONLY_EVENTS.has(name)
}

/** Validate one event exactly as the sensitive browser boundary hands it to gtag. */
export function validateBrowserFunnelEvent(name: unknown, params: unknown): BrowserValidation {
  if (isServerOnlyEventName(name)) return { ok: false, violations: ["SERVER_ONLY_EVENT"] }
  const spec = typeof name === "string" && hasOwn(BROWSER_EVENTS, name) ? BROWSER_EVENTS[name] : undefined
  if (!spec) return { ok: false, violations: ["UNKNOWN_EVENT"] }
  if (!isPlainObject(params)) return { ok: false, violations: ["NOT_AN_OBJECT"] }

  const violations = checkFields(params, spec.required, spec.optional, "UNKNOWN_PARAM")
  if (violations.length === 0 && spec.coherent) {
    const incoherent = spec.coherent(params)
    if (incoherent) violations.push(incoherent)
  }
  return violations.length === 0 ? { ok: true, grade: spec.grade } : { ok: false, violations }
}

const isTier = oneOf(CHECKOUT_TIERS)

const PURCHASE_REQUIRED: Record<string, Rule> = {
  currency: oneOf(["USD"]),
  value: isAmount,
  transaction_id: (value) => typeof value === "string" && CHECKOUT_SESSION_ID_PATTERN.test(value),
  item_name: isTier,
  item_category: oneOf(["ot_checkout"]),
  item_variant: isTier,
  price: isAmount,
  quantity: oneOf([1]),
  items: (value) => Array.isArray(value) && value.length === 1 && isPlainObject(value[0]),
}

const PURCHASE_OPTIONAL: Record<string, Rule> = {
  ga_session_id: (value) =>
    Number.isSafeInteger(value) && sanitizeAnonymousGaIdentifiers({ gaSessionId: String(value) }).gaSessionId === String(value),
  ga_session_number: (value) =>
    Number.isSafeInteger(value) &&
    sanitizeAnonymousGaIdentifiers({ gaSessionNumber: String(value) }).gaSessionNumber === String(value),
}

const PURCHASE_ITEM: Record<string, Rule> = {
  item_name: isTier,
  item_category: oneOf(["ot_checkout"]),
  item_variant: isTier,
  price: isAmount,
  quantity: oneOf([1]),
}

/** The grade of a contract event, or `null` for an event the contract does not know. */
export function funnelEventGrade(name: unknown): EventGrade | null {
  if (name === "purchase") return "decision"
  if (typeof name !== "string" || !hasOwn(BROWSER_EVENTS, name)) return null
  return BROWSER_EVENTS[name].grade
}

/** Every parameter a contract event may carry; empty for an unknown event. */
export function funnelEventParameters(name: unknown): readonly string[] {
  if (name === "purchase") return [...Object.keys(PURCHASE_REQUIRED), ...Object.keys(PURCHASE_OPTIONAL)]
  if (typeof name !== "string" || !hasOwn(BROWSER_EVENTS, name)) return []
  const spec = BROWSER_EVENTS[name]
  return [...Object.keys(spec.required), ...Object.keys(spec.optional)]
}

/**
 * Validate the Measurement Protocol body the webhook sends for one settled,
 * durably PAID checkout. Closed at every level: no user_id, user_properties or
 * user_data, no URL, and no identifier other than the anonymous GA client and
 * session and the Checkout Session transaction id.
 */
export function validateServerPurchasePayload(payload: unknown): ServerValidation {
  if (!isPlainObject(payload)) return { ok: false, violations: ["NOT_AN_OBJECT"] }
  const violations: string[] = []
  for (const key of Object.keys(payload)) {
    if (key !== "client_id" && key !== "events") violations.push(`UNKNOWN_FIELD:${key}`)
  }
  const clientId = payload.client_id
  if (typeof clientId !== "string" || sanitizeAnonymousGaIdentifiers({ gaClientId: clientId }).gaClientId !== clientId) {
    violations.push("INVALID_VALUE:client_id")
  }

  const events = payload.events
  if (!Array.isArray(events) || events.length !== 1) return { ok: false, violations: [...violations, "EVENT_COUNT"] }
  const event = events[0]
  if (!isPlainObject(event) || event.name !== "purchase") return { ok: false, violations: [...violations, "EVENT_NAME"] }
  for (const key of Object.keys(event)) {
    if (key !== "name" && key !== "params") violations.push(`UNKNOWN_FIELD:${key}`)
  }
  if (!isPlainObject(event.params)) return { ok: false, violations: [...violations, "NOT_AN_OBJECT"] }

  const params = event.params
  violations.push(...checkFields(params, PURCHASE_REQUIRED, PURCHASE_OPTIONAL, "UNKNOWN_PARAM"))
  const item = Array.isArray(params.items) && isPlainObject(params.items[0]) ? params.items[0] : null
  if (item) violations.push(...checkFields(item, PURCHASE_ITEM, {}, "UNKNOWN_ITEM_PARAM"))

  if (violations.length === 0 && item) {
    if (params.value !== params.price || item.price !== params.price) violations.push("INCONSISTENT_AMOUNT")
    if (params.item_name !== params.item_variant) violations.push("INCONSISTENT_ITEM")
    for (const key of ["item_name", "item_category", "item_variant"] as const) {
      if (item[key] !== params[key]) {
        violations.push("INCONSISTENT_ITEM")
        break
      }
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
