/** @jest-environment node */
// ACTUAL app/api/checkout/session/route.ts POST against native disposable
// PostgreSQL (owned unix socket only). Skips when not configured.
//
// Real: route handler, order persistence (Prisma OTOrder), neutral reservation
// and Stripe-attempt repository SQL, transfer cookie authority, acquisition
// snapshot store, order->snapshot binding store (binder/reader roles).
//
// Seams (mocked, external or connection construction only):
//  - stripe: provider spy (no network).
//  - @/lib/cook-county: county property lookup (external).
//  - deadline JSON + commerce-deadline-authority: official calendar (external).
//  - @/lib/fulfillment-runtime/neutral-raw-gateway: county refetch spy that
//    throws, proving the transfer path never refetches.
//  - preview-gate / rate-limit: infrastructure gates.
//  - @/lib/db and @/lib/fulfillment-runtime/neutral-db: ONLY the connection.
//    Production builders force TCP/TLS and reject a unix-socket host; the owned
//    cluster listens on a socket only. Both resolve to a real PrismaClient on the
//    real PrismaPg adapter against the disposable DB as superuser (so table
//    grants/RLS for the app roles are NOT exercised here).
import { Pool } from "pg"
import { createHash, randomBytes, randomUUID } from "node:crypto"

jest.mock("server-only", () => ({}), { virtual: true })
const mockProvider = { creates: [] as Array<{ params: any; options: any }>, fail: false, n: 0, retrieveStatus: "open", atCall: [] as any[], probe: null as null | ((orderId: string) => Promise<any>) }
jest.mock("stripe", () => {
  const Stripe = jest.fn().mockImplementation(() => ({
    checkout: { sessions: {
      create: async (params: any, options: any) => {
        // Provider-time witness: durable binding + reservation as they exist AT the call.
        if (mockProvider.probe) mockProvider.atCall.push(await mockProvider.probe(params.metadata.orderId))
        mockProvider.creates.push({ params, options })
        if (mockProvider.fail) throw new Error("provider down")
        mockProvider.n += 1
        // Provider ids are globally unique; the disposable DB persists across runs.
        return { id: `cs_test_native_${mockProvider.n}_${jest.requireActual("node:crypto").randomBytes(8).toString("hex")}`, url: "https://checkout.stripe.test/x", status: "open", expires_at: Math.floor(Date.now() / 1000) + 3600 }
      },
      retrieve: async (id: string) => ({ id, status: mockProvider.retrieveStatus, url: "https://checkout.stripe.test/x", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      expire: async (id: string) => ({ id, status: "expired" }),
    } },
    prices: { retrieve: async (id: string) => ({ id, active: true, type: "one_time", unit_amount: 6900, currency: "usd", product: "prod_t2" }) },
  }))
  return { __esModule: true, default: Stripe }
})
jest.mock("@/lib/marketing/preview-gate", () => ({ hostFromRequest: () => "www.overtaxed-il.com", isPreviewStubEnabled: () => false, marketingGateReason: () => "test", previewNoopResponseBody: () => ({}) }))
jest.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }), getClientIdentifier: () => "native-client" }))
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
const mockClient: { prisma?: any } = {}
function mockNativePrisma() {
  if (!mockClient.prisma) {
    const { PrismaClient } = jest.requireActual("@prisma/client")
    const { PrismaPg } = jest.requireActual("@prisma/adapter-pg")
    const { Pool: P } = jest.requireActual("pg")
    const pool = new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user: "postgres", max: 4 })
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

native("ACTUAL checkout POST -> native order/reservation/binding (provider spy)", () => {
  const pools: Pool[] = []
  let snapshots: any, bindings: any, POST: (req: any) => Promise<Response>, transfer: any, admin: Pool
  const prisma = () => mockNativePrisma()

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXTAUTH_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_native", STRIPE_PRICE_T2_DIY_PRO: "price_t2", STRIPE_PRICE_T3_DFY: "price_t3",
      OT_CHECKOUT_GATE_SECRET: "native-gate-secret-at-least-32-characters-long", OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true",
      OT_FACTUAL_DATABASE_URL: env.SNAPSHOT_TEST_WRITER_URL, OT_PAID_SNAPSHOT_READER_DATABASE_URL: env.SNAPSHOT_TEST_READER_URL,
      OT_PAID_SNAPSHOT_BINDER_DATABASE_URL: env.SNAPSHOT_TEST_BINDER_URL, OT_FACTUAL_DATABASE_SSL: "disable",
    })
    admin = new Pool({ connectionString: env.SNAPSHOT_TEST_ADMIN_URL, max: 1 }); admin.on("error", () => {}); pools.push(admin)
    await admin.query("ALTER ROLE ot_paid_snapshot_binder LOGIN")
    const snap = await import("@/lib/evidence/server/acquisition-snapshot")
    snapshots = snap.createPostgresAcquisitionSnapshotStore({ writerUrl: env.SNAPSHOT_TEST_WRITER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    const t = await import("@/lib/commerce/snapshot-checkout-transfer")
    bindings = t.createPostgresOrderSnapshotBindingStore({ binderUrl: env.SNAPSHOT_TEST_BINDER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: "disable" })
    transfer = t.createSnapshotTransferAuthority({ secret: SECRET })
    ;({ POST } = await import("@/app/api/checkout/session/route") as any)
    // Prior runs in this disposable DB may hold reservation capacity; free it.
    await prisma().$executeRawUnsafe(`UPDATE "ot_neutral_report_reservation" SET "status"='ABANDONED' WHERE "status"<>'ABANDONED'`).catch(() => {})
  })
  afterAll(async () => {
    await snapshots?.close(); await bindings?.close()
    await mockClient.prisma?.$disconnect()
    await Promise.all(pools.map(p => p.end().catch(() => {})))
  })
  const dataBySnapshot = new Map<string, string>()
  beforeEach(async () => {
    // Disposable-DB hygiene only: free the 10-slot cohort cap consumed by earlier tests.
    await prisma().$executeRawUnsafe(`UPDATE "ot_neutral_report_reservation" SET "status"='ABANDONED' WHERE "status"<>'ABANDONED'`)
    armWindow(); mockProvider.creates.length = 0; mockProvider.fail = false; mockRefetches.length = 0
    mockProvider.retrieveStatus = "open"; mockProvider.atCall.length = 0
    mockProvider.probe = async (orderId: string) => ({ orderId, binding: await bindings.read(orderId), reservation: await reservation(orderId) })
  })
  // Global provider-time invariant for every test: a provider call only ever happens with a
  // RESERVED reservation, and a bound order's snapshot evidence equals the reservation's.
  afterEach(() => {
    for (const c of mockProvider.atCall) {
      expect(c.reservation.map((r: any) => r.status)).toEqual(["RESERVED"])
      if (c.binding) expect(c.reservation[0].data).toBe(dataBySnapshot.get(c.binding.snapshotId))
    }
  })

  async function persisted(seed: string, pin = PIN) {
    const f = fixture(seed + "-" + randomBytes(6).toString("hex"), pin)
    const ref = await snapshots.persist(f.snapshot, f.pages) as { id: string; sha256: string }
    dataBySnapshot.set(ref.id, f.snapshot.dataEvidenceSha256)
    return { ...ref, data: f.snapshot.dataEvidenceSha256 as string }
  }
  /** Simulates a legacy/no-cookie admitted order: same app-DB state, no binding row. */
  async function unbind(orderId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(orderId)) throw new Error("unexpected order id")
    await admin.query(`SET session_replication_role=replica; DELETE FROM ot_order_snapshot_binding WHERE order_id='${orderId}'; SET session_replication_role=DEFAULT`)
    expect(await bindings.read(orderId)).toBeFalsy()
  }
  const cookieFor = (ref: { id: string; sha256: string }, pin = PIN) => transfer.issueCookie({ snapshotId: ref.id, sha256: ref.sha256, pin }).split(";")[0] as string
  const body = (checkoutKey: string, email = "buyer@example.com", extra: Record<string, unknown> = {}) => ({ tier: "T2", email, name: "Buyer Name", address: "1 Test St, Chicago IL 60618", propertyPin: PIN, checkoutKey, ...extra })
  const post = (b: Record<string, unknown>, cookie?: string) => POST(new Request("https://www.overtaxed-il.com/api/checkout/session", { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b) }) as any)
  /** The T2 two-step: acknowledgment token, then the real attempt. */
  async function checkout(checkoutKey: string, cookie?: string, email = "buyer@example.com") {
    const first = await post(body(checkoutKey, email), cookie)
    const j = await first.json()
    if (first.status !== 409 || j.code !== "T2_ACKNOWLEDGMENT_REQUIRED") return { status: first.status, json: j }
    const second = await post(body(checkoutKey, email, { analysisAcknowledged: true, acknowledgmentToken: j.acknowledgmentToken }), cookie)
    return { status: second.status, json: await second.json() }
  }
  const order = (checkoutKey: string) => prisma().oTOrder.findUnique({ where: { checkoutKey } })
  const reservation = async (orderId: string) => (await prisma().$queryRawUnsafe(`SELECT "status"::text AS status,"data_evidence_sha256" AS data FROM "ot_neutral_report_reservation" WHERE "order_id"=$1`, orderId)) as Array<{ status: string; data: string }>
  const bindingRows = async (orderId: string) => (await admin.query("SELECT snapshot_id, transfer_nonce FROM ot_order_snapshot_binding WHERE order_id=$1", [orderId])).rows

  it("guest checkout with transfer capability (not account authentication): binding and matching reservation exist AT the one provider call, no county refetch", async () => {
    const ref = await persisted("happy")
    const key = randomUUID()
    const res = await checkout(key, cookieFor(ref))
    expect(res).toMatchObject({ status: 200 })
    const o = await order(key)
    expect(o).toMatchObject({ email: "buyer@example.com", status: "CHECKOUT_CREATED" })
    expect(await bindingRows(o.id)).toEqual([expect.objectContaining({ snapshot_id: ref.id })])
    expect(await bindings.read(o.id)).toEqual({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN })
    expect(await reservation(o.id)).toEqual([{ status: "RESERVED", data: ref.data }])
    expect(mockProvider.creates).toHaveLength(1)
    expect(mockProvider.atCall).toEqual([{ orderId: o.id, binding: { snapshotId: ref.id, sha256: ref.sha256, pin: PIN }, reservation: [{ status: "RESERVED", data: ref.data }] }])
    expect(mockRefetches).toEqual([])
  })

  for (const prior of ["open", "expired", "unknown"] as const) {
    it(`B1 sequential (${prior} prior session): late transfer onto an admitted unbound order is refused with no binding and no new provider call`, async () => {
      const first = await persisted("late-" + prior)
      const key = randomUUID()
      mockProvider.fail = prior === "unknown"
      const initial = await checkout(key, cookieFor(first))
      mockProvider.fail = false
      expect(initial.status).toBe(prior === "unknown" ? 502 : 200)
      const o = await order(key)
      await unbind(o.id)
      const before = (await reservation(o.id)).map(r => r.status)
      expect(before).toEqual([prior === "unknown" ? "RECONCILIATION_REQUIRED" : "RESERVED"])
      mockProvider.retrieveStatus = prior === "expired" ? "expired" : "open"
      const drift = await persisted("late-drift-" + prior)
      const late = await checkout(key, cookieFor(drift))
      expect({ status: late.status, code: late.json.code }).toEqual({ status: 409, code: "SNAPSHOT_TRANSFER_TOO_LATE" })
      expect(await bindingRows(o.id)).toEqual([])
      expect(await reservation(o.id)).toEqual([{ status: before[0], data: first.data }])
      expect(mockProvider.creates).toHaveLength(1)
      expect(mockRefetches).toEqual([])
    })
  }

  it("race: two different transferred snapshots on one new key -> at most one binding, equal to reservation evidence, at most one provider call", async () => {
    for (let i = 0; i < 4; i++) {
      mockProvider.creates.length = 0
      const a = await persisted("race-a"), b = await persisted("race-b")
      const key = randomUUID()
      const ack = await (await post(body(key), cookieFor(a))).json()
      const bd = body(key, "buyer@example.com", { analysisAcknowledged: true, acknowledgmentToken: ack.acknowledgmentToken })
      const results = await Promise.all([post(bd, cookieFor(a)), post(bd, cookieFor(b))])
      const shapes = await Promise.all(results.map(async r => ({ status: r.status, code: (await r.json()).code ?? null })))
      expect(mockProvider.creates.length).toBeLessThanOrEqual(1)
      for (const s of shapes.filter(s => s.status !== 200)) expect([{ status: 409, code: "SNAPSHOT_TRANSFER_TOO_LATE" }, { status: 409, code: "SNAPSHOT_TRANSFER_REJECTED" }, { status: 409, code: "CHECKOUT_ALREADY_STARTED" }]).toContainEqual(s)
      const o = await order(key)
      if (!o) { expect(mockProvider.creates).toHaveLength(0); continue }
      const bound = await bindings.read(o.id), live = (await reservation(o.id)).filter(r => r.status !== "ABANDONED")
      if (bound) expect(live).toEqual([expect.objectContaining({ data: dataBySnapshot.get(bound.snapshotId) })])
      if (mockProvider.creates.length === 1) expect(bound).not.toBeNull()
    }
  })

  it("foreign buyer replaying the same transfer cookie on another order is refused with zero provider calls; first binding untouched", async () => {
    const ref = await persisted("foreign")
    const cookie = cookieFor(ref)
    const ownerKey = randomUUID()
    expect((await checkout(ownerKey, cookie)).status).toBe(200)
    const ownerId = (await order(ownerKey)).id
    mockProvider.creates.length = 0
    const foreignKey = randomUUID()
    const foreign = await checkout(foreignKey, cookie, "someone-else@example.com")
    expect(foreign).toMatchObject({ status: 409, json: { code: "SNAPSHOT_TRANSFER_REJECTED" } })
    expect(mockProvider.creates).toHaveLength(0)
    const fo = await order(foreignKey)
    if (fo) { expect(await bindingRows(fo.id)).toEqual([]); expect(fo.stripeSessionId).toBeNull(); expect((await reservation(fo.id)).filter(r => r.status !== "ABANDONED")).toEqual([]) }
    expect(await bindings.read(ownerId)).toEqual({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN })
  })

  it("foreign checkoutKey reuse by a different email never reaches binding or provider", async () => {
    const ref = await persisted("keyreuse")
    const key = randomUUID()
    expect((await checkout(key, cookieFor(ref))).status).toBe(200)
    mockProvider.creates.length = 0
    const other = await persisted("keyreuse-other")
    const res = await checkout(key, cookieFor(other), "intruder@example.com")
    // Deliberate refusal, not a mislabeled provider error.
    expect({ status: res.status, code: res.json.code }).toEqual({ status: 409, code: "CHECKOUT_KEY_CONFLICT" })
    expect(mockProvider.creates).toHaveLength(0)
    expect(await bindings.read((await order(key)).id)).toMatchObject({ snapshotId: ref.id })
  })

  it("forged, expired, and wrong-PIN transfers are refused before any order or provider effect", async () => {
    const ref = await persisted("forged")
    const good = cookieFor(ref)
    const forged = good.slice(0, -2) + (good.endsWith("A") ? "BB" : "AA")
    const t = await import("@/lib/commerce/snapshot-checkout-transfer")
    const expired = t.createSnapshotTransferAuthority({ secret: SECRET, now: () => Date.now() - 3600_000 }).issueCookie({ snapshotId: ref.id, sha256: ref.sha256, pin: PIN })!.split(";")[0]
    const otherPin = await persisted("wrongpin", "14000000000099")
    const wrongPin = cookieFor(otherPin, "14000000000099")
    for (const cookie of [forged, expired, wrongPin]) {
      const key = randomUUID()
      const res = await checkout(key, cookie)
      expect(res).toMatchObject({ status: 409, json: { code: "SNAPSHOT_TRANSFER_REJECTED" } })
      expect(await order(key)).toBeNull()
    }
    expect(mockProvider.creates).toHaveLength(0)
  })

  it("stale (>24h) transferred snapshot is refused with zero provider calls", async () => {
    const f = fixture("stale-" + randomBytes(6).toString("hex"))
    const old = new Date(Date.now() - 25 * 3600_000).toISOString()
    f.snapshot.sources[0].retrievedAt = old; f.pages[0].receipt.retrievedAt = old
    const ref = await snapshots.persist(f.snapshot, f.pages)
    const res = await checkout(randomUUID(), cookieFor(ref))
    expect(res).toMatchObject({ status: 409, json: { code: "SNAPSHOT_TRANSFER_REJECTED" } })
    expect(mockProvider.creates).toHaveLength(0)
  })

  it("concurrent duplicate submissions with the same cookie and key: one binding, one reservation, one provider idempotency key", async () => {
    const ref = await persisted("concurrent")
    const key = randomUUID(), cookie = cookieFor(ref)
    const ack = await (await post(body(key), cookie)).json()
    const b = body(key, "buyer@example.com", { analysisAcknowledged: true, acknowledgmentToken: ack.acknowledgmentToken })
    const results = await Promise.all([post(b, cookie), post(b, cookie), post(b, cookie)])
    const statuses = results.map(r => r.status)
    // Money-safety invariant: exactly one provider call. A racing loser (including the
    // order-create P2002 loser) gets a deliberate 409, never 502 CHECKOUT_PROVIDER_ERROR.
    expect(mockProvider.creates).toHaveLength(1)
    expect(statuses).toContain(200)
    for (const r of results.filter(r => r.status !== 200)) expect({ status: r.status, code: (await r.json()).code }).toEqual({ status: 409, code: "CHECKOUT_ALREADY_STARTED" })
    const o = await order(key)
    expect(await bindingRows(o.id)).toHaveLength(1)
    expect(await reservation(o.id)).toHaveLength(1)
    const keys = new Set(mockProvider.creates.map(c => c.options?.idempotencyKey))
    expect(keys.size).toBe(1)
    // Replay after success returns the same session; never a second binding.
    const replay = await post(b, cookie)
    expect(replay.status).toBe(200)
    expect(mockProvider.creates).toHaveLength(1)
    expect(await bindingRows(o.id)).toHaveLength(1)
  })

  it("binding write failure => 503, zero provider calls, no reservation; retry after recovery binds and proceeds", async () => {
    const ref = await persisted("bindfail")
    const key = randomUUID(), cookie = cookieFor(ref)
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL!.replace("/postgres?", "/no_such_database?")
    let res
    try { res = await checkout(key, cookie) } finally { process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL }
    expect(res).toMatchObject({ status: 503, json: { code: "SNAPSHOT_BINDING_UNAVAILABLE" } })
    expect(mockProvider.creates).toHaveLength(0)
    const o = await order(key)
    expect(o.stripeSessionId).toBeNull()
    expect(await bindingRows(o.id)).toEqual([])
    expect((await reservation(o.id)).filter(r => r.status !== "ABANDONED")).toEqual([])
    const retry = await checkout(key, cookie)
    expect(retry.status).toBe(200)
    expect(await bindings.read(o.id)).toMatchObject({ snapshotId: ref.id })
    expect(mockProvider.creates).toHaveLength(1)
  })

  it("reservation write failure => 503, zero provider calls, reservation rolled back; retry with same snapshot recovers; different snapshot is never swapped in", async () => {
    const ref = await persisted("resfail")
    const key = randomUUID(), cookie = cookieFor(ref)
    await prisma().$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ot_test_reject_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_RESERVATION_WRITE_FAILED'; END $$`)
    await prisma().$executeRawUnsafe(`CREATE TRIGGER ot_test_reject_reservation BEFORE INSERT OR UPDATE ON "ot_neutral_report_reservation" FOR EACH ROW EXECUTE FUNCTION ot_test_reject_reservation()`)
    let res
    try { res = await checkout(key, cookie) } finally { await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ot_test_reject_reservation ON "ot_neutral_report_reservation"`) }
    expect(res).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    expect(mockProvider.creates).toHaveLength(0)
    const o = await order(key)
    expect(o).toMatchObject({ stripeSessionId: null, status: "CHECKOUT_PENDING" })
    expect((await reservation(o.id)).filter(r => r.status !== "ABANDONED")).toEqual([])
    // Reservation precedes binding: nothing was admitted, so no binding was written either.
    expect(await bindings.read(o.id)).toBeFalsy()
    expect(await bindingRows(o.id)).toEqual([])

    // Same snapshot (fresh nonce) recovers.
    const retry = await checkout(key, cookieFor(ref))
    expect(retry.status).toBe(200)
    expect(mockProvider.creates).toHaveLength(1)
    expect(await bindings.read(o.id)).toMatchObject({ snapshotId: ref.id })
    expect(await reservation(o.id)).toEqual([{ status: "RESERVED", data: ref.data }])

    // Once admitted, a different snapshot is refused: no evidence swap, no provider call.
    const swap = await persisted("resfail-swap")
    const swapped = await checkout(key, cookieFor(swap))
    expect({ status: swapped.status, code: swapped.json.code }).toEqual({ status: 409, code: "SNAPSHOT_TRANSFER_TOO_LATE" })
    // Dropping the cookie must not fall back to a live refetch.
    const noCookie = await checkout(key)
    expect(noCookie).toMatchObject({ status: 409, json: { code: "SNAPSHOT_TRANSFER_REQUIRED" } })
    expect(mockRefetches).toEqual([])
    expect(mockProvider.creates).toHaveLength(1)
    expect(await bindingRows(o.id)).toEqual([expect.objectContaining({ snapshot_id: ref.id })])
    expect(await reservation(o.id)).toEqual([{ status: "RESERVED", data: ref.data }])
  })

  it("provider failure => 502, binding unchanged and no orphan session; retries are refused 503 (held for reconciliation, recovery NOT exercised) without swap", async () => {
    const ref = await persisted("provfail")
    const key = randomUUID(), cookie = cookieFor(ref)
    mockProvider.fail = true
    const res = await checkout(key, cookie)
    mockProvider.fail = false
    expect(res.status).toBe(502)
    expect(mockProvider.creates).toHaveLength(1)
    const o = await order(key)
    expect(o.stripeSessionId).toBeNull()
    expect(await bindingRows(o.id)).toHaveLength(1)
    const failedState = { status: o.status, reservation: (await reservation(o.id)).map(r => r.status) }
    const retry = await checkout(key, cookieFor(ref))
    const after = await order(key)
    // Unknown provider outcome: held for reconciliation, never a blind second session.
    expect({ failedState, retry: { status: retry.status, code: retry.json.code }, creates: mockProvider.creates.length }).toEqual({
      failedState: { status: "CHECKOUT_FAILED", reservation: ["RECONCILIATION_REQUIRED"] },
      retry: { status: 503, code: "NEUTRAL_RESERVATION_UNAVAILABLE" },
      creates: 1,
    })
    // The refused retry must not have abandoned the held reservation (which would open a double charge).
    expect((await reservation(o.id)).map(r => r.status)).toEqual(["RECONCILIATION_REQUIRED"])
    const again = await checkout(key, cookieFor(ref))
    expect(again).toMatchObject({ status: 503, json: { code: "NEUTRAL_RESERVATION_UNAVAILABLE" } })
    expect(mockProvider.creates).toHaveLength(1)
    expect(after.stripeSessionId).toBeNull()
    expect(await bindings.read(o.id)).toMatchObject({ snapshotId: ref.id })
    expect(await bindingRows(o.id)).toHaveLength(1)
    expect(mockRefetches).toEqual([])
  })
})
