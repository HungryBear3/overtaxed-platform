/** @jest-environment node */
// H1/H2/H3 isolation (otu358 correction). TEST-ONLY, no database, no network.
// Drives the ACTUAL production reader factory `readNeutralOfficialBytesRuntime` (its own clock = Date, its own
// transport = globalThis.fetch) and the ACTUAL checkout admission factory `loadNeutralCheckoutOfficialProperty`
// (in-memory snapshot store) over the G1 native suite's synthetic county fixture (verbatim response bytes).
// Retrieval time is controlled with jest fake system time only; no gateway internals are replaced.
import { createHash } from 'node:crypto'

jest.mock('server-only', () => ({}), { virtual: true })

// ---- G1 fixture (verbatim from __tests__/checkout/g1-zero-total-authority-native.test.ts) ----
const PIN = '14000000000088'
const pins = [PIN, '14000000000089', '14000000000090', '14000000000091', '14000000000092']
const cls = ['203', '203', '203', '203', '204'], tot = [40000, 20000, 30000, 90000, 50000], sqft = ['1000', '1000', '1000', '4000', '1000']
const fields: Record<string, string> = { 'pabr-t5kh': 'pin,year,class,township_code,township_name,nbhd_code', 'uzyt-m557': 'pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg', 'x54s-btds': 'pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines,tieback_key_pin,tieback_proration_rate,card_proration_rate,char_bldg_sf,char_yrblt,char_type_resd', '3723-97qp': 'pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1' }
function row(id: string, pin: string): Record<string, unknown> {
  const i = pins.indexOf(pin)
  if (id === 'pabr-t5kh') return { pin, year: '2026', class: cls[i], township_code: '70', township_name: 'Jefferson', nbhd_code: '70120' }
  if (id === 'uzyt-m557') return { pin, year: '2026', class: cls[i], township_code: '70', nbhd: '70120', mailed_tot: String(tot[i]), mailed_land: '10000', mailed_bldg: String(tot[i] - 10000) }
  if (id === 'x54s-btds') return { pin, year: '2026', class: cls[i], township_code: '70', char_bldg_sf: sqft[i], char_yrblt: '1950', char_type_resd: '1', pin_num_cards: '1', pin_is_multiland: '0', pin_num_landlines: '1', tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: '1' }
  if (id === '3723-97qp') return { pin, year: '2026', prop_address_full: `${i + 1} SYNTHETIC ST`, prop_address_city_name: 'CHICAGO', prop_address_state: 'IL', prop_address_zipcode_1: '60601' }
  throw Error('unexpected dataset ' + id)
}
const served: Array<{ url: string; sha: string }> = []
async function syntheticCountyFetch(url: string) {
  const u = new URL(url), id = u.pathname.split('/').pop()!.replace('.json', ''), sel = u.searchParams.get('$select') ?? '', where = u.searchParams.get('$where') ?? ''
  let data: unknown
  if (u.pathname.includes('/api/views/')) data = { id, provenance: 'official', rowsUpdatedAt: 1, viewLastModified: 1, tableId: 1, columns: fields[id].split(',').map(fieldName => ({ fieldName, dataTypeName: 'text' })) }
  else if (sel === 'count(*) AS n') data = [{ n: String(pins.length) }]
  else if (sel === 'year') data = [{ year: '2026' }]
  else {
    const single = /pin='(\d{14})'/.exec(where), listed = /pin in ?\(([^)]*)\)/.exec(where)
    const chosen = single ? [single[1]] : listed ? listed[1].split(',').map(s => s.replace(/'/g, '').trim()) : pins
    data = Number(u.searchParams.get('$offset') ?? '0') > 0 ? [] : chosen.map(pin => { const r = row(id, pin); return Object.fromEntries(sel.split(',').filter(k => k in r).map(k => [k, r[k]])) })
  }
  const body = JSON.stringify(data)
  served.push({ url, sha: createHash('sha256').update(body).digest('hex') })
  const r = new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  Object.defineProperty(r, 'url', { value: url })
  return r
}
// ---- end fixture ----

/** Same formula as admission (neutral-checkout-runtime) and stage (stableSourceContentSha256). */
const sourceContent = (sources: ReadonlyArray<{ datasetId: string; url: string; contentSha256?: unknown }>) =>
  createHash('sha256').update(JSON.stringify(sources.map(s => ({ datasetId: s.datasetId, url: s.url, contentSha256: s.contentSha256 })).sort((a, b) => a.url.localeCompare(b.url)))).digest('hex')
/** County facts with every receipt/provenance field removed. */
const facts = (e: any) => JSON.stringify({ subject: e.subject, pool: e.candidatePool, values: [...e.assessedValues], addresses: [...e.addresses], proration: { ...e.subjectProration, sourceRetrievedAt: undefined, sourceContentSha256: undefined } })

const T1 = new Date('2026-09-15T15:00:00.000Z'), T2 = new Date('2026-09-15T15:01:00.000Z')
describe('H1/H2/H3: what actually moves the neutral data evidence digest (actual reader factory)', () => {
  let priorFetch: typeof fetch
  beforeEach(() => {
    jest.useFakeTimers({ now: T1, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] })
    priorFetch = globalThis.fetch; (globalThis as any).fetch = syntheticCountyFetch; served.length = 0
  })
  afterEach(() => { (globalThis as any).fetch = priorFetch; jest.useRealTimers() })
  const read = async (at: Date, strict: boolean) => {
    jest.setSystemTime(at)
    const { readNeutralOfficialBytesRuntime } = await import('@/lib/fulfillment-runtime/neutral-raw-gateway')
    const r = await readNeutralOfficialBytesRuntime({ propertyPin: PIN, ...(strict ? { sharedSnapshotProtections: true } : {}) })
    if (!r.ok) throw new Error('fixture refused ' + r.blocker)
    return r.evidence
  }

  it('H2 ISOLATED: two strict reads, identical response bytes, retrieval 60s apart -> identical URLs/bytes/source content, DIFFERENT data digest, fully attributable to receipt retrievedAt', async () => {
    const a = await read(T1, true), b = await read(T2, true)
    expect(b.sources.map(s => s.url)).toEqual(a.sources.map(s => s.url))
    expect(b.exactPages.map(p => p.bytes.toString('base64'))).toEqual(a.exactPages.map(p => p.bytes.toString('base64')))
    expect(b.sources.map(s => s.contentSha256)).toEqual(a.sources.map(s => s.contentSha256))
    expect(sourceContent(b.sources)).toBe(sourceContent(a.sources))
    expect(facts(b)).toBe(facts(a))
    expect(new Set(a.sources.map(s => s.retrievedAt))).toEqual(new Set([T1.toISOString()]))
    expect(new Set(b.sources.map(s => s.retrievedAt))).toEqual(new Set([T2.toISOString()]))
    expect(b.dataEvidenceSha256).not.toBe(a.dataEvidenceSha256)
    // Attribution through the ACTUAL digest verifier: b's pages with ONLY retrievedAt rewritten to T1 verify
    // against a's digest; unmodified b pages do not.
    const { verifyAndCopyNeutralEvidence } = await import('@/lib/fulfillment-runtime/neutral-raw-gateway')
    const retimed = b.exactPages.map(p => ({ receipt: { ...p.receipt, retrievedAt: T1.toISOString() }, bytes: p.bytes }))
    expect(verifyAndCopyNeutralEvidence({ ...b, exactPages: retimed, sources: retimed.map(p => p.receipt), dataEvidenceSha256: a.dataEvidenceSha256 } as any)).not.toBeNull()
    expect(verifyAndCopyNeutralEvidence({ ...b, dataEvidenceSha256: a.dataEvidenceSha256 } as any)).toBeNull()
    // Same through the ACTUAL admission factory: equal source content, different admitted data digest.
    const { loadNeutralCheckoutOfficialProperty } = await import('@/lib/commerce/neutral-checkout-runtime')
    const { createInMemoryAcquisitionSnapshotStore } = await import('@/lib/evidence/server/acquisition-snapshot')
    jest.setSystemTime(T1); const x = (await loadNeutralCheckoutOfficialProperty(PIN, { snapshotStore: createInMemoryAcquisitionSnapshotStore() }))!
    jest.setSystemTime(T2); const y = (await loadNeutralCheckoutOfficialProperty(PIN, { snapshotStore: createInMemoryAcquisitionSnapshotStore() }))!
    expect(y.sourceContentSha256).toBe(x.sourceContentSha256)
    expect(y.dataEvidenceSha256).not.toBe(x.dataEvidenceSha256)
    expect(y.acquisitionSnapshot!.id).not.toBe(x.acquisitionSnapshot!.id)
    console.log('H2-RECEIPT ' + JSON.stringify({ pages: a.sources.length, sourceContent: sourceContent(a.sources), dataT1: a.dataEvidenceSha256, dataT2: b.dataEvidenceSha256 }))
  })

  it('H1 ISOLATED: strict vs non-strict at the SAME instant -> different request set (labelled), different source content AND data digest', async () => {
    const s = await read(T1, true), n = await read(T1, false)
    const su = s.sources.map(x => x.url), nu = n.sources.map(x => x.url)
    const strictOnly = su.filter(u => !nu.includes(u)), nonStrictOnly = nu.filter(u => !su.includes(u))
    const label = (u: string) => u.includes('/api/views/') ? `epoch:${u.split('/').pop()}` : u.includes('count%28*%29') ? 'count' : u.includes('uzyt-m557') ? (u.includes('mailed_land') ? 'assessed+land+bldg' : 'assessed') : 'other:' + u
    const diff = { strictOnly: strictOnly.map(label), nonStrictOnly: nonStrictOnly.map(label) }
    console.log('H1-DIFF ' + JSON.stringify({ strictRequests: su.length, nonStrictRequests: nu.length, ...diff }))
    // 4 dataset epochs before + after, count before + after, and the wider assessed select.
    expect(diff.strictOnly.sort()).toEqual(['assessed+land+bldg', 'count', 'count', 'epoch:3723-97qp.json', 'epoch:3723-97qp.json', 'epoch:pabr-t5kh.json', 'epoch:pabr-t5kh.json', 'epoch:uzyt-m557.json', 'epoch:uzyt-m557.json', 'epoch:x54s-btds.json', 'epoch:x54s-btds.json'])
    expect(diff.nonStrictOnly).toEqual(['assessed'])
    expect(su.length - nu.length).toBe(10)
    // Pages common to both sequences carry identical bytes.
    for (const p of n.exactPages) { const twin = s.exactPages.find(q => q.receipt.url === p.receipt.url); if (twin) expect(twin.bytes.equals(p.bytes)).toBe(true) }
    expect(sourceContent(n.sources)).not.toBe(sourceContent(s.sources))
    expect(n.dataEvidenceSha256).not.toBe(s.dataEvidenceSha256)
    expect(s.collectorProtections).toBeDefined(); expect(n.collectorProtections).toBeUndefined()
  })

  it('H3: the G1 Z5 fixture asymmetry (admission = strict gateway evidence, producer = non-strict real gateway) encodes IDENTICAL county facts; only provenance differs', async () => {
    const admission = await read(T1, true), producer = await read(T2, false)
    expect(facts(producer)).toBe(facts(admission))
    // Exact differences, labelled: request set (H1), retrieval time (H2), and the assessed page bytes, which
    // differ only because the strict select also returns mailed_land/mailed_bldg.
    const resource = (p: any) => p.receipt.url.includes('/resource/uzyt-m557.json')
    const sa = admission.exactPages.find(resource)!, pa = producer.exactPages.find(resource)!
    const strip = (b: Buffer) => JSON.stringify(JSON.parse(b.toString()).map((r: any) => ({ ...r, mailed_land: undefined, mailed_bldg: undefined })))
    expect(sa.bytes.equals(pa.bytes)).toBe(false)
    expect(strip(sa.bytes)).toBe(strip(pa.bytes))
    expect(producer.sources.every(s => s.retrievedAt === T2.toISOString())).toBe(true)
    expect(admission.sources.every(s => s.retrievedAt === T1.toISOString())).toBe(true)
    expect(producer.dataEvidenceSha256).not.toBe(admission.dataEvidenceSha256)
  })
})
