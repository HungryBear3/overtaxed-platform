/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Missing native env is a HARD FAILURE (no describe.skip).
// UNBOUND (no transfer cookie) paid producer: replays the immutable acquisition snapshot that checkout
// admission persisted, located by the order PIN + the order-authorized admitted data digest, through the
// REAL paid reader role (SELECT-only). No county refetch after admission; zero / ambiguous / tampered /
// wrong-PIN / wrong-digest / wrong-role all fail closed.
// Mocked: county/calendar transport (globalThis.fetch) and the report repository only.
import { Pool } from 'pg'
import { randomBytes } from 'node:crypto'
import { ASSESSOR_CONTEXT } from '@/lib/deadlines/assessor-calendar-context'
import { TOWNSHIPS } from '@/lib/townships'
import { installNeutralTestRuntime, TestNeutralRepository } from '@/test-support/neutral-report-runtime'

jest.mock('server-only', () => ({}), { virtual: true })

const writerUrl = process.env.SNAPSHOT_TEST_WRITER_URL, readerUrl = process.env.SNAPSHOT_TEST_READER_URL, adminUrl = process.env.SNAPSHOT_TEST_ADMIN_URL, binderUrl = process.env.SNAPSHOT_TEST_BINDER_URL

const pins = ['14000000000500', '14000000000501', '14000000000502', '14000000000503', '14000000000504']
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
const orderId = (tag: string) => `ord_admitted_${tag}_${randomBytes(6).toString('hex')}`

describe('unbound paid producer replays the order-admitted acquisition snapshot (native PostgreSQL)', () => {
  const pools: Pool[] = []
  let admin: Pool, snapshots: any, bindings: any, uninstall: () => void, repo: TestNeutralRepository, priorFetch: typeof fetch
  const env = { ...process.env }
  beforeAll(async () => {
    if (!writerUrl || !readerUrl || !adminUrl || !binderUrl) throw new Error('ADMITTED_NATIVE_ENV_MISSING')
    admin = new Pool({ connectionString: adminUrl, max: 1 }); admin.on('error', () => {}); pools.push(admin)
    // Default production stores (no injection into the producer): env-configured roles.
    process.env.OT_PAID_SNAPSHOT_BINDER_DATABASE_URL = binderUrl; process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = readerUrl
    process.env.OT_FACTUAL_DATABASE_URL = writerUrl; process.env.OT_FACTUAL_DATABASE_SSL = 'disable'
    snapshots = (await import('@/lib/evidence/server/acquisition-snapshot')).createPostgresAcquisitionSnapshotStore({ writerUrl, readerUrl, ssl: 'disable' })
    bindings = (await import('@/lib/commerce/snapshot-checkout-transfer')).createPostgresOrderSnapshotBindingStore({ binderUrl, readerUrl, ssl: 'disable' })
  })
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-15T15:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] })
    shift = 0; countyCalls.length = 0
    priorFetch = globalThis.fetch; (globalThis as any).fetch = countyFetch
    repo = new TestNeutralRepository(); uninstall = installNeutralTestRuntime(repo)
  })
  afterEach(() => { uninstall(); (globalThis as any).fetch = priorFetch; jest.useRealTimers() })
  afterAll(async () => { process.env = env; await snapshots?.close(); await bindings?.close(); await Promise.all(pools.map(p => p.end().catch(() => {}))) })

  /** EXPLAIN ANALYZE under the REAL paid reader role, default planner settings, read-only transaction. */
  async function readerPlan(sql: string, params: unknown[]) {
    const reader = new Pool({ connectionString: readerUrl!, max: 1 }); reader.on('error', () => {})
    const c = await reader.connect()
    try {
      await c.query('BEGIN READ ONLY')
      const user = (await c.query('SELECT current_user::text AS u')).rows[0].u
      const text = (await c.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) ${sql}`, params)).rows.map(r => r['QUERY PLAN']).join('\n')
      await c.query('ROLLBACK')
      return { user, text }
    } finally { c.release(); await reader.end().catch(() => {}) }
  }

  /** REAL checkout admission (strict gateway read + immutable snapshot persist); NO binding row is written. */
  async function admit(tag: string, minuteOffset = 0) {
    jest.setSystemTime(new Date(Date.parse('2026-09-15T15:00:00Z') + minuteOffset * 60_000))
    const { loadNeutralCheckoutOfficialProperty } = await import('@/lib/commerce/neutral-checkout-runtime')
    const admitted = (await loadNeutralCheckoutOfficialProperty(pins[0], { snapshotStore: snapshots }))!
    expect(admitted.acquisitionSnapshot).toMatchObject({ dataEvidenceSha256: admitted.dataEvidenceSha256 })
    const id = orderId(tag)
    expect(await bindings.read(id)).toBeUndefined()
    jest.setSystemTime(new Date('2026-09-15T15:30:00Z'))
    countyCalls.length = 0
    return { id, admitted, stored: (await snapshots.readPrivileged(admitted.acquisitionSnapshot!.id))! }
  }

  it('admitted unbound order: county drift never read; report evidence + sharedMetric are the admitted snapshot; replay stable', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { id, admitted, stored } = await admit('ok')
    shift = 1000
    const first = await produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: admitted.dataEvidenceSha256 })
    expect(first).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: admitted.dataEvidenceSha256 }) })
    expect(countyCalls).toEqual([])
    const write = (await repo.readConfirmed((first as any).receipt.key))!.write
    expect(write.dataPages.map(p => Buffer.from(p.bytes).toString('base64'))).toEqual(stored.pages.map((p: any) => Buffer.from(p.bytes).toString('base64')))
    expect(write.csv.toString()).not.toContain('41000')
    const manifest = JSON.parse(write.manifestJson)
    expect(manifest.sharedMetric).toEqual(stored.snapshot.sharedMetric)
    expect(manifest.sharedMetric).toMatchObject({ cohortRule: 'PAID_NEUTRAL_MATCH_V1', subjectExcluded: true, sampleAdequacy: 'NOT_QUALIFIED', comparableMedian: { status: 'COMPUTED', count: 2, minimumCount: 1 } })
    // Receipts (incl. retrievedAt) are the admission-time receipts, not a later read.
    expect(manifest.sources.map((s: any) => s.retrievedAt + s.contentSha256).sort()).toEqual(stored.snapshot.sources.map((s: any) => s.retrievedAt + s.contentSha256).sort())
    expect(manifest.sources.every((s: any) => s.retrievedAt <= '2026-09-15T15:00:00.000Z')).toBe(true)
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: admitted.dataEvidenceSha256 })).toEqual(first)
    expect(countyCalls).toEqual([])
  })

  it('zero / wrong-PIN / wrong-digest / malformed / tampered / ambiguous / legacy store / env loss: fail closed with zero county calls', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { createPostgresAcquisitionSnapshotStore } = await import('@/lib/evidence/server/acquisition-snapshot')
    const { id, admitted, stored } = await admit('fail', 1)
    const digest = admitted.dataEvidenceSha256
    const runtime = (snapshotStore: any) => ({ active: true, repository: new TestNeutralRepository(), snapshotBinding: { bindingStore: bindings, snapshotStore } })
    /** Each refusal is checked on its own: exact blocker AND no county call made by THAT call. */
    const refuse = async (call: Promise<unknown>, blocker: string) => { countyCalls.length = 0; expect(await call).toEqual({ ok: false, blocker }); expect(countyCalls).toEqual([]) }
    // No snapshot carries this admitted digest.
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: 'a'.repeat(64) }), 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE')
    // Order PIN differs from the admitted snapshot's PIN: the PIN-bounded lookup finds nothing.
    await refuse(produceNeutralReport({ orderId: orderId('pin'), propertyPin: pins[1], admittedDataEvidenceSha256: digest }), 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE')
    // Malformed admitted digest never reaches storage.
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: 'XYZ' }), 'NEUTRAL_INPUT_INVALID')
    // Tampered stored page bytes / forged snapshot hash returned by the lookup.
    const tampered = { readAdmittedPrivileged: async () => ({ ...stored, pages: stored.pages.map((p: any, i: number) => (i === stored.pages.length - 1 ? { receipt: p.receipt, bytes: Buffer.concat([p.bytes, Buffer.from(' ')]) } : p)) }), readPrivileged: async () => undefined, persist: async () => { throw Error('no') } }
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(tampered)), 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID')
    const forged = { ...tampered, readAdmittedPrivileged: async () => ({ ...stored, sha256: 'f'.repeat(64) }) }
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(forged)), 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID')
    // Injected lookup result whose SUBJECT PIN is swapped (digest unchanged): the producer's own PIN guard refuses.
    const swappedPin = { ...tampered, readAdmittedPrivileged: async () => ({ ...stored, snapshot: { ...stored.snapshot, subject: { ...stored.snapshot.subject, pin: pins[1] } } }) }
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(swappedPin)), 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID')
    // Injected lookup result whose snapshot digest field is swapped (subject PIN unchanged).
    const swappedDigest = { ...tampered, readAdmittedPrivileged: async () => ({ ...stored, snapshot: { ...stored.snapshot, dataEvidenceSha256: 'c'.repeat(64) } }) }
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(swappedDigest)), 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID')
    // A lookup answering with a whole other (real, valid) snapshot of another digest is rejected too.
    const other = await admit('other', 2)
    const swapped = { ...tampered, readAdmittedPrivileged: async () => other.stored }
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(swapped)), 'NEUTRAL_SNAPSHOT_EVIDENCE_INVALID')
    // Legacy store without the admitted lookup: fail closed, never a refetch.
    await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime({ readPrivileged: snapshots.readPrivileged, persist: snapshots.persist })), 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE')
    // Wrong role behind the reader URL (writer credentials): the role-checked transaction refuses.
    const wrongRole = createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: writerUrl!, ssl: 'disable' })
    try { await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }, runtime(wrongRole)), 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE') } finally { await wrongRole.close() }
    // Ambiguity: a second, internally consistent snapshot row for the same PIN with the same data digest.
    const amb = await admit('amb', 3)
    const twin = JSON.parse(JSON.stringify(amb.stored.snapshot)); twin.cohorts.FREE_EXACT_CLASS_V1.criteria += ' (twin)'
    await snapshots.persist(twin, amb.stored.pages)
    expect(Number((await admin.query(`SELECT count(*) AS n FROM ot_acquisition_snapshot WHERE subject_pin=$1 AND (canonical::jsonb->>'dataEvidenceSha256')=$2`, [pins[0], amb.admitted.dataEvidenceSha256])).rows[0].n)).toBe(2)
    await expect(snapshots.readAdmittedPrivileged(pins[0], amb.admitted.dataEvidenceSha256)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
    await refuse(produceNeutralReport({ orderId: amb.id, propertyPin: pins[0], admittedDataEvidenceSha256: amb.admitted.dataEvidenceSha256 }), 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE')
    // Reader env loss: never inferred as a refetch permission.
    const reader = process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL
    delete process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL
    try { await refuse(produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest }), 'NEUTRAL_SNAPSHOT_BINDING_UNAVAILABLE') }
    finally { process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL = reader }
    // Sanity: the untouched admitted order still produces from its own snapshot after all refusals.
    countyCalls.length = 0
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: digest })).toEqual({ ok: true, receipt: expect.objectContaining({ dataEvidenceSha256: digest }) })
    expect(countyCalls).toEqual([])
  })

  it('store lookup: exact PIN+digest match only, bounded, paid reader SELECT-only; other roles cannot read snapshots', async () => {
    const { ADMITTED_SNAPSHOT_CANDIDATES_SQL, ADMITTED_SNAPSHOT_CANDIDATE_CAP } = await import('@/lib/evidence/server/acquisition-snapshot')
    const { admitted, stored } = await admit('store', 4)
    const found = await snapshots.readAdmittedPrivileged(pins[0], admitted.dataEvidenceSha256)
    expect({ id: found.id, sha256: found.sha256 }).toEqual({ id: stored.id, sha256: stored.sha256 })
    expect(await snapshots.readAdmittedPrivileged(pins[1], admitted.dataEvidenceSha256)).toBeUndefined()
    expect(await snapshots.readAdmittedPrivileged(pins[0], 'b'.repeat(64))).toBeUndefined()
    for (const [pin, d] of [['1400000000050', admitted.dataEvidenceSha256], [pins[0], 'B'.repeat(64)], [`${pins[0]}' OR '1'='1`, admitted.dataEvidenceSha256], [pins[0], ''] ] as const) expect(await snapshots.readAdmittedPrivileged(pin, d)).toBeUndefined()
    // Bounded candidate ROWS: one PIN, at most CAP+1 (id, canonical) rows; the only cast is CASE-gated on those rows.
    // (Oracle updated for the lookup-boundary redesign: the old shape rejoined the base table; full structural and
    // adverse-planner proof lives in admitted-snapshot-lookup-boundary-native.test.ts.)
    expect(ADMITTED_SNAPSHOT_CANDIDATE_CAP).toBe(32)
    expect(ADMITTED_SNAPSHOT_CANDIDATES_SQL).toMatch(/^WITH bounded AS MATERIALIZED \(SELECT id, canonical FROM ot_acquisition_snapshot WHERE subject_pin=\$1 AND schema=\$2 LIMIT \$4::int\)/)
    expect(ADMITTED_SNAPSHOT_CANDIDATES_SQL).toMatch(/CASE WHEN counted\.n < \$4::int THEN \(b\.canonical::jsonb->>'dataEvidenceSha256'\)=\$3 ELSE false END LIMIT 2\) m ON true$/)
    expect(ADMITTED_SNAPSHOT_CANDIDATES_SQL.match(/\bot_acquisition_snapshot\b/g)).toHaveLength(1)
    // Default-settings plan, executed as the REAL paid reader role (no planner settings changed). The physical
    // traversal on this tiny fixture may be a seq scan; the bound asserted is on candidate rows, not index use.
    const plan = await readerPlan(ADMITTED_SNAPSHOT_CANDIDATES_SQL, [pins[0], 'ot-acquisition-snapshot/v1', admitted.dataEvidenceSha256, ADMITTED_SNAPSHOT_CANDIDATE_CAP + 1])
    console.log('ADMITTED-CANDIDATES-PLAN(default,reader)\n' + plan.text)
    expect(plan.user).toBe('ot_paid_snapshot_reader')
    expect(plan.text).toMatch(/CTE bounded/)
    expect(plan.text).toMatch(/Limit/)
    expect(plan.text).toMatch(/subject_pin = /)
    // ACL: paid reader is SELECT-only; neutral runtime / binder / PUBLIC hold no snapshot privilege.
    const acl = (await admin.query(`SELECT r AS role, has_table_privilege(r,'public.ot_acquisition_snapshot','SELECT') AS sel, has_table_privilege(r,'public.ot_acquisition_snapshot','INSERT') AS ins, has_table_privilege(r,'public.ot_acquisition_snapshot','UPDATE') AS upd, has_table_privilege(r,'public.ot_acquisition_snapshot','DELETE') AS del FROM unnest(ARRAY['ot_paid_snapshot_reader','ot_neutral_runtime','ot_paid_snapshot_binder']) r`)).rows
    console.log('ADMITTED-LOOKUP-ACL ' + JSON.stringify(acl))
    expect(acl).toEqual([
      { role: 'ot_paid_snapshot_reader', sel: true, ins: false, upd: false, del: false },
      { role: 'ot_neutral_runtime', sel: false, ins: false, upd: false, del: false },
      { role: 'ot_paid_snapshot_binder', sel: false, ins: false, upd: false, del: false },
    ])
    const pub = (await admin.query(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name='ot_acquisition_snapshot' AND grantee='PUBLIC'`)).rows[0].n
    expect(pub).toBe(0)
    const roles = (await admin.query(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='ot_paid_snapshot_reader'`)).rows
    expect(roles).toEqual([{ rolname: 'ot_paid_snapshot_reader', rolsuper: false, rolbypassrls: false }])
    // Native wrong-role probe: the neutral runtime login is denied by PostgreSQL itself.
    if (process.env.OT_NEUTRAL_TEST_RUNTIME_URL) {
      const neutral = new Pool({ connectionString: process.env.OT_NEUTRAL_TEST_RUNTIME_URL, max: 1 }); neutral.on('error', () => {}); pools.push(neutral)
      await expect(neutral.query(ADMITTED_SNAPSHOT_CANDIDATES_SQL, [pins[0], 'ot-acquisition-snapshot/v1', admitted.dataEvidenceSha256, ADMITTED_SNAPSHOT_CANDIDATE_CAP + 1])).rejects.toThrow(/permission denied/)
    } else throw new Error('ADMITTED_NATIVE_ENV_MISSING OT_NEUTRAL_TEST_RUNTIME_URL')
  })

  it('candidate cap: many same-PIN admissions -> exact cap still resolves; cap+1 fails closed EVEN WITH the target present (no winner chosen); other PINs unaffected', async () => {
    const { produceNeutralReport } = await import('@/lib/fulfillment/neutral-report-content')
    const { ADMITTED_SNAPSHOT_CANDIDATES_SQL, ADMITTED_SNAPSHOT_CANDIDATE_CAP } = await import('@/lib/evidence/server/acquisition-snapshot')
    const CAP = 32
    const { id, admitted, stored } = await admit('cap', 5)
    const rowsFor = async () => Number((await admin.query('SELECT count(*) AS n FROM ot_acquisition_snapshot WHERE subject_pin=$1', [pins[0]])).rows[0].n)
    // Filler admissions for the SAME PIN: valid, internally consistent rows with OTHER data digests.
    let k = 0
    const filler = async () => { const f = JSON.parse(JSON.stringify(stored.snapshot)); f.dataEvidenceSha256 = require('node:crypto').createHash('sha256').update('filler-' + k++).digest('hex'); await snapshots.persist(f, stored.pages) }
    const before = await rowsFor()
    expect(before).toBeLessThan(CAP)
    while (await rowsFor() < CAP) await filler()
    expect(await rowsFor()).toBe(CAP)
    // Exactly at the cap: the unique match resolves (boundary).
    const atCap = await snapshots.readAdmittedPrivileged(pins[0], admitted.dataEvidenceSha256)
    expect(atCap && { id: atCap.id, sha256: atCap.sha256 }).toEqual({ id: stored.id, sha256: stored.sha256 })
    // One more same-PIN admission: overflow -> fail closed although the target row exists.
    await filler()
    expect(await rowsFor()).toBe(CAP + 1)
    await expect(snapshots.readAdmittedPrivileged(pins[0], admitted.dataEvidenceSha256)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
    countyCalls.length = 0
    expect(await produceNeutralReport({ orderId: id, propertyPin: pins[0], admittedDataEvidenceSha256: admitted.dataEvidenceSha256 })).toEqual({ ok: false, blocker: 'NEUTRAL_ADMITTED_SNAPSHOT_UNAVAILABLE' })
    expect(countyCalls).toEqual([])
    // Overflow is per PIN: another PIN still answers normally (no match -> undefined, not an error).
    expect(await snapshots.readAdmittedPrivileged(pins[1], admitted.dataEvidenceSha256)).toBeUndefined()
    // Reader-role default plan in the overflow state: candidate ids are capped at CAP+1 and matching
    // returns no id; canonical decoding is gated by the candidate count (logged for the receipt).
    expect(ADMITTED_SNAPSHOT_CANDIDATE_CAP).toBe(CAP)
    const plan = await readerPlan(ADMITTED_SNAPSHOT_CANDIDATES_SQL, [pins[0], 'ot-acquisition-snapshot/v1', admitted.dataEvidenceSha256, CAP + 1])
    console.log('ADMITTED-CANDIDATES-PLAN-OVERFLOW(default,reader)\n' + plan.text)
    expect(plan.user).toBe('ot_paid_snapshot_reader')
    // Observed physical facts of this run (not the guarantee): bounded rows capped at CAP+1; the base table is
    // scanned by exactly ONE plan node (no rejoin); the canonical-casting scan is gated by the candidate count.
    expect(plan.text).toMatch(new RegExp(`CTE Scan on bounded \\(actual rows=${CAP + 1}(\\.00)? `))
    expect(plan.text).toMatch(new RegExp(`One-Time Filter: [^\\n]*< ${CAP + 1}\\)`))
    expect(plan.text.match(/ on ot_acquisition_snapshot\b/g)).toHaveLength(1)
    const raw = (await (async () => { const r = new Pool({ connectionString: readerUrl!, max: 1 }); r.on('error', () => {}); try { return (await r.query(ADMITTED_SNAPSHOT_CANDIDATES_SQL, [pins[0], 'ot-acquisition-snapshot/v1', admitted.dataEvidenceSha256, CAP + 1])).rows } finally { await r.end() } })())
    expect(raw).toEqual([{ candidates: CAP + 1, id: null }])
  })
})
