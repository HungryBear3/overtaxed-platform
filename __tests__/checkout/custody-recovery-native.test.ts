/** @jest-environment node */
// Custody/recovery counterexamples (R1, R2) against the ACTUAL mounted checkout POST on the
// native disposable PostgreSQL (owned unix socket only). Same infrastructure and seams as
// session-snapshot-binding-native.test.ts, plus ONE pass-through seam: bindNeutralCheckoutSnapshot
// awaits a test latch and then delegates to the real implementation. Interleavings are forced
// with latches and pg_stat_activity/pg_locks witnesses, never with scheduling sleeps.
// App tables run as superuser on migrations through 20260915230000 (NOT app-role/RLS qualified).
import { Pool } from "pg"
import { createHash, randomBytes, randomUUID } from "node:crypto"

jest.mock("server-only", () => ({}), { virtual: true })
const mockProvider = { creates: [] as Array<{ params: any; options: any }>, fail: false, n: 0, atCall: [] as any[], probe: null as null | ((orderId: string) => Promise<any>), onCall: null as null | (() => void) }
jest.mock("stripe", () => {
  const Stripe = jest.fn().mockImplementation(() => ({
    checkout: { sessions: {
      create: async (params: any, options: any) => {
        if (mockProvider.probe) mockProvider.atCall.push(await mockProvider.probe(params.metadata.orderId))
        mockProvider.creates.push({ params, options })
        mockProvider.onCall?.()
        if (mockProvider.fail) throw new Error("provider down")
        mockProvider.n += 1
        return { id: `cs_test_custody_${mockProvider.n}_${jest.requireActual("node:crypto").randomBytes(8).toString("hex")}`, url: "https://checkout.stripe.test/x", status: "open", expires_at: Math.floor(Date.now() / 1000) + 3600 }
      },
      retrieve: async (id: string) => ({ id, status: "open", url: "https://checkout.stripe.test/x", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      expire: async (id: string) => ({ id, status: "expired" }),
    } },
    prices: { retrieve: async (id: string) => ({ id, active: true, type: "one_time", unit_amount: 6900, currency: "usd", product: "prod_t2" }) },
  }))
  return { __esModule: true, default: Stripe }
})
jest.mock("@/lib/marketing/preview-gate", () => ({ hostFromRequest: () => "www.overtaxed-il.com", isPreviewStubEnabled: () => false, marketingGateReason: () => "test", previewNoopResponseBody: () => ({}) }))
jest.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }), getClientIdentifier: () => "custody-client" }))
const PIN = "14000000000088"
jest.mock("@/lib/cook-county", () => ({
  searchPropertiesByAddress: async () => ({ success: true, data: [{ pin: "14000000000088", property_address: "1 TEST ST", property_city: "CHICAGO", township_name: "Jefferson" }] }),
  getPropertyByPIN: async () => ({ success: true, data: { pin: "14000000000088", address: "1 TEST ST", city: "CHICAGO", zipCode: "60618", township: "Jefferson" } }),
  normalizePIN: (v: string) => v.replace(/\D/g, ""),
}))
const mockDeadlines: any = { schemaVersion: 1, synthetic: true, sources: {}, townships: {} }
jest.mock("@/data/deadlines/cook-county.json", () => mockDeadlines)
jest.mock("@/lib/deadlines/commerce-deadline-authority", () => ({
  projectCommerceDeadline: async ({ township, at }: { township: unknown; at: Date }) => {
    const { evaluateOfficialDeadlineState, projectDeadline } = jest.requireActual("@/lib/deadlines/official-source-state")
    return projectDeadline(evaluateOfficialDeadlineState({ snapshot: mockDeadlines, township, stage: "assessor", evaluatedAt: at.toISOString() }), at.toISOString())
  },
}))
const mockRefetches: string[] = []
jest.mock("@/lib/fulfillment-runtime/neutral-raw-gateway", () => ({
  SHARED_COLLECTOR_PROTECTIONS: [],
  verifyAndCopyNeutralEvidence: () => null,
  readNeutralOfficialBytesRuntime: async (input: { propertyPin: string }) => { mockRefetches.push(input.propertyPin); throw new Error("COUNTY_REFETCH_FORBIDDEN") },
}))
// Pass-through seam: FIFO gates, one per bind call, awaited BEFORE the real bind runs.
const mockBindGates: Array<() => Promise<void>> = []
jest.mock("@/lib/commerce/neutral-checkout-runtime", () => {
  const actual = jest.requireActual("@/lib/commerce/neutral-checkout-runtime")
  return { ...actual, bindNeutralCheckoutSnapshot: async (...args: any[]) => { const gate = mockBindGates.shift(); if (gate) await gate(); return actual.bindNeutralCheckoutSnapshot(...args) } }
})
const mockClient: { prisma?: any } = {}
function mockNativePrisma() {
  if (!mockClient.prisma) {
    const { PrismaClient } = jest.requireActual("@prisma/client")
    const { PrismaPg } = jest.requireActual("@prisma/adapter-pg")
    const { Pool: P } = jest.requireActual("pg")
    const pool = new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user: "postgres", max: 6 })
    mockClient.prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  }
  return mockClient.prisma
}
jest.mock("@/lib/db", () => ({ get prisma() { return mockNativePrisma() } }))
jest.mock("@/lib/fulfillment-runtime/neutral-db", () => ({ neutralPrisma: () => mockNativePrisma(), disconnectNeutralPrisma: async () => {} }))

const env = process.env
const native = env.SNAPSHOT_TEST_WRITER_URL && env.SNAPSHOT_TEST_READER_URL && env.SNAPSHOT_TEST_ADMIN_URL && env.SNAPSHOT_TEST_BINDER_URL && env.CHECKOUT_NATIVE_DB ? describe : describe.skip
const SECRET = "native-checkout-transfer-secret-0123456789abcdef"
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")
const countyDay = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 864e5))
const latch = () => { let open!: () => void; const p = new Promise<void>(r => { open = r }); return { p, open } }
/** Bounded wait on a latch; a timeout is reported as a measurement, not hidden. */
const within = <T,>(p: Promise<T>, ms: number, label: string) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("BARRIER_TIMEOUT " + label)), ms))])

function armWindow() {
  const url = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"
  const source = { authority: "cook_county_assessor", sourceUrl: url, retrievedAt: new Date(Date.now() - 5000).toISOString(), sourceUpdatedAt: null, contentSha256: "e".repeat(64), httpStatus: 200, finalUrl: url, parseStatus: "ok", parserVersion: "1.0.0" }
  mockDeadlines.synthetic = false
  mockDeadlines.sources = { assessor: source, bor: source }
  mockDeadlines.townships = { jefferson: { townshipName: "Jefferson", stages: { assessor: { noticeDate: null, openDate: countyDay(-10), lastFileDate: countyDay(20) } } } }
}

function fixture(seed: string, pin = PIN) {
  const retrievedAt = new Date(Date.now() - 60_000).toISOString()
  const bytes = Buffer.from(JSON.stringify([{ pin, seed }]))
  const receipt = { datasetId: "uzyt-m557", datasetTitle: "t", url: "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json?$where=" + seed, retrievedAt, contentSha256: sha(bytes), roles: ["subject"], subjectPin: pin, taxYear: 2026 }
  const snapshot = {
    schema: "ot-acquisition-snapshot/v1", seed,
    subject: { pin, propertyClass: "203", neighborhoodCode: "77001", residentialSubtype: "one_story", buildingSqft: 1200, yearBuilt: 1950, assessedTotalCents: 3000000, address: "1 TEST ST", township: "Jefferson", city: "CHICAGO", stage: "mailed", taxYear: 2026 },
    subjectProration: { pinNumCards: 1 },
    sources: [receipt],
    dataEvidenceSha256: sha("data-" + seed),
  }
  return { snapshot: snapshot as any, pages: [{ receipt, bytes }] }
}

native("CUSTODY counterexamples on ACTUAL checkout POST (native PG, provider spy)", () => {
  const pools: Pool[] = []
  let snapshots: any, bindings: any, POST: (req: any) => Promise<Response>, transfer: any, appDb: Pool
  const prisma = () => mockNativePrisma()
  const measured: Record<string, unknown> = {}

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXTAUTH_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_native", STRIPE_PRICE_T2_DIY_PRO: "price_t2", STRIPE_PRICE_T3_DFY: "price_t3",
      OT_CHECKOUT_GATE_SECRET: "native-gate-secret-at-least-32-characters-long", OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true",
      OT_FACTUAL_DATABASE_URL: env.SNAPSHOT_TEST_WRITER_URL, OT_PAID_SNAPSHOT_READER_DATABASE_URL: env.SNAPSHOT_TEST_READER_URL,
      OT_PAID_SNAPSHOT_BINDER_DATABASE_URL: env.SNAPSHOT_TEST_BINDER_URL, OT_FACTUAL_DATABASE_SSL: "disable",
    })
    const admin = new Pool({ connectionString: env.SNAPSHOT_TEST_ADMIN_URL, max: 1 }); admin.on("error", () => {}); pools.push(admin)
    await admin.query("ALTER ROLE ot_paid_snapshot_binder LOGIN")
    // Direct superuser connection to the app DB: lock-holder "C" and pg_locks witness.
    appDb = new Pool({ host: env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(env.CHECKOUT_NATIVE_PORT), database: env.CHECKOUT_NATIVE_DB, user: "postgres", max: 3 }); appDb.on("error", () => {}); pools.push(appDb)
    const snap = await import("@/lib/evidence/server/acquisition-snapshot")
    snapshots = snap.createPostgresAcquisitionSnapshotStore({ writerUrl: env.SNAPSHOT_TEST_WRITER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    const t = await import("@/lib/commerce/snapshot-checkout-transfer")
    bindings = t.createPostgresOrderSnapshotBindingStore({ binderUrl: env.SNAPSHOT_TEST_BINDER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    transfer = t.createSnapshotTransferAuthority({ secret: SECRET })
    ;({ POST } = await import("@/app/api/checkout/session/route") as any)
  })
  afterAll(async () => {
    console.log("CUSTODY-MEASUREMENTS " + JSON.stringify(measured))
    await snapshots?.close(); await bindings?.close()
    await mockClient.prisma?.$disconnect()
    await Promise.all(pools.map(p => p.end().catch(() => {})))
  })
  beforeEach(async () => {
    // Disposable-DB hygiene only (synthetic fixtures): free the 10-slot cohort cap.
    await prisma().$executeRawUnsafe(`UPDATE "ot_neutral_report_reservation" SET "status"='ABANDONED' WHERE "status"<>'ABANDONED'`)
    armWindow(); mockProvider.creates.length = 0; mockProvider.fail = false; mockRefetches.length = 0; mockProvider.atCall.length = 0
    mockProvider.onCall = null; mockBindGates.length = 0
    mockProvider.probe = async (orderId: string) => ({ orderId, binding: await bindings.read(orderId), reservation: await reservation(orderId) })
  })

  async function persistSnapshot(f: { snapshot: any; pages: any[] }) {
    const ref = await snapshots.persist(f.snapshot, f.pages) as { id: string; sha256: string }
    return { ...ref, data: f.snapshot.dataEvidenceSha256 as string }
  }
  const cookieFor = (ref: { id: string; sha256: string }) => transfer.issueCookie({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN }).split(";")[0] as string
  const body = (checkoutKey: string, extra: Record<string, unknown> = {}) => ({ tier: "T2", email: "buyer@example.com", name: "Buyer Name", address: "1 Test St, Chicago IL 60618", propertyPin: PIN, checkoutKey, ...extra })
  const post = (b: Record<string, unknown>, cookie?: string) => POST(new Request("https://www.overtaxed-il.com/api/checkout/session", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b) }) as any)
  async function ackBody(checkoutKey: string, cookie: string) {
    const j = await (await post(body(checkoutKey), cookie)).json()
    expect(j.code).toBe("T2_ACKNOWLEDGMENT_REQUIRED")
    return body(checkoutKey, { analysisAcknowledged: true, acknowledgmentToken: j.acknowledgmentToken })
  }
  async function checkout(checkoutKey: string, cookie: string) {
    const r = await post(await ackBody(checkoutKey, cookie), cookie)
    return { status: r.status, json: await r.json() }
  }
  const order = (checkoutKey: string) => prisma().oTOrder.findUnique({ where: { checkoutKey } })
  const reservation = async (orderId: string) => (await prisma().$queryRawUnsafe(`SELECT "status"::text AS status,"data_evidence_sha256" AS data,"cohort_position" AS slot FROM "ot_neutral_report_reservation" WHERE "order_id"=$1`, orderId)) as Array<{ status: string; data: string; slot: number | null }>
  /** Capacity held by reservations whose order has no provider session (cannot be paid, still counted). */
  const sessionlessLiveCapacity = async () => Number((await appDb.query(`SELECT count(*)::int AS n FROM ot_neutral_report_reservation r JOIN ot_order o ON o.id=r.order_id WHERE r.status<>'ABANDONED' AND o."stripeSessionId" IS NULL`)).rows[0].n)
  async function witnessBlockedAbandon(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const rows = (await appDb.query(`SELECT a.pid, l.locktype, l.mode FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid AND NOT l.granted WHERE a.datname=current_database() AND a.query LIKE '%CHECKOUT_NEVER_CREATED%' AND a.query NOT LIKE '%pg_stat_activity%'`)).rows
      if (rows.length) return rows
      if (Date.now() > deadline) return null
      await new Promise(r => setImmediate(r))
    }
  }

  it("R1: delayed bind-failure abandon from request A releases capacity under request B's live provider session", async () => {
    const f = fixture("r1-" + randomBytes(6).toString("hex"))
    const ref = await persistSnapshot(f)
    // Order O: CHECKOUT_FAILED + ABANDONED reservation holding evidence E (real binder-unavailable path).
    const key = randomUUID()
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL!.replace("/postgres?", "/no_such_database?")
    let setup
    try { setup = await checkout(key, cookieFor(ref)) } finally { process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL }
    expect(setup.status).toBe(503)
    const o = await order(key)
    expect({ status: o.status, session: o.stripeSessionId, res: (await reservation(o.id)).map(r => r.status) }).toEqual({ status: "CHECKOUT_FAILED", session: null, res: ["ABANDONED"] })
    // c1's nonce is redeemed on an unrelated order X, so A's later bind on O fails TRANSFER_REPLAYED.
    const c1 = cookieFor(ref), c2 = cookieFor(ref)
    // Controller correction: a different checkoutKey with identical purchase facts
    // converges to O via contractKey; it is NOT an unrelated order. Seed only the
    // native binding journal nonce on an explicitly distinct synthetic order identity.
    const foreignOrderId = 'custody_foreign_' + randomBytes(12).toString('hex')
    const claimed = transfer.readClaim(new Request('https://www.overtaxed-il.com/api/checkout/session', { headers: { cookie: c1 } }))
    expect(claimed.status).toBe('VALID')
    expect(await bindings.bind({ orderId: foreignOrderId, claim: claimed.claim })).toEqual({ ok: true })
    expect(await bindings.read(o.id)).toBeUndefined()
    expect(c1).not.toBe(c2)
    await prisma().$executeRawUnsafe(`UPDATE "ot_neutral_report_reservation" SET "status"='ABANDONED' WHERE "order_id"<>$1 AND "status"<>'ABANDONED'`, o.id)
    mockProvider.creates.length = 0; mockProvider.atCall.length = 0
    const bodyA = await ackBody(key, c1), bodyB = await ackBody(key, c2)

    const aAtBind = latch(), aGo = latch(), bAtBind = latch(), bGo = latch(), providerCalled = latch()
    mockBindGates.push(async () => { aAtBind.open(); await aGo.p }, async () => { bAtBind.open(); await bGo.p })
    mockProvider.onCall = () => providerCalled.open()
    const lockHolder = await appDb.connect()
    let aRes: Promise<Response> | undefined, bRes: Promise<Response> | undefined
    const trace: string[] = []
    try {
      aRes = post(bodyA, c1)
      await within(aAtBind.p, 15000, "A@bind"); trace.push("A reserved (revived) and held before bind")
      const afterA = await reservation(o.id); trace.push("reservation after A reserve: " + afterA.map(r => r.status).join(","))
      bRes = post(bodyB, c2)
      await within(bAtBind.p, 15000, "B@bind"); trace.push("B reserved (joined) and held before bind")
      await lockHolder.query("BEGIN")
      await lockHolder.query(`SELECT id FROM ot_neutral_report_reservation WHERE order_id=$1 FOR NO KEY UPDATE`, [o.id]); trace.push("C holds reservation row FOR NO KEY UPDATE")
      aGo.open()
      const blocked = await witnessBlockedAbandon(5000)
      trace.push(blocked ? "A abandon blocked: " + JSON.stringify(blocked) : "A abandon NOT observed blocked within 5s")
      if (!blocked) { const ra0 = await within(aRes, 5000, "A-response"); trace.push("A response before B release: " + ra0.status + " " + JSON.stringify(await ra0.clone().json())); trace.push("reservation then: " + JSON.stringify(await reservation(o.id))) }
      bGo.open()
      await within(providerCalled.p, 15000, "B@provider"); trace.push("B reached provider")
    } finally {
      aGo.open(); bGo.open()
      console.log("CUSTODY-R1-TRACE " + JSON.stringify(trace))
      await lockHolder.query("COMMIT").catch(() => {}); lockHolder.release(); trace.push("C committed")
    }
    const [ra, rb] = await Promise.all([aRes!, bRes!])
    const shapes = [{ who: "A", status: ra.status, code: (await ra.json()).code ?? null }, { who: "B", status: rb.status, code: (await rb.json()).code ?? null }]
    const after = await order(key)
    const finalRes = await reservation(o.id)
    const r1 = { trace, shapes, providerCreates: mockProvider.creates.length, providerTimeReservation: mockProvider.atCall.map(c => c.reservation.map((r: any) => r.status)),
      finalOrder: { status: after.status, hasSession: Boolean(after.stripeSessionId) }, finalReservation: finalRes.map(r => ({ status: r.status, slot: r.slot, dataMatches: r.data === ref.data })), binding: await bindings.read(o.id) }
    measured.R1 = r1
    console.log("CUSTODY-R1 " + JSON.stringify(r1))
    // Precondition of the counterexample: exactly one provider session, created under RESERVED.
    expect(r1.providerCreates).toBe(1)
    expect(r1.providerTimeReservation).toEqual([["RESERVED"]])
    // Desired custody invariant (expected RED on baseline): a live provider session never holds released capacity.
    expect({ hasSession: r1.finalOrder.hasSession, reservation: finalRes.map(r => r.status) }).toEqual({ hasSession: true, reservation: ["RESERVED"] })
  }, 60000)

  it("R2: refused different-snapshot transfer with identical evidence revives an ABANDONED reservation and leaks capacity", async () => {
    const f1 = fixture("r2-" + randomBytes(6).toString("hex"))
    const s1 = await persistSnapshot(f1)
    // S2: different snapshot id, identical data and source digests (same receipts/pages).
    const f2 = { snapshot: { ...JSON.parse(JSON.stringify(f1.snapshot)), seed: f1.snapshot.seed + "-twin" }, pages: f1.pages }
    const s2 = await persistSnapshot(f2)
    expect(s2.id).not.toBe(s1.id); expect(s2.data).toBe(s1.data)
    const key = randomUUID()
    mockProvider.fail = true
    const first = await checkout(key, cookieFor(s1))
    mockProvider.fail = false
    expect(first.status).toBe(502)
    const o = await order(key)
    expect(await bindings.read(o.id)).toMatchObject({ snapshotId: s1.id })
    expect((await reservation(o.id)).map(r => r.status)).toEqual(["RECONCILIATION_REQUIRED"])
    // Simulated reconciliation terminal outcome "provider session never created" (admin SQL; disclosed).
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED', reconciliation_code='CHECKOUT_NEVER_CREATED', updated_at=CURRENT_TIMESTAMP WHERE order_id=$1 AND status='RECONCILIATION_REQUIRED'`, [o.id])
    const before = { reservation: await reservation(o.id), sessionlessLive: await sessionlessLiveCapacity() }
    mockProvider.creates.length = 0
    const res = await checkout(key, cookieFor(s2))
    const after = { reservation: await reservation(o.id), sessionlessLive: await sessionlessLiveCapacity(), order: await order(key) }
    const r2 = { response: { status: res.status, code: res.json.code }, before: before.reservation.map(r => ({ status: r.status, slot: r.slot })), after: after.reservation.map(r => ({ status: r.status, slot: r.slot })),
      sessionlessLiveCapacity: { before: before.sessionlessLive, after: after.sessionlessLive }, providerCreates: mockProvider.creates.length, binding: (await bindings.read(o.id))?.snapshotId === s1.id ? "S1 (unchanged)" : "CHANGED",
      order: { status: after.order.status, hasSession: Boolean(after.order.stripeSessionId) } }
    measured.R2 = r2
    console.log("CUSTODY-R2 " + JSON.stringify(r2))
    // Preconditions: refused, no provider, binding unchanged.
    expect(r2.response.status).toBe(409)
    expect(r2.providerCreates).toBe(0)
    expect(r2.binding).toBe("S1 (unchanged)")
    // Desired custody invariant (expected RED on baseline): a refused request consumes no capacity.
    expect({ reservation: r2.after.map(r => r.status), sessionlessLiveDelta: r2.sessionlessLiveCapacity.after - r2.sessionlessLiveCapacity.before }).toEqual({ reservation: ["ABANDONED"], sessionlessLiveDelta: 0 })
  }, 60000)
})
