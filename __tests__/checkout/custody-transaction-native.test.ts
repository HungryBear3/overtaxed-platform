/** @jest-environment node */
// Native acceptance derived from accepted contract. Baseline R2 retained.
// Custody/recovery counterexamples (R1, R2) against the ACTUAL mounted checkout POST on the
// native disposable PostgreSQL (owned unix socket only). Same infrastructure and seams as
// session-snapshot-binding-native.test.ts, plus ONE pass-through seam: bindNeutralCheckoutSnapshot
// awaits a test latch and then delegates to the real implementation. Interleavings are forced
// with latches and pg_stat_activity/pg_locks witnesses, never with scheduling sleeps.
// App-order fixture uses superuser; admission/attempt SQL uses actual ot_neutral_runtime.
// Binder/reader use their real non-superuser, non-BYPASSRLS roles. Fixture topology is recorded in receipts.
import { Pool, type PoolClient } from "pg"
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
const mockNeutral: { prisma?: any; ackLoss?: boolean } = {}
function mockNeutralPrisma() {
  if (!mockNeutral.prisma) {
    const { PrismaClient } = jest.requireActual("@prisma/client")
    const { PrismaPg } = jest.requireActual("@prisma/adapter-pg")
    const { Pool: P } = jest.requireActual("pg")
    const client = new PrismaClient({ adapter: new PrismaPg(new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user: "ot_neutral_runtime", max: 6, connectionTimeoutMillis: 5000 })) })
    mockNeutral.prisma = new Proxy(client, { get(target, key) {
      if (key === '$transaction') return async (...args: any[]) => {
        const result = await target.$transaction(...args)
        if (mockNeutral.ackLoss) { mockNeutral.ackLoss = false; throw new Error('synthetic commit acknowledgment loss') }
        return result
      }
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
    } })
  }
  return mockNeutral.prisma
}
jest.mock("@/lib/fulfillment-runtime/neutral-db", () => ({ neutralPrisma: () => mockNeutralPrisma(), disconnectNeutralPrisma: async () => {} }))

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
    await mockNeutral.prisma?.$disconnect()
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

  const fullRow = async (orderId: string) => (await appDb.query('SELECT * FROM ot_neutral_report_reservation WHERE order_id=$1', [orderId])).rows
  async function admission(seed: string, unique = false) {
    const f = fixture(seed + randomBytes(6).toString('hex'))
    const ref = await persistSnapshot(f), cookie = cookieFor(ref), key = randomUUID()
    const extra = unique ? { email: `fixture-${key}@example.com` } : {}
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL!.replace('/postgres?', '/no_such_database?')
    try {
      const ack = await (await post(body(key, extra), cookie)).json()
      expect(ack.code).toBe('T2_ACKNOWLEDGMENT_REQUIRED')
      expect((await post(body(key, { ...extra, analysisAcknowledged: true, acknowledgmentToken: ack.acknowledgmentToken }), cookie)).status).toBe(503)
    }
    finally { process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL }
    const o = await order(key)
    const runtime = await import('@/lib/commerce/neutral-checkout-runtime')
    const claim = transfer.readClaim(new Request('https://example.test', { headers: { cookie } })).claim
    const evidence = await runtime.loadNeutralCheckoutFromTransfer(claim)
    expect(evidence).not.toBeNull()
    const input = { orderId: o.id, propertyPin: PIN, ...evidence!, deadlineEvidenceSha256: 'd'.repeat(64), deadlineIdentitySha256: 'e'.repeat(64), deadlineRetrievedAt: new Date(Date.now()-1000).toISOString(), admissionSha256: 'a'.repeat(64) }
    return { f, ref, cookie, key, o, claim, input, runtime }
  }

  it('bounded binder role has local 2s/3s/10s limits and cancels a native statement', async () => {
    const { inSnapshotRole, snapshotRolePool } = await import('@/lib/evidence/server/acquisition-snapshot')
    const p = snapshotRolePool(env.SNAPSHOT_TEST_BINDER_URL!, 'ot_paid_snapshot_binder', 'disable'); pools.push(p)
    const read = (c:PoolClient) => c.query(`SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle`)
    const baseline=await inSnapshotRole(p,'ot_paid_snapshot_binder',false,read)
    const limited=await inSnapshotRole(p,'ot_paid_snapshot_binder',false,read,true)
    expect(limited.rows).toEqual([{lock:'2s',statement:'3s',idle:'10s'}])
    const start=Date.now()
    await expect(inSnapshotRole(p,'ot_paid_snapshot_binder',false,c=>c.query('SELECT pg_sleep(20)'),true)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
    expect(Date.now()-start).toBeLessThan(5500)
    expect((await inSnapshotRole(p,'ot_paid_snapshot_binder',false,read)).rows).toEqual(baseline.rows)
  },10000)

  it('actual neutral/binder/reader roles have no widened commerce authority', async () => {
    const rows = await mockNeutralPrisma().$queryRawUnsafe(`SELECT current_user AS u, rolsuper, rolbypassrls, has_table_privilege(current_user,'ot_order','UPDATE') AS updates FROM pg_roles WHERE rolname=current_user`)
    expect(rows).toEqual([{ u: 'ot_neutral_runtime', rolsuper: false, rolbypassrls: false, updates: false }])
    await expect(mockNeutralPrisma().$executeRawUnsafe(`UPDATE ot_order SET status='CHECKOUT_FAILED' WHERE false`)).rejects.toThrow()
    for (const [url, role] of [[env.SNAPSHOT_TEST_BINDER_URL, 'ot_paid_snapshot_binder'], [env.SNAPSHOT_TEST_READER_URL, 'ot_paid_snapshot_reader']]) {
      const p = new Pool({ connectionString: url, max: 1 }); pools.push(p)
      const q = await p.query('SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')
      expect(q.rows).toEqual([{u:role, rolsuper:false, rolbypassrls:false}])
    }
  })

  it.each(['TRANSFER_REPLAYED','ORDER_SNAPSHOT_CONFLICT','BINDING_UNAVAILABLE','THROW'])('exact rollback on %s for insert, joined and revival', async blocker => {
    const a = await admission('rollback-'+blocker)
    const { prepareNeutralCheckoutAdmissionOrder: prepare } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    const fail = async () => { if(blocker==='THROW') throw new Error('binder unavailable'); return {ok:false as const,blocker} }
    expect((await prepare(a.input,fail)).ok).toBe(false); expect(await fullRow(a.o.id)).toEqual([])
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
    const joined = await fullRow(a.o.id)
    expect((await prepare(a.input,fail)).ok).toBe(false);expect(await fullRow(a.o.id)).toEqual(joined)
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[a.o.id])
    const abandoned=await fullRow(a.o.id)
    expect((await prepare(a.input,fail)).ok).toBe(false);expect(await fullRow(a.o.id)).toEqual(abandoned)
    expect(mockProvider.creates).toHaveLength(0)
  })

  it('fresh and joined same-snapshot prepare preserve immutable binding and saved paid read', async () => {
    const a=await admission('fresh')
    expect(await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).toMatchObject({ok:true,created:true})
    const before=await fullRow(a.o.id)
    expect(await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).toMatchObject({ok:true,created:false})
    expect(await fullRow(a.o.id)).toEqual(before)
    expect((await a.runtime.readOrderBoundSnapshot(a.o.id))?.id).toBe(a.ref.id)
    expect(mockRefetches).toEqual([])
  })

  it('local committed acknowledgment loss is 503 without compensation or dispatch; same snapshot retries', async () => {
    const a=await admission('ackloss')
    mockNeutral.ackLoss=true
    const result=await checkout(a.key,a.cookie)
    expect(result.status).toBe(503);expect(mockProvider.creates).toHaveLength(0)
    expect((await order(a.key)).status).toBe('CHECKOUT_PENDING')
    expect((await fullRow(a.o.id))[0].status).toBe('RESERVED')
    expect(await bindings.read(a.o.id)).toMatchObject({snapshotId:a.ref.id})
    expect((await checkout(a.key,a.cookie)).status).toBe(200)
    expect(mockProvider.creates).toHaveLength(1)
    const attempts=await appDb.query('SELECT status::text, stripe_session_id FROM ot_neutral_checkout_attempt WHERE order_id=$1',[a.o.id])
    expect(attempts.rows).toHaveLength(1);expect(attempts.rows[0].status).toBe('SESSION_OBSERVED');expect(attempts.rows[0].stripe_session_id).toBeTruthy()
  })

  it('binder commit acknowledgment loss rolls back local reservation and preserves immutable binding', async () => {
    const a=await admission('binder-ackloss')
    const {prepareNeutralCheckoutAdmissionOrder:prepare}=await import('@/lib/fulfillment-runtime/neutral-report-repository')
    expect((await prepare(a.input,async()=>{expect(await bindings.bind({orderId:a.o.id,claim:a.claim})).toEqual({ok:true});throw new Error('lost binder acknowledgment')})).ok).toBe(false)
    expect(await fullRow(a.o.id)).toEqual([]);expect(await bindings.read(a.o.id)).toMatchObject({snapshotId:a.ref.id});expect(mockProvider.creates).toHaveLength(0)
  })

  it('late binder after server-killed local transaction cannot dispatch; S2 refuses and S1 retries', async () => {
    const a=await admission('late-bind'), at=latch(), release=latch()
    mockBindGates.push(async()=>{at.open();await release.p})
    const pending=a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)
    await within(at.p,3000,'actual exported binder seam')
    const held=await appDb.query(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename='ot_neutral_runtime' AND l.locktype='advisory' AND l.granted`)
    expect(held.rows).toHaveLength(1)
    await appDb.query('SELECT pg_terminate_backend($1)',[held.rows[0].pid])
    release.open();expect((await pending).ok).toBe(false)
    expect(await fullRow(a.o.id)).toEqual([]);expect(await bindings.read(a.o.id)).toMatchObject({snapshotId:a.ref.id})
    const s2=await persistSnapshot({snapshot:{...a.f.snapshot,seed:'different-identity'},pages:a.f.pages})
    const claim2=transfer.readClaim(new Request('https://example.test',{headers:{cookie:cookieFor(s2)}})).claim
    expect(await a.runtime.prepareNeutralCheckoutAdmission(a.input,claim2)).toMatchObject({ok:false,blocker:'ORDER_SNAPSHOT_CONFLICT'})
    expect(await fullRow(a.o.id)).toEqual([])
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
    expect(mockProvider.creates).toHaveLength(0)
  })

  it('binder lock timeout releases server admission lock; unrelated waiter resolves within bounds', async () => {
    const a=await admission('timeout-a',true),b=await admission('timeout-b',true)
    const admin=new Pool({connectionString:env.SNAPSHOT_TEST_ADMIN_URL,max:1});pools.push(admin)
    const c=await admin.connect();await c.query('BEGIN');await c.query('LOCK TABLE ot_order_snapshot_binding IN ACCESS EXCLUSIVE MODE')
    const at=latch();mockBindGates.push(async()=>{at.open()})
    const start=Date.now(), first=a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)
    await within(at.p,3000,'timeout binder seam')
    const second=b.runtime.prepareNeutralCheckoutAdmission(b.input,b.claim)
    let results
    try {results=await within(Promise.all([first,second]),9000,'server timeouts')}
    finally {await c.query('ROLLBACK');c.release()}
    expect(results.every(x=>!x.ok)).toBe(true);expect(Date.now()-start).toBeLessThan(9000)
    const held=await appDb.query(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename='ot_neutral_runtime' AND l.locktype='advisory'`)
    expect(held.rows).toEqual([]);expect(await fullRow(a.o.id)).toEqual([]);expect(await fullRow(b.o.id)).toEqual([])
    expect((await b.runtime.prepareNeutralCheckoutAdmission(b.input,b.claim)).ok).toBe(true)
    measured.timeoutMs=Date.now()-start
  },15000)

  it.each([false,true])('transferred contenders same snapshot=%s serialize at actual binder seam', async same => {
    const a=await admission('contenders',true), at=latch(),release=latch()
    const s2=await persistSnapshot({snapshot:{...a.f.snapshot,seed:'contender-other'},pages:a.f.pages})
    const other=same?a.claim:transfer.readClaim(new Request('https://example.test',{headers:{cookie:cookieFor(s2)}})).claim
    mockBindGates.push(async()=>{at.open();await release.p})
    const first=a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)
    await within(at.p,3000,'contender A actual seam')
    const second=a.runtime.prepareNeutralCheckoutAdmission(a.input,other)
    let witnessed=false
    try {
      const end=Date.now()+1500
      while(Date.now()<end) {
        witnessed=(await appDb.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND l.locktype='advisory' AND NOT l.granted`)).rows.length>0
        if(witnessed)break
        await new Promise(r=>setImmediate(r))
      }
    } finally {release.open()}
    const [x,y]=await Promise.all([first,second])
    expect(witnessed).toBe(true);expect(x.ok).toBe(true);expect(y.ok).toBe(same)
    expect(await bindings.read(a.o.id)).toMatchObject({snapshotId:a.ref.id})
    expect((await fullRow(a.o.id))[0].status).toBe('RESERVED');expect(mockRefetches).toEqual([])
  })

  it('server idle timeout terminates local transaction while binder is latched, releasing lock', async () => {
    const a=await admission('idle-a',true),b=await admission('idle-b',true),at=latch(),release=latch()
    mockBindGates.push(async()=>{at.open();await release.p})
    const start=Date.now(),pending=a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)
    await within(at.p,3000,'idle binder seam')
    let released=false
    try {
      const end=Date.now()+13000
      while(Date.now()<end) {
        released=(await appDb.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename='ot_neutral_runtime' AND l.locktype='advisory'`)).rows.length===0
        if(released)break
        await new Promise(r=>setTimeout(r,30))
      }
      expect(released).toBe(true)
      expect(Date.now()-start).toBeLessThan(14000)
      expect((await b.runtime.prepareNeutralCheckoutAdmission(b.input,b.claim)).ok).toBe(true)
    } finally {release.open()}
    expect((await pending).ok).toBe(false);expect(await fullRow(a.o.id)).toEqual([])
    expect(mockProvider.creates).toHaveLength(0);measured.idleReleaseMs=Date.now()-start
  },20000)

  it('revival revalidates order eligibility and assigns the current reviewer week', async () => {
    const a=await admission('revive-week',true)
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED',reviewer_week_start='2020-01-06' WHERE order_id=$1`,[a.o.id])
    await appDb.query(`UPDATE ot_order SET "checkoutAmountCents"=1 WHERE id=$1`,[a.o.id])
    const before=await fullRow(a.o.id)
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(false)
    expect(await fullRow(a.o.id)).toEqual(before)
    await appDb.query(`UPDATE ot_order SET "checkoutAmountCents"=6900 WHERE id=$1`,[a.o.id])
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
    const expected=(await appDb.query(`SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::date - (extract(isodow from CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago')::int-1)) AS week`)).rows[0].week
    expect((await fullRow(a.o.id))[0].reviewer_week_start).toEqual(expected)
  })

  it('cohort ten refuses fresh and revived capacity, including incident reservations', async () => {
    const abandoned=await admission('abandoned',true)
    expect((await abandoned.runtime.prepareNeutralCheckoutAdmission(abandoned.input,abandoned.claim)).ok).toBe(true)
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[abandoned.o.id])
    const before=await fullRow(abandoned.o.id)
    for(let i=0;i<10;i++) {
      const a=await admission('cap-'+i,true)
      expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
      if(i===0)await appDb.query(`UPDATE ot_neutral_report_reservation SET status='RECONCILIATION_REQUIRED' WHERE order_id=$1`,[a.o.id])
    }
    expect((await abandoned.runtime.prepareNeutralCheckoutAdmission(abandoned.input,abandoned.claim)).ok).toBe(false)
    expect(await fullRow(abandoned.o.id)).toEqual(before)
    const fresh=await admission('cap-eleven',true)
    expect((await fresh.runtime.prepareNeutralCheckoutAdmission(fresh.input,fresh.claim)).ok).toBe(false)
    expect(await fullRow(fresh.o.id)).toEqual([])
  },60000)

  it("R1 transactional successor: failed A rolls back before B binds and creates", async () => {
    const ref = await persistSnapshot(fixture("atomic-r1-" + randomBytes(6).toString("hex")))
    const key = randomUUID()
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL!.replace("/postgres?", "/no_such_database?")
    let setup
    try { setup = await checkout(key, cookieFor(ref)) } finally { process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = env.SNAPSHOT_TEST_BINDER_URL }
    expect(setup.status).toBe(503)
    const o = await order(key)
    // New contract: failed preparation did not commit capacity OR mutate order to FAILED.
    expect(o.status).toBe("CHECKOUT_PENDING")
    expect(o.stripeSessionId).toBeNull()
    expect(await reservation(o.id)).toEqual([])
    const c1=cookieFor(ref), c2=cookieFor(ref)
    const claim=transfer.readClaim(new Request("https://www.overtaxed-il.com/api/checkout/session",{headers:{cookie:c1}}))
    expect(claim.status).toBe("VALID")
    const foreignOrderId="custody_foreign_"+randomBytes(12).toString("hex")
    expect(foreignOrderId).not.toBe(o.id)
    expect(await bindings.bind({orderId:foreignOrderId,claim:claim.claim})).toEqual({ok:true})
    expect(await bindings.read(o.id)).toBeUndefined()
    const bodyA=await ackBody(key,c1),bodyB=await ackBody(key,c2)
    const atBind=latch(),release=latch()
    mockBindGates.push(async()=>{atBind.open();await release.p})
    const a=post(bodyA,c1)
    await within(atBind.p,15000,"A@bind inside local transaction")
    const b=post(bodyB,c2)
    let witnessed=false, providerBeforeRelease=-1
    try {
      const deadline=Date.now()+5000
      do {
        const result=await appDb.query(`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.datname=current_database() AND l.locktype='advisory' AND NOT l.granted AND a.query LIKE '%pg_advisory_xact_lock(684921337)%' AND a.query NOT LIKE '%pg_stat_activity%'`)
        witnessed=result.rows.length>0
        if(witnessed)break
        await new Promise(r=>setImmediate(r))
      } while(Date.now()<deadline)
      providerBeforeRelease=mockProvider.creates.length
    } finally {release.open()}
    const [ra,rb]=await Promise.all([a,b])
    expect(witnessed).toBe(true);expect(providerBeforeRelease).toBe(0)
    expect(ra.status).toBe(409);expect(rb.status).toBe(200)
    expect(mockProvider.creates).toHaveLength(1)
    expect(mockProvider.atCall.map(c=>c.reservation.map((r:any)=>r.status))).toEqual([["RESERVED"]])
    expect((await order(key)).stripeSessionId).toBeTruthy()
    expect((await reservation(o.id)).map(r=>r.status)).toEqual(["RESERVED"])
    expect(await bindings.read(o.id)).toMatchObject({snapshotId:ref.id})
    measured.R1={advisoryWaitWitness:witnessed,A:ra.status,B:rb.status,providerCalls:mockProvider.creates.length,finalReservation:await reservation(o.id)}
  },60000)

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
    const exactBefore = await fullRow(o.id)
    mockProvider.creates.length = 0
    const res = await checkout(key, cookieFor(s2))
    const after = { reservation: await reservation(o.id), sessionlessLive: await sessionlessLiveCapacity(), order: await order(key) }
    expect(await fullRow(o.id)).toEqual(exactBefore)
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
