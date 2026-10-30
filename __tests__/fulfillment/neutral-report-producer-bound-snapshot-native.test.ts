/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Skips when not configured.
// ACTUAL paid producer (produceNeutralReport) reads the order's bound acquisition
// snapshot through the default env-configured binding/snapshot stores and
// re-parses the stored exact pages; no county refetch for bound orders.
// Mocked: county/calendar transport (globalThis.fetch) and report repository only.
import { Pool } from 'pg'
import { randomBytes } from 'node:crypto'
import { ASSESSOR_CONTEXT } from '@/lib/deadlines/assessor-calendar-context'
import { TOWNSHIPS } from '@/lib/townships'
import { installNeutralTestRuntime, TestNeutralRepository } from '@/test-support/neutral-report-runtime'

jest.mock('server-only', () => ({}), { virtual: true })

const writerUrl = process.env.SNAPSHOT_TEST_WRITER_URL, readerUrl = process.env.SNAPSHOT_TEST_READER_URL, adminUrl = process.env.SNAPSHOT_TEST_ADMIN_URL, binderUrl = process.env.SNAPSHOT_TEST_BINDER_URL
const native = writerUrl && readerUrl && adminUrl && binderUrl ? describe : describe.skip

const pins = ['14000000000000', '14000000000001', '14000000000002', '14000000000003', '14000000000004']
const cls = ['203', '203', '203', '203', '204']
const tot = [40000, 20000, 30000, 90000, 50000]
const sqft = ['1000', '1000', '1000', '4000', '1000']
let shift = 0
const countyCalls: string[] = []
const fields: Record<string, string> = { 'pabr-t5kh': 'pin,year,class,township_code,township_name,nbhd_code', 'uzyt-m557': 'pin,year,class,township_code,nbhd,mailed_tot,mailed_land,mailed_bldg', 'x54s-btds': 'pin,year,class,township_code,pin_num_cards,pin_is_multiland,pin_num_landlines,tieback_key_pin,tieback_proration_rate,card_proration_rate,char_bldg_sf,char_yrblt,char_type_resd', '3723-97qp': 'pin,year,prop_address_full,prop_address_city_name,prop_address_state,prop_address_zipcode_1' }
function row(id: string, pin: string): Record<string, unknown> {
  const i = pins.indexOf(pin)
  if (id === 'pabr-t5kh') return { pin, year: '2026', class: cls[i], township_code: '70', township_name: 'Lake', nbhd_code: '70120' }
  if (id === 'uzyt-m557') { const t = tot[i] + (i === 0 ? shift : 0); return { pin, year: '2026', class: cls[i], township_code: '70', nbhd: '70120', mailed_tot: String(t), mailed_land: '10000', mailed_bldg: String(t - 10000) } }
  if (id === 'x54s-btds') return { pin, year: '2026', class: cls[i], township_code: '70', char_bldg_sf: sqft[i], char_yrblt: '1950', char_type_resd: '1', pin_num_cards: '1', pin_is_multiland: '0', pin_num_landlines: '1', tieback_key_pin: null, tieback_proration_rate: null, card_proration_rate: '1' }
  if (id === '3723-97qp') return { pin, year: '2026', prop_address_full: `${i + 1} SYNTHETIC ST`, prop_address_city_name: 'CHICAGO', prop_address_state: 'IL', prop_address_zipcode_1: '60601' }
  throw Error('unexpected dataset ' + id)
}
const field = (label: string, key: string) => `<div><span class="label-a">${label}</span><div class="field--name-field-${key}"><time datetime="2026-09-${key === 'last-file-date' ? '24' : '01'}T12:00:00Z">9/${key === 'last-file-date' ? '24' : '01'}/2026</time></div></div>`
const card = (name: string) => `<div class="views-row"><div class="row On title"><div class="views-field-title">${name}</div><div class="open-appeal">Open For Appeals Until 9/24/2026</div></div><div class="row copy">${field('Reassessment Notice Date', 'reassessment-notice-date')}${field('Last File Date', 'last-file-date')}</div></div>`
const groups = ['South &amp; West Suburban Cook County', 'North Suburbs &amp; City of Chicago']
const calendarHtml = () => `<!doctype html><html><body><main class="region-content"><h1 class="page-title">Assessment &amp; Appeal Calendar</h1>${groups.map((group, index) => `<section class="paragraph--type--township-set"><h2 class="field--name-field-title">2026 Assessment Calendar: ${group}</h2><div class="field--name-field-long-text">${ASSESSOR_CONTEXT[index]}</div><div class="field--name-field-assessment"><div class="paragraph--type--assessment-calendar-set"><div class="field--name-field-set">${TOWNSHIPS.filter(t => (t.district === 'south-west-suburbs') === (index === 0)).map(t => card(t.name === 'Lake View' ? 'Lakeview' : t.name)).join('')}</div></div></div></section>`).join('')}</main></body></html>`
function respond(body: string, url: string, type: string) { const r = new Response(body, { status: 200, headers: { 'content-type': type } }); Object.defineProperty(r, 'url', { value: url }); return r }
async function countyFetch(url: string) {
  if (url.includes('assessment-calendar')) return respond(calendarHtml(), url, 'text/html; charset=utf-8')
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
const nonce = () => randomBytes(16).toString('hex')
const orderId = (tag: string) => `ord_bound_${tag}_${randomBytes(6).toString('hex')}`

native('paid producer consumes the order-bound acquisition snapshot (native PostgreSQL)', () => {
  const pools: Pool[] = []
  let snapshots: any, bindings: any, uninstall: () => void, repo: TestNeutralRepository, priorFetch: typeof fetch
  const env = { ...process.env }
  beforeAll(async () => {
    const admin = new Pool({ connectionString: adminUrl!, max: 1 }); admin.on('error', () => {}); pools.push(admin)
    await admin.query('ALTER ROLE ot_paid_snapshot_binder LOGIN')
    // Default production stores (no injection into the producer): env-configured roles.
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = binderUrl; process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = readerUrl
    process.env.OT_FACTUAL_DATABASE_URL = writerUrl; process.env.OT_FACTUAL_DATABASE_SSL = 'disable'
    snapshots = (await import('@/lib/evidence/server/acquisition-snapshot')).createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' })
    bindings = (await import('@/lib/commerce/snapshot-checkout-transfer')).createPostgresOrderSnapshotBindingStore({ binderUrl: binderUrl!, readerUrl: readerUrl!, ssl: 'disable' })
  })
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-15T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] })
    shift = 0; countyCalls.length = 0
    priorFetch = globalThis.fetch; (globalThis as any).fetch = countyFetch
    repo = new TestNeutralRepository(); uninstall = installNeutralTestRuntime(repo)
  })
  afterEach(() => { uninstall(); (globalThis as any).fetch = priorFetch; jest.useRealTimers() })
  afterAll(async () => { process.env = env; await snapshots?.close(); await bindings?.close(); await Promise.all(pools.map(p => p.end().catch(() => {}))) })

  async function boundOrder(tag: string) {
    const { loadNeutralCheckoutOfficialProperty } = await import('@/lib/commerce/neutral-checkout-runtime')
    const admitted = await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: snapshots })
    const ref = admitted!.acquisitionSnapshot!
    const id = orderId(tag)
    expect(await bindings.bind({ orderId: id, claim: { snapshotId: ref.id, sha256: ref.sha256, pin: pins[0], nonce: nonce(), exp: Date.now() + 600_000 } })).toEqual({ ok: true })
    return { id, ref, stored: (await snapshots.readPrivileged(ref.id))! }
  }

  it('bound order: changed upstream county is never called; report evidence is the bound snapshot; replay stable', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { id, stored } = await boundOrder('drift')
    shift = 1000; countyCalls.length = 0
    const first = await produceNeutralReport({ orderId: id, propertyPin: pins[0] })
    expect(first).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: stored.snapshot.dataEvidenceSha256 }) })
    expect(countyCalls).toEqual([])
    const write = (await repo.readConfirmed((first as any).receipt.key))!.write
    expect(write.dataPages.map(p => Buffer.from(p.bytes).toString('base64'))).toEqual(stored.pages.map((p: any) => Buffer.from(p.bytes).toString('base64')))
    expect(write.csv.toString()).toContain('40000')
    expect(write.csv.toString()).not.toContain('41000')
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] })).toEqual(first)
    expect(countyCalls).toEqual([])
    // Contrast: an UNBOUND order under the same drift takes the legacy county read.
    const unbound = await produceNeutralReport({ orderId: orderId('unbound'), propertyPin: pins[0] })
    expect(unbound.ok).toBe(true)
    expect((unbound as any).receipt.dataEvidenceSha256).not.toBe(stored.snapshot.dataEvidenceSha256)
    expect(countyCalls.length).toBeGreaterThan(0)
  })

  it('foreign-PIN binding, missing snapshot, tampered pages, unavailable binding store: fail closed with zero county calls', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { id, stored } = await boundOrder('fail')
    countyCalls.length = 0
    // Order authority says another PIN than the bound snapshot.
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[1] })).toEqual({ ok: false, blocker: 'NEUTRAL_REPLAY_CONFLICT' })
    const runtime = (snapshotBinding: any) => ({ active: true, repository: new TestNeutralRepository(), snapshotBinding })
    const missing = { readPrivileged: async () => undefined, persist: async () => { throw Error('no') } }
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] }, runtime({ bindingStore: bindings, snapshotStore: missing }))).toEqual({ ok: false, blocker: 'NEUTRAL_SNAPSHOT_BINDING_UNAVAILABLE' })
    const tampered = { readPrivileged: async () => ({ ...stored, pages: stored.pages.map((p: any, i: number) => (i === stored.pages.length - 1 ? { receipt: p.receipt, bytes: Buffer.concat([p.bytes, Buffer.from(' ')]) } : p)) }), persist: missing.persist }
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] }, runtime({ bindingStore: bindings, snapshotStore: tampered }))).toEqual({ ok: false, blocker: 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID' })
    const forgedSha = { readPrivileged: async () => ({ ...stored, sha256: 'f'.repeat(64) }), persist: missing.persist }
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] }, runtime({ bindingStore: bindings, snapshotStore: forgedSha }))).toEqual({ ok: false, blocker: 'NEUTRAL_SNAPSHOT_BINDING_UNAVAILABLE' })
    const down = { read: async () => { throw Error('down') }, bind: async () => ({ ok: false, blocker: 'BINDING_UNAVAILABLE' }) }
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] }, runtime({ bindingStore: down, snapshotStore: snapshots }))).toEqual({ ok: false, blocker: 'NEUTRAL_SNAPSHOT_BINDING_UNAVAILABLE' })
    expect(countyCalls).toEqual([])
  })

  it('config loss: bound order with both snapshot env URLs removed refuses with zero county calls (no deployment-level UNBOUND inference)', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { id } = await boundOrder('envloss')
    const binder = process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL, reader = process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL
    delete process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL; delete process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL
    shift = 1000; countyCalls.length = 0
    try {
      expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0] })).toEqual({ ok: false, blocker: 'NEUTRAL_SNAPSHOT_BINDING_UNAVAILABLE' })
      expect(countyCalls).toEqual([])
    } finally { process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = binder; process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = reader }
  })
})
