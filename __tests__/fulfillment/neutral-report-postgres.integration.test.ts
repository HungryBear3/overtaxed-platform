/** @jest-environment node */
import { Client } from "pg"

jest.mock("server-only", () => ({}), { virtual: true })

const directUrl = process.env.OT_NEUTRAL_TEST_DIRECT_URL
const runtimeUrl = process.env.OT_NEUTRAL_TEST_RUNTIME_URL
const appUrl=process.env.OT_NEUTRAL_TEST_APP_URL
const native = directUrl && runtimeUrl && appUrl ? describe : describe.skip

native("neutral-report native PostgreSQL acceptance", () => {
  const owner = new Client({ connectionString: directUrl })
  const app=new Client({connectionString:appUrl})
  beforeAll(async () => { await owner.connect();await app.connect() })
  afterAll(async () => {
    const { disconnectNeutralPrisma } = await import("@/lib/fulfillment-runtime/neutral-db")
    await disconnectNeutralPrisma()
    await owner.end();await app.end()
  })

  test("atomic reservation enforces checkout contract, idempotency, RLS, and pilot capacity", async () => {
    process.env.DATABASE_URL = appUrl
    process.env.OT_NEUTRAL_DATABASE_URL = runtimeUrl
    process.env.OT_NEUTRAL_REPORT_CHECKOUT_ENABLED = "true"
    const { reserveNeutralCheckoutOrder } = await import("@/lib/fulfillment-runtime/neutral-report-repository")
    const policy = "ot-neutral-records-report/2026-09-15"
    const now = new Date().toISOString()
    const digest = (c: string) => c.repeat(64)
    const ids = Array.from({ length: 12 }, (_, i) => `native-neutral-${i}`)
    await owner.query(`delete from ot_neutral_blob_attempt where reservation_id in (select id from ot_neutral_report_reservation where order_id = any($1))`, [ids])
    await owner.query(`delete from ot_neutral_report_reservation where order_id = any($1)`, [ids])
    await owner.query(`delete from ot_order where id = any($1)`, [ids])
    for (let i = 0; i < ids.length; i++) {
      const pin = String(10000000000000 + i)
      await app.query(`insert into ot_order (id,tier,email,"propertyPin","eligibilitySnapshot","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency",status,"createdAt","updatedAt") values ($1,'T2','native@example.invalid',$2,$3::jsonb,'price_69','prod_neutral',6900,'usd','CHECKOUT_PENDING',now(),now())`, [ids[i], pin, JSON.stringify({ policyVersion: policy })])
    }
    const reserve = (i: number) => reserveNeutralCheckoutOrder({ orderId: ids[i], propertyPin: String(10000000000000 + i), dataEvidenceSha256: digest("a"), sourceContentSha256: digest("b"), officialRetrievedAt: now, officialOldestRetrievedAt:now, deadlineEvidenceSha256: digest("c"), deadlineIdentitySha256: digest("d"), deadlineRetrievedAt: now, admissionSha256: digest("e") })
    const duplicate = await Promise.all([reserve(0), reserve(0)])
    expect(duplicate).toEqual([{ ok: true }, { ok: true }])
    const admitted = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve(i)))
    expect(admitted.every(result => result.ok)).toBe(true)
    expect((await reserve(10)).ok).toBe(false)
    const partial = await reserveNeutralCheckoutOrder({ ...(await admission(ids[11], now)), propertyPin: "99999999999999" })
    expect(partial.ok).toBe(false)

    const runtime = new Client({ connectionString: runtimeUrl }); await runtime.connect()
    try {
      await expect(runtime.query("delete from ot_neutral_report_reservation where false")).rejects.toThrow()
      const rows = await runtime.query("select count(*)::int as n from ot_neutral_report_reservation where order_id = any($1)", [ids])
      expect(rows.rows[0].n).toBe(10)
    } finally { await runtime.end() }
  })
})

async function admission(orderId: string, now: string) {
  const digest = (c: string) => c.repeat(64)
  return { orderId, dataEvidenceSha256: digest("a"), sourceContentSha256: digest("b"), officialRetrievedAt: now, officialOldestRetrievedAt:now, deadlineEvidenceSha256: digest("c"), deadlineIdentitySha256: digest("d"), deadlineRetrievedAt: now, admissionSha256: digest("e") }
}
