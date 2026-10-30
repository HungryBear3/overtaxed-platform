/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Missing native env is a HARD FAILURE (no describe.skip).
// Admitted-snapshot lookup BOUNDARY: canonical text is cast to jsonb only for the <=CAP bounded rows of ONE PIN,
// never for any other stored row, under ANY planner choice; overflow casts nothing.
// Detector: "poison" rows (valid for every table CHECK, canonical is NOT JSON) inserted by the REAL writer role.
// Any server-side cast of a poison row raises `invalid input syntax for type json`, so a run that completes
// without that error proves the poison rows were never cast. Planner alternatives are forced (a) by SET LOCAL for
// EXPLAIN ANALYZE of the exported SQL and (b) by role-level GUC defaults on this disposable cluster so the ACTUAL
// store method runs under them. Neither the default plan nor the statement timeout is treated as the guarantee.
import { Pool, Client } from 'pg'
import { createHash, randomBytes } from 'node:crypto'

jest.mock('server-only', () => ({}), { virtual: true })

const writerUrl = process.env.SNAPSHOT_TEST_WRITER_URL, readerUrl = process.env.SNAPSHOT_TEST_READER_URL, adminUrl = process.env.SNAPSHOT_TEST_ADMIN_URL
const SCHEMA = 'ot-acquisition-snapshot/v1', READER = 'ot_paid_snapshot_reader'
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
const hex = () => randomBytes(32).toString('hex')
const UNDER = '14000000009100', OVER = '14000000009101', AMB = '14000000009102', PINSWAP = '14000000009103', HASHTAMPER = '14000000009104', CORRUPT = '14000000009105'
const POISON_PINS = Array.from({ length: 40 }, (_, i) => `1499999999${String(9000 + i)}`)
const POISON = '{"poison":'

/** Planner alternatives. Each is a legal plan space the lookup must be safe under; none is "the" plan. */
const MATRIX: Record<string, Record<string, string>> = {
  default: {},
  seqOnly: { enable_indexscan: 'off', enable_bitmapscan: 'off', enable_indexonlyscan: 'off' },
  hashForced: { enable_nestloop: 'off', enable_mergejoin: 'off', enable_memoize: 'off' },
  mergeForced: { enable_nestloop: 'off', enable_hashjoin: 'off', enable_memoize: 'off' },
  noSeqscan: { enable_seqscan: 'off' },
  genericPlan: { plan_cache_mode: 'force_generic_plan' },
  costSkew: { random_page_cost: '1000', seq_page_cost: '0.01', cpu_operator_cost: '0' },
}

function synth(pin: string, digest: string, tag: string, subjectPin = pin) {
  const bytes = Buffer.from(`synthetic page ${subjectPin} ${tag}`)
  // Synthetic fixture receipt: only the fields the store's page/receipt consistency checks read (typed loosely on purpose).
  const receipt: any = { contentSha256: sha(bytes), roles: ['subject'], subjectPin, retrievedAt: '2026-09-15T15:00:00.000Z', source: 'synthetic-' + tag }
  return { snapshot: { schema: SCHEMA, subject: { pin: subjectPin }, sources: [receipt], dataEvidenceSha256: digest, tag } as any, pages: [{ receipt, bytes }] }
}

type PlanNode = Record<string, any> & { Plans?: PlanNode[] }
const flatten = (n: PlanNode, out: PlanNode[] = []): PlanNode[] => { out.push(n); for (const c of n.Plans ?? []) flatten(c, out); return out }
const own = (n: PlanNode) => { const { Plans, ...rest } = n; void Plans; return JSON.stringify(rest) }

describe('admitted-snapshot lookup boundary: bounded rows, no outside canonical cast, under adverse planners (native PostgreSQL)', () => {
  let admin: Pool, writer: Pool, mod: typeof import('@/lib/evidence/server/acquisition-snapshot')
  let snapshots: ReturnType<typeof import('@/lib/evidence/server/acquisition-snapshot')['createPostgresAcquisitionSnapshotStore']>
  const inserted: string[] = []
  const targets: Record<string, { id: string; digest: string }> = {}

  async function rawInsert(row: { id: string; pin: string; sha256: string; canonical: string; pages: string; pages_sha256: string }) {
    await writer.query('INSERT INTO ot_acquisition_snapshot(id,schema,subject_pin,sha256,canonical,pages,pages_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)', [row.id, SCHEMA, row.pin, row.sha256, row.canonical, row.pages, row.pages_sha256])
    inserted.push(row.id)
  }
  const poison = (pin: string) => { const s = hex(); return rawInsert({ id: 'acq_' + s, pin, sha256: s, canonical: POISON, pages: 'x', pages_sha256: hex() }) }
  async function valid(pin: string, digest: string, tag: string) {
    const { snapshot, pages } = synth(pin, digest, tag)
    const ref = await snapshots.persist(snapshot, pages); inserted.push(ref.id); return ref
  }
  async function withReader<T>(settings: Record<string, string>, fn: (c: any) => Promise<T>): Promise<T> {
    const p = new Pool({ connectionString: readerUrl!, max: 1 }); p.on('error', () => {})
    const c = await p.connect()
    try {
      await c.query('BEGIN READ ONLY')
      for (const [k, v] of Object.entries(settings)) await c.query(`SET LOCAL ${k} = '${v}'`)
      expect((await c.query('SELECT current_user::text AS u')).rows[0].u).toBe(READER)
      return await fn(c)
    } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); await p.end().catch(() => {}) }
  }
  const params = (pin: string, digest: string) => [pin, SCHEMA, digest, mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP + 1]
  async function explain(settings: Record<string, string>, pin: string, digest: string) {
    return withReader(settings, async c => {
      const [{ Plan }] = (await c.query(`EXPLAIN (ANALYZE, VERBOSE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) ${mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL}`, params(pin, digest))).rows[0]['QUERY PLAN']
      return flatten(Plan)
    })
  }
  /** Role-level GUC defaults so the ACTUAL store (its own pool/session) plans under the setting. Fixture-only; reset. */
  async function underRoleSettings<T>(settings: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    try {
      for (const [k, v] of Object.entries(settings)) await admin.query(`ALTER ROLE ${READER} SET ${k} = '${v}'`)
      const shown = await withReader({}, async c => Object.fromEntries(await Promise.all(Object.keys(settings).map(async k => [k, (await c.query(`SHOW ${k}`)).rows[0][k]]))))
      expect(shown).toEqual(settings)
      return await fn()
    } finally { await admin.query(`ALTER ROLE ${READER} RESET ALL`) }
  }
  const roleSettingCount = async () => Number((await admin.query(`SELECT count(*) AS n FROM pg_db_role_setting WHERE setrole='${READER}'::regrole`)).rows[0].n)

  beforeAll(async () => {
    if (!writerUrl || !readerUrl || !adminUrl || !process.env.OT_NEUTRAL_TEST_RUNTIME_URL) throw new Error('BOUNDARY_NATIVE_ENV_MISSING')
    admin = new Pool({ connectionString: adminUrl, max: 1 }); admin.on('error', () => {})
    writer = new Pool({ connectionString: writerUrl, max: 1 }); writer.on('error', () => {})
    expect((await writer.query('SELECT current_user::text AS u')).rows[0].u).toBe('ot_factual_app')
    expect(await roleSettingCount()).toBe(0)
    mod = await import('@/lib/evidence/server/acquisition-snapshot')
    snapshots = mod.createPostgresAcquisitionSnapshotStore({ writerUrl, readerUrl, ssl: 'disable' })
    // Noncandidate poison: 40 rows of OTHER PINs.
    for (const pin of POISON_PINS) await poison(pin)
    // UNDER: exactly CAP valid same-PIN rows (target + CAP-1 other digests).
    targets.under = { digest: hex(), id: '' }
    targets.under.id = (await valid(UNDER, targets.under.digest, 'under-target')).id
    for (let i = 1; i < mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP; i++) await valid(UNDER, hex(), 'under-filler-' + i)
    // OVER: target present + 39 same-PIN POISON rows (40 > CAP+1): any cast at all would raise.
    targets.over = { digest: hex(), id: '' }
    targets.over.id = (await valid(OVER, targets.over.digest, 'over-target')).id
    for (let i = 0; i < 39; i++) await poison(OVER)
    // AMB: two internally consistent rows, same PIN, same digest.
    targets.amb = { digest: hex(), id: '' }
    await valid(AMB, targets.amb.digest, 'amb-1'); await valid(AMB, targets.amb.digest, 'amb-2')
    // PINSWAP: hash-consistent row stored under PINSWAP whose canonical subject PIN is another PIN.
    targets.pinswap = { digest: hex(), id: '' }
    { const { snapshot, pages } = synth(PINSWAP, targets.pinswap.digest, 'pinswap', UNDER); const canonical = mod.canonicalJson(snapshot), s = sha(canonical)
      const enc = mod.canonicalJson(pages.map(p => ({ receipt: p.receipt, bytesBase64: p.bytes.toString('base64') })))
      await rawInsert({ id: 'acq_' + s, pin: PINSWAP, sha256: s, canonical, pages: enc, pages_sha256: sha(enc) }) }
    // HASHTAMPER: valid JSON with the digest, but sha256 is not the canonical's hash.
    targets.hash = { digest: hex(), id: '' }
    { const { snapshot } = synth(HASHTAMPER, targets.hash.digest, 'hash'); const s = hex()
      await rawInsert({ id: 'acq_' + s, pin: HASHTAMPER, sha256: s, canonical: mod.canonicalJson(snapshot), pages: 'x', pages_sha256: hex() }) }
    // CORRUPT: target + one corrupt (poison) candidate in the SAME PIN, under the cap -> must fail closed.
    targets.corrupt = { digest: hex(), id: '' }
    targets.corrupt.id = (await valid(CORRUPT, targets.corrupt.digest, 'corrupt-target')).id
    await poison(CORRUPT)
    await admin.query('ANALYZE ot_acquisition_snapshot')
  })
  afterAll(async () => {
    try {
      await admin.query(`ALTER ROLE ${READER} RESET ALL`)
      // Fixture cleanup on this disposable cluster only: poison must not reach later suites. The immutability
      // triggers are bypassed for THIS transaction only (session_replication_role), never dropped/disabled.
      await admin.query('BEGIN'); await admin.query("SET LOCAL session_replication_role = 'replica'")
      await admin.query('DELETE FROM ot_acquisition_snapshot WHERE id = ANY($1)', [inserted]); await admin.query('COMMIT')
      const trig = (await admin.query("SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.ot_acquisition_snapshot'::regclass AND NOT tgisinternal ORDER BY 1")).rows
      expect(trig).toEqual([{ tgname: 'ot_acquisition_snapshot_immutable', tgenabled: 'O' }, { tgname: 'ot_acquisition_snapshot_no_truncate', tgenabled: 'O' }])
      expect(await roleSettingCount()).toBe(0)
    } finally { await snapshots?.close(); await writer?.end().catch(() => {}); await admin?.end().catch(() => {}) }
  })

  it('poison detector is live: an explicit full-table cast as the paid reader raises the json error', async () => {
    await expect(withReader({}, c => c.query(`SELECT count(*) FROM ot_acquisition_snapshot WHERE (canonical::jsonb->>'dataEvidenceSha256')=$1`, [hex()]))).rejects.toThrow(/invalid input syntax for type json/)
    expect(Number((await admin.query('SELECT count(*) AS n FROM ot_acquisition_snapshot WHERE canonical=$1', [POISON])).rows[0].n)).toBe(40 + 39 + 1)
  })

  it('structural (source): ONE base-table reference, inside a MATERIALIZED bounded CTE; the only cast is CASE-gated on CTE rows', () => {
    const q = mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL
    expect(mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP).toBe(32)
    expect(q.match(/\bot_acquisition_snapshot\b/g)).toHaveLength(1)
    expect(q).toMatch(/^WITH bounded AS MATERIALIZED \(SELECT id, canonical FROM ot_acquisition_snapshot WHERE subject_pin=\$1 AND schema=\$2 LIMIT \$4::int\), /)
    expect(q.match(/::jsonb/g)).toHaveLength(1)
    expect(q).toMatch(/CASE WHEN counted\.n < \$4::int THEN \(b\.canonical::jsonb->>'dataEvidenceSha256'\)=\$3 ELSE false END/)
    expect(q).not.toMatch(/JOIN ot_acquisition_snapshot/)
    // Stage 2 casts nothing and is keyed by id + PIN.
    expect(mod.ADMITTED_SNAPSHOT_BODY_SQL).toBe('SELECT id,sha256,canonical,pages,pages_sha256 FROM ot_acquisition_snapshot WHERE id=$1 AND subject_pin=$2')
  })

  it.each(Object.keys(MATRIX))('plan alternative %s: executed EXPLAIN ANALYZE has one base scan without any cast, <=CAP+1 base rows, <=CAP casts; overflow executes with zero casts', async name => {
    const CAP = mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP
    for (const [pin, digest, overflow] of [[UNDER, targets.under.digest, false], [OVER, targets.over.digest, true]] as const) {
      const nodes = await explain(MATRIX[name], pin, digest)
      const base = nodes.filter(n => n['Relation Name'] === 'ot_acquisition_snapshot')
      const casting = nodes.filter(n => own(n).includes('jsonb'))
      console.log(`BOUNDARY-PLAN ${name} ${overflow ? 'overflow' : 'under-cap'} ` + JSON.stringify(nodes.map(n => [n['Node Type'], n['Relation Name'] ?? n['CTE Name'] ?? n['Subplan Name'] ?? '', n['Actual Rows'], n['Actual Loops'], n['Rows Removed by Filter'] ?? 0])))
      expect(base).toHaveLength(1)
      expect(own(base[0])).not.toMatch(/jsonb/)
      expect(base[0]['Actual Rows'] * base[0]['Actual Loops']).toBeLessThanOrEqual(CAP + 1)
      expect(casting.length).toBeGreaterThan(0)
      for (const n of casting) {
        expect([n['Node Type'], n['CTE Name']]).toEqual(['CTE Scan', 'bounded'])
        expect((n['Actual Rows'] + (n['Rows Removed by Filter'] ?? 0)) * n['Actual Loops']).toBeLessThanOrEqual(CAP)
      }
    }
    // Raw execution under the same alternative: poison noncandidates (and, on overflow, 39 poison candidates) never cast.
    expect(await withReader(MATRIX[name], async c => (await c.query(mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL, params(UNDER, targets.under.digest))).rows)).toEqual([{ candidates: CAP, id: targets.under.id }])
    expect(await withReader(MATRIX[name], async c => (await c.query(mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL, params(OVER, targets.over.digest))).rows)).toEqual([{ candidates: CAP + 1, id: null }])
  })

  it.each(Object.keys(MATRIX))('actual store under role-level alternative %s: under-cap resolves; overflow / ambiguity / PIN swap / hash tamper / corrupt candidate fail closed; wrong PIN or digest is absent', async name => {
    await underRoleSettings(MATRIX[name], async () => {
      const store = mod.createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' })
      try {
        const hit = await store.readAdmittedPrivileged!(UNDER, targets.under.digest)
        expect(hit && { id: hit.id, pin: hit.snapshot.subject.pin, digest: hit.snapshot.dataEvidenceSha256 }).toEqual({ id: targets.under.id, pin: UNDER, digest: targets.under.digest })
        await expect(store.readAdmittedPrivileged!(OVER, targets.over.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        await expect(store.readAdmittedPrivileged!(AMB, targets.amb.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        await expect(store.readAdmittedPrivileged!(PINSWAP, targets.pinswap.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        await expect(store.readAdmittedPrivileged!(HASHTAMPER, targets.hash.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        await expect(store.readAdmittedPrivileged!(CORRUPT, targets.corrupt.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        expect(await store.readAdmittedPrivileged!(UNDER, hex())).toBeUndefined()
        // A PIN whose ONLY row is corrupt: that row is its own bounded candidate, so it is cast and fails closed.
        await expect(store.readAdmittedPrivileged!(POISON_PINS[0], targets.under.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
        expect(await store.readAdmittedPrivileged!('14000000009199', targets.under.digest)).toBeUndefined()
        expect(await store.readAdmittedPrivileged!(AMB, targets.under.digest)).toBeUndefined()
      } finally { await store.close() }
    })
    expect(await roleSettingCount()).toBe(0)
  })

  it('returned PII: stage 1 returns only {candidates,id}; canonical bodies returned: 0 on overflow/ambiguity/absent, exactly 1 on a unique match; wrong roles refused', async () => {
    const seen: Array<{ text: string; rows: Record<string, unknown>[] }> = []
    const orig = Client.prototype.query
    const spy = jest.spyOn(Client.prototype as any, 'query').mockImplementation(function (this: unknown, ...args: any[]) {
      const r = (orig as any).apply(this, args)
      if (r && typeof r.then === 'function') r.then((res: any) => { seen.push({ text: String(args[0]?.text ?? args[0]), rows: res?.rows ?? [] }) }, () => {})
      return r
    })
    const store = mod.createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' })
    const bodies = () => seen.flatMap(s => s.rows).filter(r => 'canonical' in r || 'pages' in r).length
    const stage1 = () => seen.filter(s => s.text === mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL)
    try {
      for (const [pin, digest, expected] of [[OVER, targets.over.digest, 0], [AMB, targets.amb.digest, 0], [UNDER, hex(), 0], [UNDER, targets.under.digest, 1]] as const) {
        seen.length = 0
        await store.readAdmittedPrivileged!(pin, digest).catch(() => undefined)
        expect(stage1()).toHaveLength(1)
        for (const r of stage1()[0].rows) expect(Object.keys(r).sort()).toEqual(['candidates', 'id'])
        expect(stage1()[0].rows.length).toBeLessThanOrEqual(2)
        expect(bodies()).toBe(expected)
      }
    } finally { spy.mockRestore(); await store.close() }
    // Wrong role behind the reader URL: refused by the role-checked transaction before any lookup.
    const wrong = mod.createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: writerUrl!, ssl: 'disable' })
    try { await expect(wrong.readAdmittedPrivileged!(UNDER, targets.under.digest)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE') } finally { await wrong.close() }
    // Neutral runtime login: PostgreSQL denies the table outright.
    const neutral = new Pool({ connectionString: process.env.OT_NEUTRAL_TEST_RUNTIME_URL!, max: 1 }); neutral.on('error', () => {})
    try { await expect(neutral.query(mod.ADMITTED_SNAPSHOT_CANDIDATES_SQL, params(UNDER, targets.under.digest))).rejects.toThrow(/permission denied/) } finally { await neutral.end() }
  })

  it('in-memory store: same bound; overflow and ambiguity decode nothing; a unique match decodes one row', async () => {
    const mem = mod.createInMemoryAcquisitionSnapshotStore()
    const CAP = mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP, d = hex(), a = hex()
    const target = synth(UNDER, d, 'mem-target'); const ref = await mem.persist(target.snapshot, target.pages)
    for (let i = 1; i < CAP; i++) { const f = synth(UNDER, hex(), 'mem-f' + i); await mem.persist(f.snapshot, f.pages) }
    for (const t of ['mem-a1', 'mem-a2']) { const f = synth(AMB, a, t); await mem.persist(f.snapshot, f.pages) }
    for (let i = 0; i < 50; i++) { const f = synth(POISON_PINS[i % 40], hex(), 'mem-o' + i); await mem.persist(f.snapshot, f.pages) }
    /** Runs one lookup with JSON.parse counted; the outcome is returned, never swallowed. */
    const parses = async (fn: () => Promise<unknown>) => {
      const spy = jest.spyOn(JSON, 'parse')
      try { const out = await fn().then(v => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e: e.message })); return { out, n: spy.mock.calls.length } } finally { spy.mockRestore() }
    }
    const hit = await parses(() => mem.readAdmittedPrivileged!(UNDER, d))
    expect(hit.out.ok && (hit.out.v as any)?.id).toBe(ref.id)
    expect(hit.n).toBeLessThanOrEqual(2)
    expect(await parses(() => mem.readAdmittedPrivileged!(AMB, a))).toEqual({ out: { ok: false, e: 'SNAPSHOT_STORAGE_UNAVAILABLE' }, n: 0 })
    const extra = synth(UNDER, hex(), 'mem-overflow'); await mem.persist(extra.snapshot, extra.pages)
    expect(await parses(() => mem.readAdmittedPrivileged!(UNDER, d))).toEqual({ out: { ok: false, e: 'SNAPSHOT_STORAGE_UNAVAILABLE' }, n: 0 })
    expect(await mem.readAdmittedPrivileged!(OVER, d)).toBeUndefined()
  })

  it('in-memory store: per-lookup work is bounded (no store scan) with many other-PIN rows and same-PIN overflow; index metadata comes from the serialized row', async () => {
    const mem = mod.createInMemoryAcquisitionSnapshotStore()
    const CAP = mod.ADMITTED_SNAPSHOT_CANDIDATE_CAP, BIG = 1000
    const put = async (pin: string, digest: string, tag: string) => { const f = synth(pin, digest, tag); return mem.persist(f.snapshot, f.pages) }
    // Wraps prototype methods for the duration of fn only. Only "large" Maps (the store's, >= BIG entries) are counted,
    // so runtime-internal Maps cannot perturb the bound; Array receivers of any size are counted.
    const instrument = async (fn: () => Promise<unknown>) => {
      const stats = { mapIter: 0, mapGet: 0, maxArray: 0, parses: 0, bigPush: 0 }, restore: Array<() => void> = []
      const wrap = (proto: any, key: string | symbol, on: (self: any) => void) => {
        const orig = proto[key]; proto[key] = function (this: any, ...args: any[]) { on(this); return orig.apply(this, args) }; restore.push(() => { proto[key] = orig })
      }
      for (const k of ['values', 'keys', 'entries', 'forEach', Symbol.iterator]) wrap(Map.prototype, k, self => { if (self.size >= BIG) stats.mapIter++ })
      wrap(Map.prototype, 'get', self => { if (self.size >= BIG) stats.mapGet++ })
      for (const k of ['filter', 'slice', 'map', 'forEach', Symbol.iterator]) wrap(Array.prototype, k, self => { stats.maxArray = Math.max(stats.maxArray, self.length) })
      wrap(Array.prototype, 'push', self => { if (self.length > CAP) stats.bigPush++ })
      wrap(JSON, 'parse', () => { stats.parses++ })
      try { const out = await fn().then(v => ({ ok: true as const, id: (v as any)?.id }), (e: Error) => ({ ok: false as const, e: e.message })); return { out, ...stats } } finally { while (restore.length) restore.pop()!() }
    }
    const d = hex(), dOver = hex(), a = hex()
    const ref = await put(UNDER, d, 'big-target')
    for (let i = 1; i < CAP; i++) await put(UNDER, hex(), 'big-f' + i)
    for (let i = 0; i < 40; i++) await put(UNDER, d, 'big-target') // duplicate re-persists must not inflate the PIN's candidates
    for (const t of ['big-a1', 'big-a2']) await put(AMB, a, t)
    for (let i = 0; i < 3000; i++) await put('13' + String(i).padStart(12, '0'), hex(), 'big-o' + i)
    await put(OVER, dOver, 'big-over-target')
    for (let i = 1; i <= CAP; i++) await put(OVER, hex(), 'big-over' + i)
    // Persist-time memory: once a PIN reaches the CAP+1 sentinel, further same-PIN rows grow no bounded structure.
    const surplus = await instrument(async () => { for (let i = 0; i < 167; i++) await put(OVER, hex(), 'big-surplus' + i) })
    expect(surplus).toMatchObject({ out: { ok: true }, bigPush: 0 })
    const bounded = { mapIter: 0, mapGet: expect.any(Number), maxArray: expect.any(Number), bigPush: 0 }
    const hit = await instrument(() => mem.readAdmittedPrivileged!(UNDER, d))
    expect(hit).toMatchObject({ out: { ok: true, id: ref.id }, ...bounded })
    expect(hit.parses).toBeLessThanOrEqual(2)
    const over = await instrument(() => mem.readAdmittedPrivileged!(OVER, dOver))
    expect(over).toMatchObject({ out: { ok: false, e: 'SNAPSHOT_STORAGE_UNAVAILABLE' }, ...bounded, parses: 0 })
    const amb = await instrument(() => mem.readAdmittedPrivileged!(AMB, a))
    expect(amb).toMatchObject({ out: { ok: false, e: 'SNAPSHOT_STORAGE_UNAVAILABLE' }, ...bounded, parses: 0 })
    const miss = await instrument(() => mem.readAdmittedPrivileged!(UNDER, hex()))
    expect(miss).toMatchObject({ out: { ok: true, id: undefined }, ...bounded, parses: 0 })
    const absent = await instrument(() => mem.readAdmittedPrivileged!('14000000009198', d))
    expect(absent).toMatchObject({ out: { ok: true, id: undefined }, ...bounded, parses: 0 })
    for (const r of [hit, over, amb, miss, absent]) { expect(r.mapGet).toBeLessThanOrEqual(2); expect(r.maxArray).toBeLessThanOrEqual(CAP + 1) }
    // Index metadata is taken from the serialized bytes, not re-read from a mutable/accessor snapshot object.
    const A = '14000000009106', B = '14000000009107', dA = hex(), acc = synth(A, dA, 'mem-accessor')
    let reads = 0; Object.defineProperty(acc.snapshot.subject, 'pin', { enumerable: true, get: () => (reads++ === 0 ? A : B) })
    const accRef = await mem.persist(acc.snapshot, acc.pages)
    expect(reads).toBeGreaterThanOrEqual(1)
    expect((await mem.readAdmittedPrivileged!(A, dA))?.id).toBe(accRef.id)
    expect(await mem.readAdmittedPrivileged!(B, dA)).toBeUndefined()
  })
})
