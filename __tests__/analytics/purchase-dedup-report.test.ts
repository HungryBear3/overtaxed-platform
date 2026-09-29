/** @jest-environment node */

/**
 * The read-only purchase dedup report contract.
 *
 * The webhook deliberately re-sends the same deterministic transaction id when
 * a new Stripe event arrives for an already-paid order, trusting GA4 to count
 * one purchase per transaction. This contract is how an operator checks that
 * trust: an exact-match GA4 Data API report request for named transaction ids,
 * and a deterministic evaluation of the response. It builds a request and
 * reads a response; it never sends anything and reads no credential.
 */
import {
  buildPurchaseDedupReportRequest,
  evaluatePurchaseDedupReport,
  PURCHASE_DEDUP_REPORT_CONTRACT_VERSION,
} from "@/lib/analytics/purchase-dedup-report"

const TX_A = "cs_test_synthetic0000000001"
const TX_B = "cs_test_synthetic0000000002"

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    propertyId: "123456789",
    transactionIds: [TX_B, TX_A],
    startDate: "2026-09-01",
    endDate: "2026-09-28",
    ...overrides,
  }
}

function built() {
  const result = buildPurchaseDedupReportRequest(validInput())
  if (!result.ok) throw new Error(`unexpected rejection ${result.violations.join(",")}`)
  return result.request
}

function row(transactionId: string, count: string, eventName = "purchase") {
  return {
    dimensionValues: [{ value: transactionId }, { value: eventName }],
    metricValues: [{ value: count }],
  }
}

function response(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    dimensionHeaders: [{ name: "transactionId" }, { name: "eventName" }],
    metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
    ...(rows.length > 0 ? { rows, rowCount: rows.length } : {}),
    metadata: { currencyCode: "USD", timeZone: "America/Chicago" },
    kind: "analyticsData#runReport",
    ...extra,
  }
}

describe("the report request", () => {
  it("is an exact, read-only runReport request with the ids sorted", () => {
    expect(built()).toEqual({
      contract: PURCHASE_DEDUP_REPORT_CONTRACT_VERSION,
      method: "POST",
      url: "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
      oauthScope: "https://www.googleapis.com/auth/analytics.readonly",
      body: {
        dateRanges: [{ startDate: "2026-09-01", endDate: "2026-09-28" }],
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
                  inListFilter: { values: [TX_A, TX_B], caseSensitive: true },
                },
              },
            ],
          },
        },
        keepEmptyRows: false,
        limit: 1000,
        returnPropertyQuota: false,
      },
    })
  })

  it("is byte-identical whatever order the ids arrive in", () => {
    const reversed = buildPurchaseDedupReportRequest(validInput({ transactionIds: [TX_A, TX_B] }))

    expect(JSON.stringify(reversed)).toBe(JSON.stringify({ ok: true, request: built() }))
  })

  it.each([
    ["a property resource name instead of an id", { propertyId: "properties/123456789" }, "INVALID_PROPERTY_ID"],
    ["a zero-padded property id", { propertyId: "0123456789" }, "INVALID_PROPERTY_ID"],
    ["a payment intent", { transactionIds: ["pi_3Nabcdefghijklmn"] }, "INVALID_TRANSACTION_ID"],
    ["an id carrying URL syntax", { transactionIds: ["cs_live_abc?email=a@b.c"] }, "INVALID_TRANSACTION_ID"],
    ["an email", { transactionIds: ["buyer@example.com"] }, "INVALID_TRANSACTION_ID"],
    ["a repeated id", { transactionIds: [TX_A, TX_A] }, "DUPLICATE_TRANSACTION_ID"],
    ["no ids", { transactionIds: [] }, "TRANSACTION_ID_COUNT"],
    [
      "more ids than one exact report carries",
      { transactionIds: Array.from({ length: 51 }, (_, i) => `cs_test_synthetic${String(i).padStart(10, "0")}`) },
      "TRANSACTION_ID_COUNT",
    ],
    ["an impossible date", { startDate: "2026-02-30" }, "INVALID_DATE_RANGE"],
    ["a reversed range", { startDate: "2026-09-28", endDate: "2026-09-01" }, "INVALID_DATE_RANGE"],
    ["a range longer than a year", { startDate: "2025-01-01", endDate: "2026-09-28" }, "INVALID_DATE_RANGE"],
    ["a relative GA date", { endDate: "today" }, "INVALID_DATE_RANGE"],
    ["an unknown input field", { customerEmail: "buyer@example.com" }, "UNKNOWN_FIELD"],
  ])("rejects %s", (_label, overrides, violation) => {
    const result = buildPurchaseDedupReportRequest(validInput(overrides))

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.violations).toContain(violation)
  })
})

describe("evaluating the report", () => {
  it("passes when every requested transaction was recorded exactly once", () => {
    expect(evaluatePurchaseDedupReport(built(), response([row(TX_A, "1"), row(TX_B, "1")]))).toEqual({
      status: "PASS",
      transactions: [
        { transaction_id: TX_A, event_count: 1, verdict: "UNIQUE" },
        { transaction_id: TX_B, event_count: 1, verdict: "UNIQUE" },
      ],
      reasons: [],
    })
  })

  it("reports a transaction GA4 recorded more than once", () => {
    const result = evaluatePurchaseDedupReport(built(), response([row(TX_A, "2"), row(TX_B, "1")]))

    expect(result.status).toBe("DUPLICATE")
    expect(result.transactions[0]).toEqual({ transaction_id: TX_A, event_count: 2, verdict: "DUPLICATE" })
  })

  it("reports a requested transaction with no purchase row as not found", () => {
    const result = evaluatePurchaseDedupReport(built(), response([row(TX_B, "1")]))

    expect(result).toEqual({
      status: "NOT_FOUND",
      transactions: [
        { transaction_id: TX_A, event_count: 0, verdict: "NOT_FOUND" },
        { transaction_id: TX_B, event_count: 1, verdict: "UNIQUE" },
      ],
      reasons: [],
    })
  })

  it("treats an empty report as every transaction not found", () => {
    expect(evaluatePurchaseDedupReport(built(), response([])).status).toBe("NOT_FOUND")
  })

  it("ranks a duplicate above a missing transaction", () => {
    expect(evaluatePurchaseDedupReport(built(), response([row(TX_A, "3")])).status).toBe("DUPLICATE")
  })

  it.each([
    ["thresholded", { metadata: { subjectToThresholding: true } }, "THRESHOLDED"],
    ["sampled", { metadata: { samplingMetadatas: [{ samplesReadCount: "10", samplingSpaceSize: "100" }] } }, "SAMPLED"],
    ["collapsed into (other)", { metadata: { dataLossFromOtherRow: true } }, "OTHER_ROW"],
  ])("is inconclusive when the report is %s", (_label, extra, reason) => {
    const result = evaluatePurchaseDedupReport(built(), response([row(TX_A, "1"), row(TX_B, "1")], extra))

    expect(result.status).toBe("INCONCLUSIVE")
    expect(result.reasons).toEqual([reason])
  })

  it.each([
    ["a row for a transaction nobody asked about", [row("cs_test_synthetic0000000099", "1")], {}, "UNREQUESTED_TRANSACTION"],
    ["a row for another event", [row(TX_A, "1", "refund")], {}, "FILTER_NOT_HONORED"],
    ["a fractional count", [row(TX_A, "1.5")], {}, "BAD_COUNT"],
    ["a zero count row", [row(TX_A, "0")], {}, "BAD_COUNT"],
    ["the same transaction twice", [row(TX_A, "1"), row(TX_A, "1")], {}, "DUPLICATE_ROW"],
    ["a row count that disagrees", [row(TX_A, "1")], { rowCount: 5 }, "ROW_COUNT_MISMATCH"],
    ["different dimension headers", [row(TX_A, "1")], { dimensionHeaders: [{ name: "transactionId" }] }, "HEADERS"],
    ["an unknown top-level field", [row(TX_A, "1")], { debug: "x" }, "UNKNOWN_FIELD"],
  ])("is an invalid response for %s", (_label, rows, extra, reason) => {
    const result = evaluatePurchaseDedupReport(built(), response(rows, extra))

    expect(result.status).toBe("INVALID_RESPONSE")
    expect(result.reasons).toContain(reason)
    expect(result.transactions).toEqual([])
  })

  it("refuses a request it did not build", () => {
    const forged = { ...built(), url: "https://analyticsdata.googleapis.com/v1beta/properties/999:runReport" }

    expect(evaluatePurchaseDedupReport(forged, response([row(TX_A, "1")]))).toEqual({
      status: "INVALID_RESPONSE",
      transactions: [],
      reasons: ["REQUEST_NOT_FROM_CONTRACT"],
    })
    expect(evaluatePurchaseDedupReport(built(), "not json").status).toBe("INVALID_RESPONSE")
  })
})

describe("read-only and offline", () => {
  it("never touches the network or the environment", () => {
    const originalFetch = global.fetch
    const fetchSpy = jest.fn(() => {
      throw new Error("network is out of bounds")
    })
    global.fetch = fetchSpy as unknown as typeof fetch
    const originalEnv = process.env
    const readKeys: string[] = []
    process.env = new Proxy(originalEnv, {
      get(target, key) {
        if (typeof key === "string") readKeys.push(key)
        return Reflect.get(target, key)
      },
    })

    try {
      const request = built()
      evaluatePurchaseDedupReport(request, response([row(TX_A, "1"), row(TX_B, "2")]))
    } finally {
      process.env = originalEnv
      global.fetch = originalFetch
    }

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(readKeys).toEqual([])
  })
})
