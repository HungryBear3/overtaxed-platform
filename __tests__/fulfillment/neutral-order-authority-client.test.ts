/** @jest-environment node */
import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import {
  createNeutralOrderAuthorityResolver,
  resolveNeutralOrderAuthority,
} from "@/lib/fulfillment-runtime/neutral-order-authority"
import { NEUTRAL_REPORT_COMMERCE_POLICY, neutralOrderReservationKey } from "@/lib/commerce/neutral-report-policy"
import { neutralSettledAmountAuthority, trustedPaymentAuthority } from "@/lib/fulfillment-runtime/payment-authority"

type Db = Parameters<typeof createNeutralOrderAuthorityResolver>[0]["db"]

// The real production predicates the admitting UPDATE must carry. Both are
// value-free fragments, so their text appears verbatim in the composed SQL.
const AMOUNT = neutralSettledAmountAuthority("o")
const PAYMENT = trustedPaymentAuthority("o", true)
/** True only when BOTH predicates sit inside the admitting UPDATE ... RETURNING. */
function guardsBoth(sql: string): boolean {
  const start = sql.indexOf('UPDATE "ot_neutral_report_reservation"')
  const end = sql.indexOf("RETURNING r.*")
  if (start < 0 || end < start) return false
  const admitting = sql.slice(start, end)
  return admitting.includes(AMOUNT.sql) && admitting.includes(PAYMENT.sql)
}

const ORDER = "otrc_unit_order"
const hex = (s: string) => createHash("sha256").update(s).digest("hex")
const row = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER,
  propertyPin: "12345678901234",
  reservationId: "res_unit",
  reservationKey: neutralOrderReservationKey(ORDER),
  policyVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version,
  admissionSha256: hex("admission"),
  dataEvidenceSha256: hex("data"),
  deadlineEvidenceSha256: hex("deadline"),
  ...over,
})

/** Interactive-transaction double: records every Prisma.Sql and the commit/rollback outcome. */
function fakeDb(rows: unknown[], fail?: Error) {
  const queries: Prisma.Sql[] = []
  const events: string[] = []
  const tx = {
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      queries.push(query)
      if (queries.length === 1) return [{ locked: "" }]
      if (fail) throw fail
      return rows
    }),
  }
  const raw = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      events.push("begin")
      try {
        const result = await fn(tx)
        events.push("commit")
        return result
      } catch (error) {
        events.push("rollback")
        throw error
      }
    }),
  }
  return { db: raw as unknown as Db, raw, queries, events }
}

const ENV_KEYS = ["OT_NEUTRAL_DATABASE_URL", "OT_NEUTRAL_DATABASE_CA_PEM"] as const
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
beforeAll(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
})
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe("neutral order authority resolver factory", () => {
  test("admits through the injected transaction: advisory lock first, order id and policy bound as parameters", async () => {
    const f = fakeDb([row()])
    const resolve = createNeutralOrderAuthorityResolver({ db: f.db })
    await expect(resolve(ORDER)).resolves.toEqual({
      orderId: ORDER,
      propertyPin: "12345678901234",
      reservationId: "res_unit",
      admissionSha256: hex("admission"),
      dataEvidenceSha256: hex("data"),
      deadlineEvidenceSha256: hex("deadline"),
    })
    expect(f.raw.$transaction).toHaveBeenCalledTimes(1)
    expect(f.events).toEqual(["begin", "commit"])
    expect(f.queries).toHaveLength(2)
    expect(f.queries[0].text).toContain("pg_advisory_xact_lock(684921338)")
    expect(f.queries[0].values).toEqual([])
    expect(f.queries[1].text).toContain('UPDATE "ot_neutral_report_reservation"')
    expect(f.queries[1].text).not.toContain(ORDER)
    expect(f.queries[1].text).not.toContain(NEUTRAL_REPORT_COMMERCE_POLICY.version)
    expect(f.queries[1].values).toContain(ORDER)
    expect(f.queries[1].values).toContain(NEUTRAL_REPORT_COMMERCE_POLICY.version)
  })

  test("refuses empty and oversized ids without opening a transaction", async () => {
    const f = fakeDb([row()])
    const resolve = createNeutralOrderAuthorityResolver({ db: f.db })
    await expect(resolve("")).resolves.toBeNull()
    await expect(resolve("x".repeat(129))).resolves.toBeNull()
    expect(f.raw.$transaction).not.toHaveBeenCalled()
  })

  test.each([
    ["no admitted row", []],
    ["reservation key for another order", [row({ reservationKey: neutralOrderReservationKey("other") })]],
    ["malformed property PIN", [row({ propertyPin: "123" })]],
    ["non-hex admission digest", [row({ admissionSha256: "z".repeat(64) })]],
    ["uppercase data digest", [row({ dataEvidenceSha256: hex("data").toUpperCase() })]],
    ["missing deadline digest", [row({ deadlineEvidenceSha256: null })]],
  ])("post-validates after the transaction and returns null: %s", async (_label, rows) => {
    const f = fakeDb(rows)
    await expect(createNeutralOrderAuthorityResolver({ db: f.db })(ORDER)).resolves.toBeNull()
    expect(f.events).toEqual(["begin", "commit"])
  })

  test("propagates a transaction failure so the admission rolls back", async () => {
    const f = fakeDb([row()], new Error("synthetic admission failure"))
    await expect(createNeutralOrderAuthorityResolver({ db: f.db })(ORDER)).rejects.toThrow("synthetic admission failure")
    expect(f.events).toEqual(["begin", "rollback"])
  })

  test("admission SQL carries BOTH the trusted-payment and the settled-amount predicates inside the admitting UPDATE", async () => {
    const f = fakeDb([row()])
    await createNeutralOrderAuthorityResolver({ db: f.db })(ORDER)
    expect(AMOUNT.values).toEqual([])
    expect(PAYMENT.values).toEqual([])
    expect(guardsBoth(f.queries[1].sql)).toBe(true)
    // Anchors of the exact financial branches in the real fragments.
    for (const anchor of [
      `lower("o"."settledCurrency")='usd'`,
      `("o"."settledAmountCents"=6900 AND "o"."amountPaid"=69)`,
      `"o"."settledAmountCents"=0 AND "o"."amountPaid"=0`,
      `"o"."checkoutAmountCents"=6900 AND lower("o"."checkoutCurrency")='usd'`,
      `z."subtotal_cents" = 6900`,
      `z."discount_cents" = 6900`,
    ]) expect(AMOUNT.sql).toContain(anchor)
    for (const anchor of [
      `FROM "ot_neutral_runtime_payment_binding" b`,
      `b.payment_intent LIKE 'pi_%'`,
      `FROM "ot_neutral_runtime_settlement_reversal" r`,
      `FROM "ot_neutral_runtime_zero_total_settlement" z`,
      `"o"."settledAmountCents" = 0`,
    ]) expect(PAYMENT.sql).toContain(anchor)
  })

  test("mutation control: dropping or neutralising either predicate is detected", async () => {
    const f = fakeDb([row()])
    await createNeutralOrderAuthorityResolver({ db: f.db })(ORDER)
    const sql = f.queries[1].sql
    expect(guardsBoth(sql)).toBe(true)
    expect(guardsBoth(sql.replace(AMOUNT.sql, "TRUE"))).toBe(false)
    expect(guardsBoth(sql.replace(PAYMENT.sql, "TRUE"))).toBe(false)
    expect(guardsBoth(sql.replace(AMOUNT.sql, ""))).toBe(false)
    expect(guardsBoth(sql.replace(PAYMENT.sql, ""))).toBe(false)
  })

  // Bounded: these doubles return what a database WOULD return; they are not
  // database-executed financial truth. Native paid/zero/missing/mismatch/masq2/
  // rollback cases remain mandatory.
  test.each([
    ["ordinary paid (6900/69 with PaymentIntent binding)", "otrc_unit_paid"],
    ["zero-total (0/0 on 6900 USD with exact zero-total settlement)", "otrc_unit_zero"],
  ])("bounded positive, row double: %s order is admitted", async (_label, id) => {
    const f = fakeDb([row({ orderId: id, reservationKey: neutralOrderReservationKey(id) })])
    await expect(createNeutralOrderAuthorityResolver({ db: f.db })(id)).resolves.toEqual({
      orderId: id,
      propertyPin: "12345678901234",
      reservationId: "res_unit",
      admissionSha256: hex("admission"),
      dataEvidenceSha256: hex("data"),
      deadlineEvidenceSha256: hex("deadline"),
    })
    expect(f.queries[1].values).toContain(id)
    expect(guardsBoth(f.queries[1].sql)).toBe(true)
    expect(f.events).toEqual(["begin", "commit"])
  })

  test.each([
    ["settled-amount mismatch (e.g. 7900/79)", "otrc_unit_amount_mismatch"],
    ["missing payment authority (no binding, no zero-total row)", "otrc_unit_missing_authority"],
  ])("bounded negative, row double: %s matches no admitting row and is refused", async (_label, id) => {
    const f = fakeDb([])
    await expect(createNeutralOrderAuthorityResolver({ db: f.db })(id)).resolves.toBeNull()
    expect(f.queries[1].values).toContain(id)
    expect(guardsBoth(f.queries[1].sql)).toBe(true)
    expect(f.events).toEqual(["begin", "commit"])
  })

  test("the exported default stays lazy and env-bound; an injected client never feeds it", async () => {
    const f = fakeDb([row()])
    await createNeutralOrderAuthorityResolver({ db: f.db })(ORDER)
    await expect(resolveNeutralOrderAuthority("")).resolves.toBeNull()
    await expect(resolveNeutralOrderAuthority(ORDER)).rejects.toThrow("NEUTRAL_DATABASE_DISABLED")
    expect(f.raw.$transaction).toHaveBeenCalledTimes(1)
  })
})
