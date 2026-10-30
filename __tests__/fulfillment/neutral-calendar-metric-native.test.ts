/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Missing env is a HARD FAILURE.
// GAP-LEDGER G3 (calendar digest) + G4 (saved shared metric) on the REAL paths:
//  - Admission: REAL checkoutSnapshotFromProjection(projectDeadline(evaluateOfficialDeadlineState(...)))
//    -> REAL neutralDeadlineEvidence / neutralAdmissionSha256 (route.ts formula) ->
//    REAL loadNeutralCheckoutFromTransfer -> REAL reserveNeutralCheckoutOrder.
//  - Paid: REAL produceNeutralReport with the REAL prismaNeutralReportRepository (no TestNeutralRepository).
//  - Free: REAL createCountyFactualAdapter().acquire (screen-only brief; not a download).
// Declared synthetic seams: county + calendar transport (globalThis.fetch, in-process fixture),
// @vercel/blob (in-memory private object store), the commerce calendar snapshot store (the projection
// is computed in-test from the same captured calendar bytes), and order seeding (ot_order row inserted
// through the disposable admin role; checkout/Stripe/webhook are out of scope, G1 covers them).
import { Pool } from 'pg'
import { randomBytes } from 'node:crypto'
import { ASSESSOR_CONTEXT } from '@/lib/deadlines/assessor-calendar-context'
import { TOWNSHIPS } from '@/lib/townships'

jest.mock('server-only', () => ({}), { virtual: true })
const mockBlobs = new Map<string, Buffer>()
jest.mock('@vercel/blob', () => ({
  put: jest.fn(async (pathname: string, bytes: Buffer, options: { allowOverwrite?: boolean }) => {
    if (mockBlobs.has(pathname) && !options.allowOverwrite) throw new Error('synthetic blob exists')
    mockBlobs.set(pathname, Buffer.from(bytes)); return { pathname }
  }),
  get: jest.fn(async (pathname: string) => {
    const bytes = mockBlobs.get(pathname); if (!bytes) return null
    return { statusCode: 200, blob: { pathname }, stream: new Blob([new Uint8Array(bytes)]).stream() }
  }),
}))

// Connection construction only (same seam as g1-zero-total-authority-native S2; the URL guard in
// neutral-db-tls refuses the socket `host=` option): admission setup as postgres, paid stage as ot_neutral_runtime.
const mockNeutral = { role: 'postgres' as 'postgres' | 'ot_neutral_runtime', clients: new Map<string, any>() }
function mockNeutralPrisma() {
  let client = mockNeutral.clients.get(mockNeutral.role)
  if (!client) {
    const { PrismaClient } = jest.requireActual('@prisma/client'), { PrismaPg } = jest.requireActual('@prisma/adapter-pg'), { Pool: P } = jest.requireActual('pg')
    const pool = new P({ host: process.env.CHECKOUT_NATIVE_SOCKET_DIR, port: Number(process.env.CHECKOUT_NATIVE_PORT), database: process.env.CHECKOUT_NATIVE_DB, user: mockNeutral.role, max: 2 }); pool.on('error', () => {})
    client = new PrismaClient({ adapter: new PrismaPg(pool) }); mockNeutral.clients.set(mockNeutral.role, client)
  }
  return client
}
jest.mock('@/lib/fulfillment-runtime/neutral-db', () => ({ neutralPrisma: () => mockNeutralPrisma(), disconnectNeutralPrisma: async () => { for (const c of mockNeutral.clients.values()) await c.$disconnect(); mockNeutral.clients.clear() } }))

const env = { ...process.env }
const REQUIRED = ['SNAPSHOT_TEST_WRITER_URL', 'SNAPSHOT_TEST_READER_URL', 'SNAPSHOT_TEST_BINDER_URL', 'SNAPSHOT_TEST_ADMIN_URL', 'OT_NEUTRAL_TEST_RUNTIME_URL', 'CHECKOUT_NATIVE_DB', 'CHECKOUT_NATIVE_SOCKET_DIR', 'CHECKOUT_NATIVE_PORT']

// Subject 14000000000000 (class 203, 1000 sqft, $40,000). Paid cohort: 01,02,05 (same class/area/year);
// 03 is outside the building-area band, 04 is another class. Per-sqft cents: 2000, 3000, 9000 ->
// median 3000, average 4666.67. Subject itself (4000) must not enter the cohort.
const pins = ['14000000000000', '14000000000001', '14000000000002', '14000000000003', '14000000000004', '14000000000005']
const cls = ['203', '203', '203', '203', '204', '203']
const tot = [40000, 20000, 30000, 90000, 50000, 90000]
const SQFT0 = ['1000', '1000', '1000', '4000', '1000', '1000'], sqft = [...SQFT0]
let shift = 0, lastFileDay = '24', openDay = '01'
const countyCalls: string[] = [], calendarCalls: string[] = []
const fields: Record<string, string> = { 'pabr-t5kh': 'pin,year,class,township_code,township_name,nbhd_code', 'uzyt-m557': 'pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg', 'x54s-btds': 'pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines,tieback_key_pin,tieback_proration_rate,card_proration_rate,char_bldg_sf,char_yrblt,char_type_resd', '3723-97qp': 'pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1' }
function row(id: string, pin: string): Record<string, unknown> {
  const i = pins.indexOf(pin)
  if (id === 'pabr-t5kh') return { pin, year: '2026', class: cls[i], township_code: '70', township_name: 'Lake', nbhd_code: '70120' }
  if (id === 'uzyt-m557') { const t = tot[i] + (i === 0 ? shift : 0); return { pin, year: '2026', class: cls[i], township_code: '70', nbhd: '70120', mailed_tot: String(t), mailed_land: '10000', mailed_bldg: String(t - 10000) } }
  if (id === 'x54s-btds') return { pin, year: '2026', class: cls[i], township_code: '70', char_bldg_sf: sqft[i], char_yrblt: '1950', char_type_resd: '1', pin_num_cards: '1', pin_is_multiland: '0', pin_num_landlines: '1', tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: '1' }
  if (id === '3723-97qp') return { pin, year: '2026', prop_address_full: `${i + 1} SYNTHETIC ST`, prop_address_city_name: 'CHICAGO', prop_address_state: 'IL', prop_address_zipcode_1: '60601' }
  throw Error('unexpected dataset ' + id)
}
const field = (label: string, key: string) => { const day = key === 'last-file-date' ? lastFileDay : openDay; return `<div><span class="label-a">${label}</span><div class="field--name-field-${key}"><time datetime="2026-09-${day}T12:00:00Z">9/${day}/2026</time></div></div>` }
const card = (name: string) => `<div class="views-row"><div class="row On title"><div class="views-field-title">${name}</div><div class="open-appeal">Open For Appeals Until 9/${lastFileDay}/2026</div></div><div class="row copy">${field('Reassessment Notice Date', 'reassessment-notice-date')}${field('Last File Date', 'last-file-date')}</div></div>`
const groups = ['South &amp; West Suburban Cook County', 'North Suburbs &amp; City of Chicago']
let groupsSuffix = ''
const calendarHtml = () => `<!doctype html><html><body><main class="region-content"><h1 class="page-title">Assessment &amp; Appeal Calendar</h1>${groups.map((group, index) => `<section class="paragraph--type--township-set"><h2 class="field--name-field-title">2026 Assessment Calendar: ${group}</h2><div class="field--name-field-long-text">${ASSESSOR_CONTEXT[index]}</div><div class="field--name-field-assessment"><div class="paragraph--type--assessment-calendar-set"><div class="field--name-field-set">${TOWNSHIPS.filter(t => (t.district === 'south-west-suburbs') === (index === 0)).map(t => card(t.name === 'Lake View' ? 'Lakeview' : t.name)).join('')}</div></div></div></section>`).join('')}${groupsSuffix}</main></body></html>`
function respond(body: string, url: string, type: string) { const r = new Response(body, { status: 200, headers: { 'content-type': type } }); Object.defineProperty(r, 'url', { value: url }); return r }
async function countyFetch(url: string) {
  if (url.includes('assessment-calendar')) { calendarCalls.push(url); return respond(calendarHtml(), url, 'text/html; charset=utf-8') }
  const u = new URL(url), id = u.pathname.split('/').pop()!.replace('.json', ''), sel = u.searchParams.get('$select') ?? '', where = u.searchParams.get('$where') ?? ''
  countyCalls.push(id)
  let data: unknown
  if (u.pathname.includes('/api/views/')) data = { id, provenance: 'official', rowsUpdatedAt: 1, viewLastModified: 1, tableId: 1, columns: fields[id].split(',').map(fieldName => ({ fieldName, dataTypeName: 'text' })) }
  else if (sel === 'count(*) AS n') data = [{ n: String(pins.length) }]
  else {
    const single = /pin='(\d{14})'/.exec(where), listed = /pin in ?\(([^)]*)\)/.exec(where)
    const chosen = single ? [single[1]] : listed ? listed[1].split(',').map(s => s.replace(/'/g, '').trim()) : pins
    data = Number(u.searchParams.get('$offset') ?? '0') > 0 ? [] : chosen.map(pin => { const r = row(id, pin); return Object.fromEntries(sel.split(',').filter(k => k in r).map(k => [k, r[k]])) })
  }
  return respond(JSON.stringify(data), url, 'application/json')
}

/** Rendered PDF text: inflate every content stream and decode pdf-lib hex `Tj` strings (whitespace collapsed). */
function pdfText(pdf: Buffer): string {
  const { inflateSync } = jest.requireActual('node:zlib'), raw = pdf.toString('latin1'), out: string[] = []
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string; try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(t[1], 'hex').toString('latin1'))
  }
  return out.join(' ').replace(/\s+/g, ' ')
}

describe('G3/G4 native: calendar admission digest and saved shared metric through the REAL neutral repository', () => {
  const pools: Pool[] = []
  let admin: Pool, snapshots: any, bindings: any, priorFetch: typeof fetch
  beforeAll(async () => {
    const missing = REQUIRED.filter(k => !env[k]); if (missing.length) throw new Error('NATIVE_ENV_MISSING ' + missing.join(','))
    admin = new Pool({ connectionString: env.SNAPSHOT_TEST_ADMIN_URL!, max: 2 }); admin.on('error', () => {}); pools.push(admin)
    Object.assign(process.env, {
      OT_PAID_SNAPSHOT_BINDER_DATABASE_URL: env.SNAPSHOT_TEST_BINDER_URL, OT_PAID_SNAPSHOT_READER_DATABASE_URL: env.SNAPSHOT_TEST_READER_URL,
      OT_FACTUAL_DATABASE_URL: env.SNAPSHOT_TEST_WRITER_URL, OT_FACTUAL_DATABASE_SSL: 'disable',
      OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: 'true', OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED: 'true',
    })
    snapshots = (await import('@/lib/evidence/server/acquisition-snapshot')).createPostgresAcquisitionSnapshotStore({ writerUrl: env.SNAPSHOT_TEST_WRITER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: 'disable' })
    bindings = (await import('@/lib/commerce/snapshot-checkout-transfer')).createPostgresOrderSnapshotBindingStore({ binderUrl: env.SNAPSHOT_TEST_BINDER_URL!, readerUrl: env.SNAPSHOT_TEST_READER_URL!, ssl: 'disable' })
  })
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-15T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] })
    shift = 0; lastFileDay = '24'; openDay = '01'; sqft.splice(0, sqft.length, ...SQFT0); countyCalls.length = 0; calendarCalls.length = 0
    priorFetch = globalThis.fetch; (globalThis as any).fetch = countyFetch
  })
  afterEach(() => { (globalThis as any).fetch = priorFetch; jest.useRealTimers() })
  const created: string[] = []
  afterAll(async () => {
    // Release the pilot capacity (<10 live reservations) so the suite can be rerun on the same disposable cluster.
    await admin?.query(`UPDATE ot_neutral_report_reservation SET status='ABANDONED',updated_at=clock_timestamp() WHERE order_id = ANY($1)`, [created]).catch(() => {})
    await (await import('@/lib/fulfillment-runtime/neutral-db')).disconnectNeutralPrisma()
    process.env = env; await snapshots?.close(); await bindings?.close(); await Promise.all(pools.map(p => p.end().catch(() => {})))
  })

  /** Admission-time window snapshot, built by the real projection chain from the captured calendar. */
  async function admissionWindow() {
    const { parseInformationalAssessorHtml, ASSESSOR_PARSER_VERSION } = await import('@/lib/deadlines/assessor-calendar-parser')
    const { evaluateOfficialDeadlineState, projectDeadline } = await import('@/lib/deadlines/official-source-state')
    const { townshipKeyFromName } = await import('@/lib/deadlines/township-resolution')
    const { checkoutSnapshotFromProjection } = await import('@/lib/checkout/window-gate-token')
    const { NEUTRAL_CALENDAR_URL } = await import('@/lib/fulfillment-runtime/neutral-deadline-gateway')
    const { createHash } = await import('node:crypto')
    const html = calendarHtml(), at = new Date().toISOString()
    const snapshot: any = { schemaVersion: 1, synthetic: false, sources: { assessor: { authority: 'cook_county_assessor', sourceUrl: NEUTRAL_CALENDAR_URL, retrievedAt: at, sourceUpdatedAt: null, contentSha256: createHash('sha256').update(html).digest('hex'), httpStatus: 200, finalUrl: NEUTRAL_CALENDAR_URL, parseStatus: 'ok', parserVersion: ASSESSOR_PARSER_VERSION } }, townships: parseInformationalAssessorHtml(html, 2026) }
    const township = { inputKind: 'pin', normalizedPin: pins[0], normalizedAddress: null, townshipKey: townshipKeyFromName('Lake'), townshipName: 'Lake', resolutionSource: 'official_property_record', resolvedAt: at } as const
    const projection = projectDeadline(evaluateOfficialDeadlineState({ snapshot, township: township as any, stage: 'assessor', evaluatedAt: at }), at)
    return checkoutSnapshotFromProjection({ pin: pins[0], fallbackTownshipName: 'Lake', projection, policyVersion: 'ot-neutral-records-report/2026-09-15' })
  }

  /** Free acquisition -> bound order -> real admission reservation, exactly as checkout/session route.ts:617-620. */
  async function admittedBoundOrder(tag: string, legacyIdentity = false) {
    const runtime = await import('@/lib/commerce/neutral-checkout-runtime')
    const { NEUTRAL_REPORT_COMMERCE_POLICY } = await import('@/lib/commerce/neutral-report-policy')
    const { reserveNeutralCheckoutOrder } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    const free = await (await import('@/lib/evidence/server/county-factual-acquisition')).createCountyFactualAdapter().acquire({ pin: pins[0] })
    expect(free.ok).toBe(true)
    const ref = (free as any).acquisitionSnapshot
    const id = `ord_calmet_${tag}_${randomBytes(6).toString('hex')}`
    created.push(id)
    const claim = { snapshotId: ref.id, sha256: ref.sha256, pin: pins[0], nonce: randomBytes(16).toString('hex'), exp: Date.now() + 600_000 }
    expect(await bindings.bind({ orderId: id, claim })).toEqual({ ok: true })
    const window = await admissionWindow()
    expect(window.allowCheckout).toBe(true)
    const official = (await runtime.loadNeutralCheckoutFromTransfer(claim, { snapshotStore: snapshots }))!
    const deadline = runtime.neutralDeadlineEvidence(window)!
    expect(official && deadline).toBeTruthy()
    await admin.query(`INSERT INTO ot_order (id,tier,email,status,"updatedAt","propertyPin","checkoutAmountCents","checkoutCurrency","checkoutPriceId","checkoutProductId","eligibilitySnapshot") VALUES ($1,'T2',$2,'CHECKOUT_PENDING',now(),$3,6900,'usd','price_t2','prod_t2',$4)`, [id, `${tag}@example.invalid`, pins[0], JSON.stringify({ policyVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version })])
    // Checkout admission writes with the setup role (predecessor seam); production stage runs as ot_neutral_runtime.
    mockNeutral.role = 'postgres'
    const reserved = await reserveNeutralCheckoutOrder({ orderId: id, propertyPin: pins[0], dataEvidenceSha256: official.dataEvidenceSha256, sourceContentSha256: official.sourceContentSha256, officialRetrievedAt: official.officialRetrievedAt, officialOldestRetrievedAt: official.officialOldestRetrievedAt, deadlineEvidenceSha256: deadline.sha256, deadlineIdentitySha256: legacyIdentity ? legacyIdentitySha256(window) : deadline.identitySha256, deadlineRetrievedAt: deadline.retrievedAt, admissionSha256: runtime.neutralAdmissionSha256({ pin: pins[0], policy: 'ot-neutral-records-report/2026-09-15', data: official.dataEvidenceSha256, deadline: deadline.sha256 }) })
    expect(reserved).toEqual({ ok: true, created: true })
    mockNeutral.role = 'ot_neutral_runtime'
    return { id, free: free as any, ref, stored: (await snapshots.readPrivileged(ref.id))! }
  }
  // Pre-F3 admitted identity formula (4 fields, no openDate): reservations admitted before the change.
  function legacyIdentitySha256(w: any) { return require('node:crypto').createHash('sha256').update(JSON.stringify({ closeDate: w.closeDate, sourceUrl: w.sourceUrl, status: w.status, townshipKey: w.townshipKey })).digest('hex') }
  async function produce(id: string) {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { prismaNeutralReportRepository } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    countyCalls.length = 0; calendarCalls.length = 0
    return produceNeutralReport({ orderId: id, propertyPin: pins[0] }, { active: true, repository: prismaNeutralReportRepository })
  }
  const reservation = async (id: string) => (await admin.query(`SELECT status::text, incident_code, bundle_sha256, private_references FROM ot_neutral_report_reservation WHERE order_id=$1`, [id])).rows[0]

  it('CAL-1 unchanged calendar: bound paid order stages and promotes through the real repository; no county refetch', async () => {
    const { id, stored } = await admittedBoundOrder('same')
    const out = await produce(id)
    expect(out).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: stored.snapshot.dataEvidenceSha256 }) })
    expect(countyCalls).toEqual([])
    expect(calendarCalls).toHaveLength(1)
    const r = await reservation(id)
    expect(r.status).toBe('PROMOTED'); expect(r.incident_code).toBeNull()
    // Idempotent replay returns the same purchased analysis.
    expect(await produce(id)).toEqual(out)
  })

  it('CAL-2 changed calendar (close date moved): fails closed, purchased reservation never silently replaced, no bundle written', async () => {
    const { id } = await admittedBoundOrder('moved')
    const blobsBefore = mockBlobs.size
    lastFileDay = '25'
    expect(await produce(id)).toEqual({ ok: false, blocker: 'NEUTRAL_STAGE_CONFLICT' })
    expect(countyCalls).toEqual([])
    const r = await reservation(id)
    expect(r.status).not.toBe('PROMOTED'); expect(r.bundle_sha256).toBeNull(); expect(r.incident_code).toBe('GENERATION_EVIDENCE_CHANGED')
    expect(mockBlobs.size).toBe(blobsBefore)
    lastFileDay = '24'
    expect((await produce(id)).ok).toBe(false)
  })

  async function refusedClosed(id: string, blocker: string) {
    const blobsBefore = mockBlobs.size
    expect(await produce(id)).toEqual({ ok: false, blocker })
    expect(countyCalls).toEqual([])
    const r = await reservation(id)
    expect(r.status).not.toBe('PROMOTED'); expect(r.bundle_sha256).toBeNull(); expect(mockBlobs.size).toBe(blobsBefore)
    return r
  }

  it('CAL-3 F3 openDate-only drift (notice/open date moved, close date unchanged): fails closed', async () => {
    const { id } = await admittedBoundOrder('open')
    openDay = '02'
    const r = await refusedClosed(id, 'NEUTRAL_STAGE_CONFLICT'); expect(r.incident_code).toBe('GENERATION_EVIDENCE_CHANGED')
  })

  it('CAL-4 F3 unchanged admitted facts, later retrieval instant and new page bytes elsewhere: stages and promotes', async () => {
    const { id } = await admittedBoundOrder('later')
    jest.setSystemTime(new Date('2026-09-15T18:30:00Z'))
    groupsSuffix = '<!-- unrelated page text changed -->'
    try { expect((await produce(id)).ok).toBe(true); expect((await reservation(id)).status).toBe('PROMOTED') } finally { groupsSuffix = '' }
  })

  it('CAL-5 F3 window no longer open (status closed at generation): fails closed before staging', async () => {
    const { id } = await admittedBoundOrder('closed')
    lastFileDay = '14'
    const r = await refusedClosed(id, 'NEUTRAL_DEADLINE_UNAVAILABLE'); expect(r.status).toBe('RESERVED')
  })

  it('CAL-6 F3 legacy reservation admitted under the old 4-field identity: fails closed, never replaced (no migration)', async () => {
    const { id } = await admittedBoundOrder('legacy', true)
    const r = await refusedClosed(id, 'NEUTRAL_STAGE_CONFLICT'); expect(r.incident_code).toBe('GENERATION_EVIDENCE_CHANGED')
  })

  it('MET-3 F2 no comparable passes the paid rule: free + paid carry NOT_COMPUTABLE, paid PDF says unavailable', async () => {
    for (const i of [1, 2, 5]) sqft[i] = '4000' // valid positive area, outside the building-area band
    const { id, free, stored } = await admittedBoundOrder('nocohort')
    const m = stored.snapshot.sharedMetric
    expect(m.comparableMedian).toEqual({ unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'NOT_COMPUTABLE', reason: 'EMPTY', count: 0, minimumCount: 1 })
    expect(m.sampleAdequacy).toBe('NOT_QUALIFIED')
    expect(free.acquisitionSnapshot.sharedMetric).toEqual(m)
    const out = await produce(id); expect(out.ok).toBe(true)
    const { prismaNeutralReportRepository } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    const write = (await prismaNeutralReportRepository.readConfirmed((out as any).receipt.key))!.write
    expect(JSON.parse(write.manifestJson).sharedMetric).toEqual(m)
    const text = pdfText(write.pdf)
    expect(text).toContain('Median assessed value per building sq ft (comparable cohort, subject excluded): unavailable - no computable comparable cohort')
    expect(text).toContain('Subject assessed value per building sq ft (shown separately): $40.00')
    expect(text).toContain('Sample adequacy: NOT QUALIFIED')
    expect(text).not.toMatch(/across \d+ properties/); expect(text).not.toContain('No median, relative gap')
  })

  it('MET-4 F2 a comparable with zero building area: whole free analysis refused (conservative fail-closed), nothing persisted to bind', async () => {
    sqft[2] = '0'
    const free = await (await import('@/lib/evidence/server/county-factual-acquisition')).createCountyFactualAdapter().acquire({ pin: pins[0] })
    expect(free).toEqual({ ok: false, hold: 'ACQUISITION_REJECTED' })
  })

  it('MET-1 free brief and paid report read the SAME saved metric: median assessed/sqft, subject excluded, NOT_QUALIFIED', async () => {
    const { id, free, stored } = await admittedBoundOrder('metric')
    const m = stored.snapshot.sharedMetric
    expect(free.acquisitionSnapshot.sharedMetric).toEqual(m)
    expect(m).toMatchObject({ metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT', unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', subjectExcluded: true, sampleAdequacy: 'NOT_QUALIFIED', claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS', subjectAssessedCentsPerBuildingSqft: 4000 })
    expect(m.comparableMedian).toEqual({ unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'COMPUTED', value: 3000, count: 3, minimumCount: 1 })
    expect(stored.snapshot.cohorts['PAID_NEUTRAL_MATCH_V1'].selected).toEqual([pins[1], pins[2], pins[5]])
    const out = await produce(id); expect(out.ok).toBe(true)
    const { prismaNeutralReportRepository } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    const write = (await prismaNeutralReportRepository.readConfirmed((out as any).receipt.key))!.write
    const manifest = JSON.parse(write.manifestJson)
    expect(manifest.sharedMetric).toEqual(m)
    const text = pdfText(write.pdf)
    expect(text).toContain('MATCHING PROPERTIES')
    expect(text).toContain('Median assessed value per building sq ft (comparable cohort, subject excluded): $30.00 across 3 properties')
    expect(text).toContain('Sample adequacy: NOT QUALIFIED')
    expect(text).toContain('Subject assessed value per building sq ft (shown separately): $40.00')
    expect(text).toContain('not market value and not a savings estimate')
    expect(text).not.toContain('46.67')
    expect(text).not.toContain('No median, relative gap')
    // Local $0 private report export (synthetic county/calendar fixture + in-memory blob seam; never hosted proof).
    const dir = process.env.CALMET_EXPORT_DIR
    if (dir) {
      const fs = jest.requireActual('node:fs'), path = jest.requireActual('node:path'); fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'report.pdf'), write.pdf); fs.writeFileSync(path.join(dir, 'report.csv'), write.csv); fs.writeFileSync(path.join(dir, 'manifest.json'), write.manifestJson)
      fs.writeFileSync(path.join(dir, 'report-text.txt'), text); fs.writeFileSync(path.join(dir, 'reservation.json'), JSON.stringify({ orderId: id, receipt: (out as any).receipt, reservation: await reservation(id) }, null, 2))
    }
  })

  it('MET-2 source change after purchase: paid report keeps the saved metric; a new free check is a different analysis', async () => {
    const { id, ref, stored } = await admittedBoundOrder('drift')
    shift = 1000
    const out = await produce(id); expect(out.ok).toBe(true)
    expect(countyCalls).toEqual([])
    const { prismaNeutralReportRepository } = await import('@/lib/fulfillment-runtime/neutral-report-repository')
    const write = (await prismaNeutralReportRepository.readConfirmed((out as any).receipt.key))!.write
    expect(JSON.parse(write.manifestJson).sharedMetric).toEqual(stored.snapshot.sharedMetric)
    const fresh = await (await import('@/lib/evidence/server/county-factual-acquisition')).createCountyFactualAdapter().acquire({ pin: pins[0] })
    expect(fresh.ok).toBe(true)
    expect((fresh as any).acquisitionSnapshot.id).not.toBe(ref.id)
    expect((fresh as any).acquisitionSnapshot.sharedMetric.subjectAssessedTotalCents).toBe(4_100_000)
  })
})
