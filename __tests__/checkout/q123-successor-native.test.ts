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
const mockNeutral: { prisma?: any; ackLoss?: boolean; pool?: Pool } = {}
function mockNeutralPrisma() {
  if (!mockNeutral.prisma) {
    const { PrismaClient } = jest.requireActual("@prisma/client")
    const { PrismaPg } = jest.requireActual("@prisma/adapter-pg")
    const { Pool: P } = jest.requireActual("pg")
    const client = new PrismaClient({ adapter: new PrismaPg(mockNeutral.pool = new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user: "ot_neutral_runtime", max: 6, connectionTimeoutMillis: 5000 })) })
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
const within = async <T,>(p: Promise<T>, ms: number, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("BARRIER_TIMEOUT " + label)), ms) })]) }
  finally { clearTimeout(timer) }
}

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


  it.each(['PAID','PAID_RECOVERY_REQUIRED','REFUNDED','CANCELLED'])('Q1 all reservation enums retain capacity for %s orders; only ABANDONED releases', async orderStatus => {
    // Synthetic admin fixture transitions test accounting, not settlement authority.
    const revived=await admission('accounting-revive-'+orderStatus,true)
    expect((await revived.runtime.prepareNeutralCheckoutAdmission(revived.input,revived.claim)).ok).toBe(true)
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[revived.o.id])
    const fresh=await admission('accounting-fresh-'+orderStatus,true)
    const incumbents:any[]=[]
    for(let i=0;i<10;i++) {
      const a=await admission('accounting-'+orderStatus+'-'+i,true)
      expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
      incumbents.push(a)
    }
    const target=incumbents[9]
    await appDb.query(`UPDATE ot_order SET status=$1,"amountPaid"=69,"stripeSessionId"=$2 WHERE id=$3`,[orderStatus,'cs_test_accounting_'+randomUUID(),target.o.id])
    const liveCount=async()=>Number((await appDb.query(`SELECT count(*)::int AS n FROM ot_neutral_report_reservation WHERE status<>'ABANDONED'`)).rows[0].n)
    for(const status of ['RESERVED','STAGED','PROMOTED','RECONCILIATION_REQUIRED','QUARANTINED','COMPROMISED','SUPERSEDED']) {
      await appDb.query(`UPDATE ot_neutral_report_reservation SET status=$1::"OTNeutralReservationStatus",bundle_sha256=$3,manifest_sha256=$3,pdf_sha256=$3,csv_sha256=$3,private_references=$4::jsonb WHERE order_id=$2`,[status,target.o.id,status==='RESERVED'?null:'b'.repeat(64),status==='RESERVED'?null:JSON.stringify({syntheticAccountingFixture:true})])
      const before=await fullRow(revived.o.id),paidBefore=await fullRow(target.o.id)
      expect(await liveCount()).toBe(10)
      expect((await fresh.runtime.prepareNeutralCheckoutAdmission(fresh.input,fresh.claim)).ok).toBe(false)
      expect(await fullRow(fresh.o.id)).toEqual([])
      expect((await revived.runtime.prepareNeutralCheckoutAdmission(revived.input,revived.claim)).ok).toBe(false)
      expect(await fullRow(revived.o.id)).toEqual(before)
      expect(await fullRow(target.o.id)).toEqual(paidBefore)
    }
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[target.o.id])
    expect(await liveCount()).toBe(9)
    expect((await fresh.runtime.prepareNeutralCheckoutAdmission(fresh.input,fresh.claim)).ok).toBe(true)
    expect(await liveCount()).toBe(10)
    await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[fresh.o.id])
    expect((await revived.runtime.prepareNeutralCheckoutAdmission(revived.input,revived.claim)).ok).toBe(true)
    expect(await liveCount()).toBe(10)
    expect(mockProvider.creates).toHaveLength(0)
    measured['accounting-'+orderStatus]={nonAbandonedStatuses:7,freshAndRevivedRefused:true,abandonedReleases:true}
  },60000)

  it('Q3 actual snapshot-role pool exhaustion refuses in five seconds and recovers', async () => {
    const { inSnapshotRole, snapshotRolePool } = await import('@/lib/evidence/server/acquisition-snapshot')
    const p = snapshotRolePool(env.SNAPSHOT_TEST_BINDER_URL!, 'ot_paid_snapshot_binder', 'disable'); pools.push(p)
    const held = await Promise.all([p.connect(),p.connect(),p.connect()])
    let entered=false; const start=Date.now()
    try {
      expect(p.totalCount).toBe(3);expect(p.idleCount).toBe(0)
      await expect(inSnapshotRole(p,'ot_paid_snapshot_binder',false,async c=>{entered=true;return c.query('SELECT 1')},true)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
      const ms=Date.now()-start;expect(ms).toBeGreaterThanOrEqual(4500);expect(ms).toBeLessThan(7000);expect(entered).toBe(false)
      measured.poolExhaustion={ms,entered,total:p.totalCount,idle:p.idleCount}
    } finally { held.forEach(c=>c.release()) }
    expect((await inSnapshotRole(p,'ot_paid_snapshot_binder',false,c=>c.query('SELECT current_user AS u'),true)).rows).toEqual([{u:'ot_paid_snapshot_binder'}])
    expect(mockProvider.creates).toHaveLength(0)
  },12000)

  it('Q3 actual neutral pool/maxWait exhaustion refuses without bind or writes then recovers', async () => {
    const a=await admission('maxwait',true)
    const p=mockNeutral.pool!;const held=await Promise.all(Array.from({length:6},()=>p.connect()))
    const start=Date.now();let entered=false
    const {prepareNeutralCheckoutAdmissionOrder:prepare}=await import('@/lib/fulfillment-runtime/neutral-report-repository')
    try {
      expect(p.totalCount).toBe(6);expect(p.idleCount).toBe(0)
      const result=await prepare(a.input,async()=>{entered=true;return {ok:true}})
      const ms=Date.now()-start
      expect(result.ok).toBe(false);expect(ms).toBeGreaterThanOrEqual(4500);expect(ms).toBeLessThan(7500);expect(entered).toBe(false)
      expect(await fullRow(a.o.id)).toEqual([]);expect(await bindings.read(a.o.id)).toBeUndefined()
      measured.neutralMaxWait={ms,result,entered}
    } finally {held.forEach(c=>c.release())}
    expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
    expect(mockProvider.creates).toHaveLength(0)
  },15000)

  it.each(['fresh','joined','revived'])('Q3 %s late binder rejection after deadline is observed; exact rollback and idempotent retry', async mode => {
    const a=await admission('late-reject-'+mode),at=latch(),release=latch(),rejected=latch()
    if (mode !== 'fresh') {
      expect((await a.runtime.prepareNeutralCheckoutAdmission(a.input,a.claim)).ok).toBe(true)
      if(mode === 'revived') await appDb.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED' WHERE order_id=$1`,[a.o.id])
    }
    const before=await fullRow(a.o.id)
    const originalBinding=await bindings.read(a.o.id)
    const ack=await ackBody(a.key,a.cookie)
    mockBindGates.push(async()=>{at.open();await release.p;rejected.open();throw new Error('late binder transport failure')})
    const start=Date.now(),pending=post(ack,a.cookie)
    try {
      await within(at.p,3000,'late-reject entry')
      const response=await within(pending,9500,'deadline response before binder release')
      expect(response.status).toBe(503)
      expect(Date.now()-start).toBeLessThan(10000)
      // Wait for the actual PostgreSQL rollback, not just the HTTP result.
      const until=Date.now()+2000
      let locks:any[]=[]
      do {
        locks=(await appDb.query(`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename='ot_neutral_runtime' AND l.locktype='advisory' AND l.granted`)).rows
        if (locks.length) await new Promise(r=>setImmediate(r))
      } while(locks.length && Date.now()<until)
      expect(locks).toEqual([]);expect(await fullRow(a.o.id)).toEqual(before)
      expect(mockProvider.creates).toHaveLength(0)
      expect((await order(a.key)).status).toBe('CHECKOUT_PENDING')
    } finally {release.open()}
    await within(rejected.p,1000,'late rejection delivered')
    await new Promise(r=>setImmediate(r))
    expect(await bindings.read(a.o.id)).toEqual(originalBinding)
    expect((await checkout(a.key,a.cookie)).status).toBe(200)
    expect((await checkout(a.key,a.cookie)).status).toBe(200)
    expect(mockProvider.creates).toHaveLength(1)
  },20000)

  it('Q3 outer Prisma 15s timeout bounds actual mounted request while binder remains pending', async () => {
    const a=await admission('outer-timeout'),at=latch(),release=latch()
    const ack=await ackBody(a.key,a.cookie)
    mockBindGates.push(async()=>{at.open();await release.p})
    let settled=false;let result:any;const start=Date.now()
    const pending=post(ack,a.cookie).then(async r=>{result={status:r.status,body:await r.json()};settled=true;return result})
    await within(at.p,3000,'outer timeout binder entered')
    const lockQuery=`SELECT a.pid FROM pg_stat_activity a JOIN pg_locks l ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename='ot_neutral_runtime' AND l.locktype='advisory' AND l.granted`
    expect((await appDb.query(lockQuery)).rows).toHaveLength(1)
    let settledAtDeadline=false;let locks:any[]=[]
    try {
      await new Promise(r=>setTimeout(r,18000))
      settledAtDeadline=settled;locks=(await appDb.query(lockQuery)).rows
      expect(locks).toEqual([])
      expect(await fullRow(a.o.id)).toEqual([])
      expect((await order(a.key)).status).toBe('CHECKOUT_PENDING')
      expect(mockProvider.creates).toHaveLength(0)
      measured.outerTimeout={elapsedBeforeRelease:Date.now()-start,settledAtDeadline,locks,providerCalls:mockProvider.creates.length}
    } finally {release.open()}
    const eventual=await within(pending,5000,'request after late binder release')
    expect(eventual.status).toBe(503);expect(await fullRow(a.o.id)).toEqual([])
    // Request completion is deliberately independent of late binder completion.
    const until=Date.now()+3000
    let late=await bindings.read(a.o.id)
    while (!late && Date.now()<until) { await new Promise(r=>setImmediate(r)); late=await bindings.read(a.o.id) }
    expect(late).toMatchObject({snapshotId:a.ref.id})
    expect(mockProvider.creates).toHaveLength(0)
    expect((await order(a.key)).status).toBe('CHECKOUT_PENDING')
    expect((await checkout(a.key,a.cookie)).status).toBe(200);expect(mockProvider.creates).toHaveLength(1)
    console.log('Q3-OUTER-TIMEOUT '+JSON.stringify({...measured.outerTimeout as any,eventualStatus:eventual.status,lateBindingPreserved:true,retryProviderCalls:mockProvider.creates.length}))
    expect(settledAtDeadline).toBe(true)
  },30000)
})
