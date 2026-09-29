/**
 * Read-only purchase dedup report: request contract and evaluation.
 *
 * The webhook sends the purchase with the Stripe Checkout Session id as its
 * deterministic transaction id, and re-sends that same id when a new Stripe
 * event arrives for an already-paid order. That design relies on GA4 recording
 * one purchase per transaction id. This module is how the reliance is checked:
 *
 *   - `buildPurchaseDedupReportRequest` produces the exact GA4 Data API
 *     `runReport` request — eventName EXACT `purchase` AND transactionId IN
 *     the named ids, case-sensitive, one row per transaction — for an operator
 *     to run under the read-only Analytics scope. It sends nothing.
 *   - `evaluatePurchaseDedupReport` turns the response into one verdict per
 *     requested transaction: UNIQUE (1), DUPLICATE (>1) or NOT_FOUND (0; GA4
 *     processing can lag, so rerun after the freshness window before acting).
 *     A thresholded, sampled or (other)-collapsed report is INCONCLUSIVE, and
 *     any response the request could not have produced is INVALID_RESPONSE.
 *
 * GA4 counts here are behavioral evidence about GA4 itself. Paid orders and
 * revenue remain whatever the Stripe/order records say.
 *
 * Pure: no network, no credentials, no environment reads.
 */

import { CHECKOUT_SESSION_ID_PATTERN } from "./funnel-contract"

export const PURCHASE_DEDUP_REPORT_CONTRACT_VERSION = "ot-purchase-dedup-report-v1"

const DATA_API_READ_ONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const PROPERTY_ID_PATTERN = /^[1-9]\d{5,11}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const COUNT_PATTERN = /^[1-9]\d{0,9}$/
const MAX_TRANSACTION_IDS = 50
const MAX_RANGE_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000
const ROW_LIMIT = 1000

const INPUT_FIELDS = ["propertyId", "transactionIds", "startDate", "endDate"]
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

export type PurchaseDedupReportInput = {
  propertyId: string
  transactionIds: readonly string[]
  startDate: string
  endDate: string
}

export type PurchaseDedupReportRequest = {
  contract: typeof PURCHASE_DEDUP_REPORT_CONTRACT_VERSION
  method: "POST"
  url: string
  oauthScope: typeof DATA_API_READ_ONLY_SCOPE
  body: Record<string, unknown>
}

export type TransactionVerdict = {
  transaction_id: string
  event_count: number
  verdict: "UNIQUE" | "DUPLICATE" | "NOT_FOUND"
}

export type PurchaseDedupEvaluation = {
  status: "PASS" | "DUPLICATE" | "NOT_FOUND" | "INCONCLUSIVE" | "INVALID_RESPONSE"
  transactions: TransactionVerdict[]
  reasons: string[]
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Epoch ms of a real calendar date, or null. `2026-02-30` is not a date. */
function calendarDate(value: unknown): number | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null
  return ms
}

export function buildPurchaseDedupReportRequest(
  input: unknown,
): { ok: true; request: PurchaseDedupReportRequest } | { ok: false; violations: string[] } {
  if (!isObject(input)) return { ok: false, violations: ["NOT_AN_OBJECT"] }
  const violations: string[] = []
  if (Object.keys(input).some((key) => !INPUT_FIELDS.includes(key))) violations.push("UNKNOWN_FIELD")

  const propertyId = input.propertyId
  if (typeof propertyId !== "string" || !PROPERTY_ID_PATTERN.test(propertyId)) violations.push("INVALID_PROPERTY_ID")

  const ids = input.transactionIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_TRANSACTION_IDS) {
    violations.push("TRANSACTION_ID_COUNT")
  } else {
    if (ids.some((id) => typeof id !== "string" || !CHECKOUT_SESSION_ID_PATTERN.test(id))) {
      violations.push("INVALID_TRANSACTION_ID")
    }
    if (new Set(ids).size !== ids.length) violations.push("DUPLICATE_TRANSACTION_ID")
  }

  const start = calendarDate(input.startDate)
  const end = calendarDate(input.endDate)
  if (start === null || end === null || start > end || (end - start) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    violations.push("INVALID_DATE_RANGE")
  }

  if (violations.length > 0) return { ok: false, violations }

  const sorted = [...(ids as string[])].sort()
  return {
    ok: true,
    request: {
      contract: PURCHASE_DEDUP_REPORT_CONTRACT_VERSION,
      method: "POST",
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId as string}:runReport`,
      oauthScope: DATA_API_READ_ONLY_SCOPE,
      body: {
        dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
        dimensions: [{ name: "transactionId" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: "eventName",
                  stringFilter: { matchType: "EXACT", value: "purchase", caseSensitive: true },
                },
              },
              {
                filter: {
                  fieldName: "transactionId",
                  inListFilter: { values: sorted, caseSensitive: true },
                },
              },
            ],
          },
        },
        keepEmptyRows: false,
        limit: ROW_LIMIT,
        returnPropertyQuota: false,
      },
    },
  }
}

/**
 * Recover the builder's input from a request and rebuild it. A request that
 * does not rebuild byte-for-byte was not produced by this contract.
 */
function requestedIds(request: unknown): string[] | null {
  if (!isObject(request) || !isObject(request.body)) return null
  const body = request.body
  const url = typeof request.url === "string" ? request.url : ""
  const propertyId = /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/([^/:]+):runReport$/.exec(url)?.[1]
  const range = Array.isArray(body.dateRanges) && isObject(body.dateRanges[0]) ? body.dateRanges[0] : {}
  const filter = isObject(body.dimensionFilter) ? body.dimensionFilter : {}
  const expressions = isObject(filter.andGroup) && Array.isArray(filter.andGroup.expressions) ? filter.andGroup.expressions : []
  const idFilter = expressions[1] as { filter?: { inListFilter?: { values?: unknown } } } | undefined
  const values = idFilter?.filter?.inListFilter?.values

  const rebuilt = buildPurchaseDedupReportRequest({
    propertyId,
    transactionIds: values,
    startDate: range.startDate,
    endDate: range.endDate,
  })
  if (!rebuilt.ok || JSON.stringify(rebuilt.request) !== JSON.stringify(request)) return null
  return values as string[]
}

function invalid(...reasons: string[]): PurchaseDedupEvaluation {
  return { status: "INVALID_RESPONSE", transactions: [], reasons }
}

export function evaluatePurchaseDedupReport(request: unknown, response: unknown): PurchaseDedupEvaluation {
  const ids = requestedIds(request)
  if (!ids) return invalid("REQUEST_NOT_FROM_CONTRACT")
  if (!isObject(response)) return invalid("NOT_AN_OBJECT")
  if (Object.keys(response).some((key) => !RESPONSE_FIELDS.has(key))) return invalid("UNKNOWN_FIELD")
  if (
    JSON.stringify(response.dimensionHeaders) !== JSON.stringify([{ name: "transactionId" }, { name: "eventName" }]) ||
    JSON.stringify(response.metricHeaders) !== JSON.stringify([{ name: "eventCount", type: "TYPE_INTEGER" }])
  ) {
    return invalid("HEADERS")
  }

  const rows = response.rows ?? []
  if (!Array.isArray(rows)) return invalid("ROWS")
  if (response.rowCount !== undefined && response.rowCount !== rows.length) return invalid("ROW_COUNT_MISMATCH")

  const counts = new Map<string, number>()
  for (const row of rows) {
    const dimensions = isObject(row) && Array.isArray(row.dimensionValues) ? row.dimensionValues : []
    const metrics = isObject(row) && Array.isArray(row.metricValues) ? row.metricValues : []
    if (dimensions.length !== 2 || metrics.length !== 1) return invalid("ROW_SHAPE")
    const transactionId = isObject(dimensions[0]) ? dimensions[0].value : undefined
    const eventName = isObject(dimensions[1]) ? dimensions[1].value : undefined
    const count = isObject(metrics[0]) ? metrics[0].value : undefined
    if (eventName !== "purchase") return invalid("FILTER_NOT_HONORED")
    if (typeof transactionId !== "string" || !ids.includes(transactionId)) return invalid("UNREQUESTED_TRANSACTION")
    if (typeof count !== "string" || !COUNT_PATTERN.test(count)) return invalid("BAD_COUNT")
    if (counts.has(transactionId)) return invalid("DUPLICATE_ROW")
    counts.set(transactionId, Number(count))
  }

  const metadata = isObject(response.metadata) ? response.metadata : {}
  const quality = [
    ...(metadata.subjectToThresholding === true ? ["THRESHOLDED"] : []),
    ...(Array.isArray(metadata.samplingMetadatas) && metadata.samplingMetadatas.length > 0 ? ["SAMPLED"] : []),
    ...(metadata.dataLossFromOtherRow === true ? ["OTHER_ROW"] : []),
  ]

  const transactions: TransactionVerdict[] = ids.map((transactionId) => {
    const eventCount = counts.get(transactionId) ?? 0
    return {
      transaction_id: transactionId,
      event_count: eventCount,
      verdict: eventCount === 0 ? "NOT_FOUND" : eventCount === 1 ? "UNIQUE" : "DUPLICATE",
    }
  })

  if (quality.length > 0) return { status: "INCONCLUSIVE", transactions, reasons: quality }
  const verdicts = new Set(transactions.map((transaction) => transaction.verdict))
  const status = verdicts.has("DUPLICATE") ? "DUPLICATE" : verdicts.has("NOT_FOUND") ? "NOT_FOUND" : "PASS"
  return { status, transactions, reasons: [] }
}
