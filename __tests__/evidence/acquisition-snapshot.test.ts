/** @jest-environment node */
// Synthetic county-shaped records only; no network. Exercises ACTUAL callers.
import {
  namedMedian,
  buildAcquisitionSnapshot,
  createInMemoryAcquisitionSnapshotStore,
  FREE_EXACT_CLASS_RULE,
  PAID_NEUTRAL_MATCH_RULE,
  ACQUISITION_SNAPSHOT_SCHEMA,
} from '@/lib/evidence/server/acquisition-snapshot'
import { loadNeutralCheckoutOfficialProperty } from '@/lib/commerce/neutral-checkout-runtime'
import { readNeutralOfficialBytesRuntime } from '@/lib/fulfillment-runtime/neutral-raw-gateway'
import { selectNonDirectionalComparables } from '@/lib/fulfillment/t2-comparables'
import { createInMemoryAnalysisStore } from '@/lib/evidence/server/analysis-store'
import { createGuardedFreeCheckRoute } from '@/lib/evidence/server/free-check-handler'
import { createCountyFactualAdapter } from '@/lib/evidence/server/county-factual-acquisition'
import { createFreeResultAccess } from '@/lib/evidence/server/free-result-access'

describe('namedMedian (explicit unit, pure, no product selection)', () => {
  const T = 'ASSESSED_TOTAL_USD_CENTS' as const
  it('odd and unsorted', () => expect(namedMedian(T, [30, 10, 20], { minimumCount: 1 })).toEqual({ unit: T, status: 'COMPUTED', value: 20, count: 3, minimumCount: 1 }))
  it('even averages the middle pair', () => expect(namedMedian(T, [40, 10, 30, 20], { minimumCount: 1 })).toMatchObject({ status: 'COMPUTED', value: 25, count: 4 }))
  it('outlier does not move median', () => expect(namedMedian(T, [10, 20, 30, 1_000_000_000], { minimumCount: 1 })).toMatchObject({ value: 25 }))
  it('zero cohort is not computable', () => expect(namedMedian(T, [], { minimumCount: 1 })).toEqual({ unit: T, status: 'NOT_COMPUTABLE', reason: 'EMPTY', count: 0, minimumCount: 1 }))
  it('one record computes when minimum is one', () => expect(namedMedian(T, [7], { minimumCount: 1 })).toMatchObject({ status: 'COMPUTED', value: 7, count: 1 }))
  it('below explicit minimum is insufficient', () => expect(namedMedian(T, [7, 9], { minimumCount: 3 })).toEqual({ unit: T, status: 'NOT_COMPUTABLE', reason: 'INSUFFICIENT', count: 2, minimumCount: 3 }))
  it('invalid inputs refuse instead of silently dropping', () => {
    expect(namedMedian(T, [1, Number.NaN], { minimumCount: 1 })).toMatchObject({ status: 'NOT_COMPUTABLE', reason: 'INVALID_INPUT' })
    expect(namedMedian(T, [1, -2], { minimumCount: 1 })).toMatchObject({ status: 'NOT_COMPUTABLE', reason: 'INVALID_INPUT' })
    expect(() => namedMedian('MARKET_VALUE' as any, [1], { minimumCount: 1 })).toThrow('UNIT_UNSUPPORTED')
  })
})

// i0 subject 203; i1,i2 in band; i3 exact class but 4000 sqft (paid excludes);
// i4 different class (both exclude). Totals/areas chosen so total-assessment and
// per-sqft medians differ, and free/paid cohorts differ.
const pins = ['14000000000000', '14000000000001', '14000000000002', '14000000000003', '14000000000004']
const cls = ['203', '203', '203', '203', '204']
const tot = [40000, 20000, 30000, 90000, 50000]
const sqft = ['1000', '1000', '1000', '4000', '1000']
let shift = 0
const calls: string[] = []
const fields: Record<string, string> = { 'pabr-t5kh': 'pin,year,class,township_code,township_name,nbhd_code', 'uzyt-m557': 'pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg', 'x54s-btds': 'pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines,tieback_key_pin,tieback_proration_rate,card_proration_rate,char_bldg_sf,char_yrblt,char_type_resd', '3723-97qp': 'pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1' }
// Mutation hooks for protection witnesses (collector-level, not snapshot-level).
let landSkew = 0, countAfter: number | null = null, epochAfter: number | null = null, countCalls = 0, metaCalls = 0
function row(id: string, pin: string): Record<string, unknown> {
  const i = pins.indexOf(pin)
  if (id === 'pabr-t5kh') return { pin, year: '2026', class: cls[i], township_code: '70', township_name: 'Lake', nbhd_code: '70120' }
  if (id === 'uzyt-m557') { const t = tot[i] + (i === 0 ? shift : 0); return { pin, year: '2026', class: cls[i], township_code: '70', nbhd: '70120', mailed_tot: String(t), mailed_land: String(10000 + (i === 2 ? landSkew : 0)), mailed_bldg: String(t - 10000) } }
  if (id === 'x54s-btds') return { pin, year: '2026', class: cls[i], township_code: '70', char_bldg_sf: sqft[i], char_yrblt: '1950', char_type_resd: '1', pin_num_cards: '1', pin_is_multiland: '0', pin_num_landlines: '1', tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: '1' }
  if (id === '3723-97qp') return { pin, year: '2026', prop_address_full: `${i + 1} SYNTHETIC ST`, prop_address_city_name: 'CHICAGO', prop_address_state: 'IL', prop_address_zipcode_1: '60601' }
  throw Error('unexpected dataset ' + id)
}
beforeEach(() => {
  shift = 0; calls.length = 0; landSkew = 0; countAfter = null; epochAfter = null; countCalls = 0; metaCalls = 0
  ;(global as any).fetch = async (url: string) => {
    const u = new URL(url), id = u.pathname.split('/').pop()!.replace('.json', ''), sel = u.searchParams.get('$select') ?? '', where = u.searchParams.get('$where') ?? ''
    calls.push(id)
    let data: unknown
    if (u.pathname.includes('/api/views/')) { metaCalls++; data = { id, provenance: 'official', rowsUpdatedAt: epochAfter !== null && metaCalls > 4 ? epochAfter : 1, viewLastModified: 1, tableId: 1, columns: fields[id].split(',').map(fieldName => ({ fieldName, dataTypeName: 'text' })) } }
    else if (sel === 'count(*) AS n') { countCalls++; data = [{ n: String(countAfter !== null && countCalls > 1 ? countAfter : pins.length) }] }
    else if (sel === 'year') data = [{ year: '2026' }]
    else {
      const single = /pin='(\d{14})'/.exec(where)
      const listed = /pin in ?\(([^)]*)\)/.exec(where)
      const chosen = single ? [single[1]] : listed ? listed[1].split(',').map(s => s.replace(/'/g, '').trim()) : pins
      const offset = Number(u.searchParams.get('$offset') ?? '0')
      data = offset > 0 ? [] : chosen.map(pin => { const r = row(id, pin); return Object.fromEntries(sel.split(',').filter(k => k in r).map(k => [k, r[k]])) })
    }
    const r = new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    Object.defineProperty(r, 'url', { value: url })
    return r
  }
})

describe('canonical acquisition snapshot through ACTUAL callers', () => {
  it('paid checkout acquisition caller persists one immutable snapshot read back by privileged reader', async () => {
    const store = createInMemoryAcquisitionSnapshotStore()
    const paid = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })
    expect(paid).not.toBeNull()
    // Existing checkout admission projection preserved exactly.
    expect(paid!.property).toMatchObject({ pin: pins[0], class: '203', mailed_tot: 40000, char_bldg_sf: 1000 })
    const ref = paid!.acquisitionSnapshot!
    expect(ref.id).toBe('acq_' + ref.sha256)
    expect(ref.dataEvidenceSha256).toBe(paid!.dataEvidenceSha256)
    const stored = await store.readPrivileged(ref.id)
    expect(stored).toBeDefined()
    const s = stored!.snapshot
    expect(s.schema).toBe(ACQUISITION_SNAPSHOT_SCHEMA)
    expect(stored!.sha256).toBe(ref.sha256)
    expect(s.subject).toMatchObject({ pin: pins[0], propertyClass: '203', assessedTotalCents: 4_000_000, buildingSqft: 1000, stage: 'mailed', taxYear: 2026 })
    // Full complete pool, one-card joins and source bytes retained.
    expect(s.pool.map(p => p.pin)).toEqual(pins)
    expect(s.pool.every(p => p.address && p.buildingSqft > 0 && Number.isSafeInteger(p.assessedTotalCents))).toBe(true)
    expect(stored!.pages.length).toBe(s.sources.length)
    expect(s.sources.map(x => x.datasetId).sort()).toEqual(expect.arrayContaining(['pabr-t5kh', 'x54s-btds', 'uzyt-m557', '3723-97qp']))
    // Separate cohorts, never merged.
    const free = s.cohorts[FREE_EXACT_CLASS_RULE], strict = s.cohorts[PAID_NEUTRAL_MATCH_RULE]
    expect(free.selected).toEqual([pins[1], pins[2], pins[3]])
    expect(free.excluded).toEqual([{ pin: pins[0], reason: 'same_parcel_as_subject' }, { pin: pins[4], reason: 'different_class' }])
    expect(strict.selected).toEqual([pins[1], pins[2]])
    expect(strict.excluded).toEqual(expect.arrayContaining([{ pin: pins[3], reason: 'building_sqft_out_of_band' }, { pin: pins[4], reason: 'different_class' }, { pin: pins[0], reason: 'same_parcel_as_subject' }]))
    // Selector parity with the existing paid selector over the same evidence.
    const raw = await readNeutralOfficialBytesRuntime({ propertyPin: pins[0] })
    if (!raw.ok) throw Error(raw.blocker)
    expect(selectNonDirectionalComparables(raw.evidence.subject, raw.evidence.candidatePool)!.accepted.map(a => a.pin)).toEqual(strict.selected)
    // Named-unit medians differ by unit and by cohort; no metric chosen.
    expect(free.metrics.ASSESSED_TOTAL_USD_CENTS).toMatchObject({ status: 'COMPUTED', value: 3_000_000 })
    expect(free.metrics.ASSESSED_USD_CENTS_PER_BUILDING_SQFT).toMatchObject({ status: 'COMPUTED', value: 2250 })
    expect(strict.metrics.ASSESSED_TOTAL_USD_CENTS).toMatchObject({ status: 'COMPUTED', value: 2_500_000 })
    expect(strict.metrics.ASSESSED_USD_CENTS_PER_BUILDING_SQFT).toMatchObject({ status: 'COMPUTED', value: 2500 })
    expect(s.subject.assessedCentsPerBuildingSqft).toBe(4000)
    // Owner decision (controller relay): median assessed $/building sqft over the
    // existing qualified comparable cohort; total assessed shown separately.
    expect(s.sharedMetric).toEqual({
      version: 'ot-shared-metric/v1',
      metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT',
      unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT',
      cohortRule: PAID_NEUTRAL_MATCH_RULE,
      stage: 'mailed',
      taxYear: 2026,
      subjectExcluded: true,
      subjectAssessedCentsPerBuildingSqft: 4000,
      subjectAssessedTotalCents: 4_000_000,
      comparableMedian: { unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'COMPUTED', value: 2500, count: 2, minimumCount: 1 },
      claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS',
      sampleAdequacy: 'NOT_QUALIFIED',
    })
    // Scan everything except the explicit negative disclaimer token itself.
    expect(JSON.stringify({ ...s, sharedMetric: { ...s.sharedMetric, claims: undefined } })).not.toMatch(/market_?value|savings/i)
    expect(Object.isFrozen(stored!.snapshot)).toBe(true)
  })

  it('historical injected collector retains legacy exact-class characterization, not shared default consumption', async () => {
    const store = createInMemoryAnalysisStore()
    const route = createGuardedFreeCheckRoute({ store, adapter: createCountyFactualAdapter((url,init)=>fetch(url,init)), access: createFreeResultAccess({ secret: 'synthetic-only-not-a-real-secret-12345' }) })
    const res = await route.POST(new Request('https://test.invalid/api/free-check', { method: 'POST', body: JSON.stringify({ pin: pins[0] }) }))
    expect(res.status).toBe(200)
    const receipt = await res.json()
    const result = store.getResult(receipt.resultId) as any
    const freePins = result.records.filter((r: any) => r.role === 'cohort').map((r: any) => r.pin.replace(/-/g, ''))
    const snaps = createInMemoryAcquisitionSnapshotStore()
    const paid = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: snaps })
    const s = (await snaps.readPrivileged(paid!.acquisitionSnapshot!.id))!.snapshot
    expect(s.cohorts[FREE_EXACT_CLASS_RULE].selected).toEqual(freePins)
    expect(s.subject.assessedTotalCents).toBe(result.finding.subjectAssessedTotalCents)
  })

  it('source drift yields a NEW snapshot; prior snapshot bytes are immutable', async () => {
    const store = createInMemoryAcquisitionSnapshotStore()
    const first = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })
    shift = 1000
    const second = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })
    expect(second!.acquisitionSnapshot!.id).not.toBe(first!.acquisitionSnapshot!.id)
    expect((await store.readPrivileged(first!.acquisitionSnapshot!.id))!.snapshot.subject.assessedTotalCents).toBe(4_000_000)
    expect((await store.readPrivileged(second!.acquisitionSnapshot!.id))!.snapshot.subject.assessedTotalCents).toBe(4_100_000)
  })

  it('fails closed when the snapshot store is unavailable instead of admitting without snapshot', async () => {
    const broken = { persist: async () => { throw Error('down') }, readPrivileged: async () => undefined }
    expect(await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: broken as any })).toBeNull()
  })

  it('shared snapshot path retains free-collector protections in the ONE gateway collector', async () => {
    const store = createInMemoryAcquisitionSnapshotStore()
    const ok = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })
    const s = (await store.readPrivileged(ok!.acquisitionSnapshot!.id))!.snapshot
    expect(s.collectorProtections).toEqual(['POOL_COUNT_BEFORE_AFTER', 'DATASET_EPOCH_BEFORE_AFTER', 'MAILED_TOTAL_EQUALS_LAND_PLUS_BUILDING'])
    expect(s.sources.some(x => x.url.includes('/api/views/'))).toBe(true)
    expect(s.sources.some(x => x.url.includes('count'))).toBe(true)
    landSkew = 1
    expect(await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })).toBeNull()
    landSkew = 0; countCalls = 0; countAfter = 6
    expect(await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })).toBeNull()
    countAfter = null; metaCalls = 0; epochAfter = 2
    expect(await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: store })).toBeNull()
    // Snapshot builder refuses evidence collected WITHOUT the protections.
    epochAfter = null
    const plain = await readNeutralOfficialBytesRuntime({ propertyPin: pins[0] })
    if (!plain.ok) throw Error(plain.blocker)
    expect(buildAcquisitionSnapshot(plain.evidence)).toBeNull()
  })

  it('builder refuses tampered evidence and non-cent values', async () => {
    const raw = await readNeutralOfficialBytesRuntime({ propertyPin: pins[0], sharedSnapshotProtections: true })
    if (!raw.ok) throw Error(raw.blocker)
    expect(buildAcquisitionSnapshot(raw.evidence)).not.toBeNull()
    expect(buildAcquisitionSnapshot({ ...raw.evidence, dataEvidenceSha256: '0'.repeat(64) })).toBeNull()
    const values = new Map(raw.evidence.assessedValues); values.set(pins[1], 200.005)
    expect(buildAcquisitionSnapshot({ ...raw.evidence, assessedValues: values })).toBeNull()
  })

  it('in-memory reader rejects unknown or malformed ids', async () => {
    const store = createInMemoryAcquisitionSnapshotStore()
    expect(await store.readPrivileged('acq_' + 'f'.repeat(64))).toBeUndefined()
    expect(await store.readPrivileged('../etc')).toBeUndefined()
  })
})

// STAGE2: the DEFAULT paid acquisition caller (no injected store) must reach the
// canonical contract through env-configured storage, and fail closed without it.
describe('DEFAULT paid checkout acquisition caller (no injected store)', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })
  it('fails closed when canonical snapshot storage config is unavailable', async () => {
    delete process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL
    expect(await loadNeutralCheckoutOfficialProperty(pins[0])).toBeNull()
  })
  it('checkout route uses the default caller (source-wired, no opt-in store/flag)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'app/api/checkout/session/route.ts'), 'utf8')
    expect(src).toMatch(/loadNeutralCheckoutOfficialProperty\(snapshot\.pin\)/)
    expect(src).not.toMatch(/snapshotStore/)
  })
  const native = process.env.SNAPSHOT_TEST_READER_URL && process.env.OT_FACTUAL_DATABASE_URL ? it : it.skip
  native('DEFAULT free POST/GET persists same canonical metric and native snapshot as DEFAULT paid acquisition', async () => {
    process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = process.env.SNAPSHOT_TEST_READER_URL
    // Freeze only Date, never PG timers: byte identity on identical fixture reads.
    const RealDate = Date
    const fixed = new RealDate('2026-10-20T18:00:00Z').getTime()
    class FixedDate extends RealDate { constructor(...args: any[]) { super(args.length ? args[0] : fixed) } static now() { return fixed } }
    global.Date = FixedDate as DateConstructor
    const { createPostgresAnalysisStore } = require('@/lib/evidence/server/postgres-analysis-store')
    const { createAcquisitionSnapshotStoreFromEnv } = require('@/lib/evidence/server/acquisition-snapshot')
    const store = createPostgresAnalysisStore()
    const route = createGuardedFreeCheckRoute({store, adapter:createCountyFactualAdapter(), access:createFreeResultAccess({secret:'synthetic-only-not-a-real-secret-12345'})})
    const reader = createAcquisitionSnapshotStoreFromEnv()
    try {
      const response = await route.POST(new Request('https://test.invalid/api/free-check',{method:'POST',body:JSON.stringify({pin:pins[0]})}))
      const receipt = await response.json()
      expect(response.status).toBe(200)
      const read = await route.GET(new Request('https://test.invalid/api/free-check?id='+receipt.resultId,{headers:{cookie:response.headers.get('set-cookie')!.split(';')[0]}}))
      const result = await read.json()
      expect(read.status).toBe(200)
      expect(result.acquisitionSnapshot).toBeDefined()
      const ref = result.acquisitionSnapshot
      const snap = await reader.readPrivileged(ref.id)
      expect(snap.sha256).toBe(ref.sha256)
      expect(ref.sharedMetric).toEqual(snap.snapshot.sharedMetric)
      expect(ref.sharedMetric.comparableMedian.value).toBe(2500)
      expect(ref.sharedMetric.sampleAdequacy).toBe('NOT_QUALIFIED')
      expect(snap.snapshot.cohorts[PAID_NEUTRAL_MATCH_RULE].selected).toEqual([pins[1],pins[2]])
      expect(calls.filter(id=>id==='x54s-btds').length).toBe(3) // metadata before/after + characteristics, no parallel acquisition
      const paid = await loadNeutralCheckoutOfficialProperty(pins[0])
      expect(paid!.acquisitionSnapshot!.id).toBe(ref.id)
      expect(paid!.acquisitionSnapshot!.sha256).toBe(ref.sha256)
      shift=1000
      const changed=await loadNeutralCheckoutOfficialProperty(pins[0])
      expect(changed!.acquisitionSnapshot!.id).not.toBe(ref.id)
      expect((await reader.readPrivileged(ref.id)).snapshot.subject.assessedTotalCents).toBe(4_000_000)
      const reread=await createPostgresAnalysisStore().getResult(receipt.resultId)
      expect(reread.acquisitionSnapshot).toEqual(ref)
    } finally {global.Date=RealDate;await reader.close()}
  })
  native('persists to native PG by default; fresh reader returns SAME paid cohort / per-sqft metric / ref hash', async () => {
    process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = process.env.SNAPSHOT_TEST_READER_URL
    const paid = await loadNeutralCheckoutOfficialProperty(pins[0])
    expect(paid).not.toBeNull()
    const ref = paid!.acquisitionSnapshot!
    expect(ref.id).toBe('acq_' + ref.sha256)
    const { createAcquisitionSnapshotStoreFromEnv } = require('@/lib/evidence/server/acquisition-snapshot')
    const fresh = createAcquisitionSnapshotStoreFromEnv()
    try {
      const stored = await fresh.readPrivileged(ref.id)
      expect(stored.sha256).toBe(ref.sha256)
      const s = stored.snapshot
      expect(s.sharedMetric).toMatchObject({ cohortRule: PAID_NEUTRAL_MATCH_RULE, subjectExcluded: true, subjectAssessedTotalCents: 4_000_000 })
      expect(s.cohorts[PAID_NEUTRAL_MATCH_RULE].selected).toEqual([pins[1], pins[2]])
      expect(JSON.stringify(s.sharedMetric)).toContain('"value":2500')
    } finally { await fresh.close() }
  })
})
