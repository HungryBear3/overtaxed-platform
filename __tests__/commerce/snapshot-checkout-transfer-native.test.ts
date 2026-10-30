/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Skips when not configured.
// Free result -> server-issued browser transfer -> immutable order binding ->
// paid reload of the SAME persisted snapshot with zero county refetch.
import { Pool } from 'pg'
import { createHash, randomBytes } from 'node:crypto'

jest.mock('server-only', () => ({}), { virtual: true })
const gatewayCalls: string[] = []
jest.mock('@/lib/fulfillment-runtime/neutral-raw-gateway', () => ({
  SHARED_COLLECTOR_PROTECTIONS: [],
  verifyAndCopyNeutralEvidence: () => null,
  readNeutralOfficialBytesRuntime: async (input: { propertyPin: string }) => { gatewayCalls.push(input.propertyPin); throw new Error('COUNTY_REFETCH_FORBIDDEN') },
}))

const writerUrl = process.env.SNAPSHOT_TEST_WRITER_URL, readerUrl = process.env.SNAPSHOT_TEST_READER_URL, adminUrl = process.env.SNAPSHOT_TEST_ADMIN_URL, binderUrl = process.env.SNAPSHOT_TEST_BINDER_URL
const native = writerUrl && readerUrl && adminUrl && binderUrl ? describe : describe.skip
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const SECRET = 'test-transfer-secret-0123456789abcdef0123456789'
const PIN = '14000000000077'

function fixture(seed: string, retrievedAt: string) {
  const bytes = Buffer.from(JSON.stringify([{ pin: PIN, seed }]))
  const receipt = { datasetId: 'uzyt-m557', datasetTitle: 't', url: 'https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json?$where=' + seed, retrievedAt, contentSha256: sha(bytes), roles: ['subject'], subjectPin: PIN, taxYear: 2026 }
  const snapshot = {
    schema: 'ot-acquisition-snapshot/v1', seed,
    subject: { pin: PIN, propertyClass: '2-03', neighborhoodCode: '77001', residentialSubtype: 'one_story', buildingSqft: 1200, yearBuilt: 1950, assessedTotalCents: 3000000, address: '1 TEST ST', township: 'Test', city: 'CHICAGO', stage: 'mailed', taxYear: 2026, assessedCentsPerBuildingSqft: 2500 },
    subjectProration: { pinNumCards: 1 },
    sources: [receipt],
    dataEvidenceSha256: sha('data-' + seed),
  }
  return { snapshot: snapshot as any, pages: [{ receipt, bytes }] }
}
const req = (path: string, cookie?: string, init: RequestInit = {}) => new Request('https://ot.test' + path, { ...init, headers: { ...(cookie ? { cookie } : {}), origin: 'https://ot.test', 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) } })
const cookiePair = (setCookie: string) => setCookie.split(';')[0]

native('snapshot checkout transfer (native PostgreSQL)', () => {
  const pools: Pool[] = []
  const raw = (url: string) => { const p = new Pool({ connectionString: url, max: 1 }); p.on('error', () => {}); pools.push(p); return p }
  let store: any, bindings: any
  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET = SECRET
    await raw(adminUrl!).query('ALTER ROLE ot_paid_snapshot_binder LOGIN')
    const snap = await import('@/lib/evidence/server/acquisition-snapshot')
    store = snap.createPostgresAcquisitionSnapshotStore({ writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' })
    const b = await import('@/lib/commerce/snapshot-checkout-transfer')
    bindings = b.createPostgresOrderSnapshotBindingStore({ binderUrl: binderUrl!, readerUrl: readerUrl!, ssl: 'disable' })
  })
  afterAll(async () => { await store?.close(); await bindings?.close(); await Promise.all(pools.map(p => p.end().catch(() => {}))) })

  it('free browser -> transfer cookie -> immutable binding -> bound reload; denies forged/foreign/stale/replay/swap', async () => {
    const { createSnapshotTransferAuthority, SNAPSHOT_TRANSFER_COOKIE, createGuardedSnapshotTransferRoute } = await import('@/lib/commerce/snapshot-checkout-transfer')
    const { createFreeResultAccess } = await import('@/lib/evidence/server/free-result-access')
    const { loadNeutralCheckoutFromTransfer, readOrderBoundSnapshot } = await import('@/lib/commerce/neutral-checkout-runtime')
    const now = new Date(Date.now() - 60_000).toISOString()
    const a = fixture('a-' + randomBytes(6).toString('hex'), now)
    const refA = await store.persist(a.snapshot, a.pages)
    const b = fixture('b-' + randomBytes(6).toString('hex'), now)
    const refB = await store.persist(b.snapshot, b.pages)

    // 1. Free browser holding its result capability obtains a checkout-scoped transfer.
    const access = createFreeResultAccess({ secret: SECRET })
    const resultId = 'res_' + 'a'.repeat(24)
    const persisted = { resultId, snapshotId: 'snp_x', subject: { pin: '14-00-000-000-0077', township: 'Test', taxYear: 2026 }, acquisitionSnapshot: { id: refA.id, sha256: refA.sha256 } }
    const freeStore = { getResult: async (id: string) => (id === resultId ? persisted : undefined) } as any
    const route = createGuardedSnapshotTransferRoute({ store: freeStore, access, transfer: createSnapshotTransferAuthority({ secret: SECRET }) })
    const freeCookie = cookiePair(access.issueCookie(persisted)!)
    const noCapability = await route.POST(req('/api/free-check/transfer?id=' + resultId, undefined, { method: 'POST' }))
    expect(noCapability.status).toBe(404)
    expect(noCapability.headers.get('set-cookie')).toBeNull()
    const issued = await route.POST(req('/api/free-check/transfer?id=' + resultId, freeCookie, { method: 'POST' }))
    expect(issued.status).toBe(200)
    const setCookie = issued.headers.get('set-cookie')!
    expect(setCookie).toMatch(new RegExp('^' + SNAPSHOT_TRANSFER_COOKIE + '='))
    expect(setCookie).toContain('Path=/api/checkout')
    expect(setCookie).toContain('HttpOnly')
    expect(JSON.stringify(await issued.json())).not.toContain(refA.id)
    const transferCookie = cookiePair(setCookie)

    // 2. Checkout reads only the signed cookie; forged / expired / foreign are refused.
    const authority = createSnapshotTransferAuthority({ secret: SECRET })
    const claim = authority.readClaim(req('/api/checkout/session', transferCookie))
    expect(claim.status).toBe('VALID')
    if (claim.status !== 'VALID') throw new Error('unreachable')
    expect(claim.claim).toMatchObject({ snapshotId: refA.id, sha256: refA.sha256, pin: PIN })
    const [payload, mac] = transferCookie.split('=')[1].split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), s: refB.id, h: refB.sha256 })).toString('base64url')
    expect(authority.readClaim(req('/x', `${SNAPSHOT_TRANSFER_COOKIE}=${forgedPayload}.${mac}`)).status).toBe('INVALID')
    expect(createSnapshotTransferAuthority({ secret: SECRET + 'other' }).readClaim(req('/x', transferCookie)).status).toBe('INVALID')
    expect(createSnapshotTransferAuthority({ secret: SECRET, now: () => Date.now() + 31 * 60_000 }).readClaim(req('/x', transferCookie)).status).toBe('INVALID')
    expect(authority.readClaim(req('/x')).status).toBe('ABSENT')
    expect(await loadNeutralCheckoutFromTransfer({ ...claim.claim, pin: '14000000000078' }, { snapshotStore: store })).toBeNull()

    // 3. Checkout evidence comes from the persisted snapshot: zero county calls.
    const evidence = await loadNeutralCheckoutFromTransfer(claim.claim, { snapshotStore: store })
    expect(evidence).toMatchObject({ dataEvidenceSha256: a.snapshot.dataEvidenceSha256, acquisitionSnapshot: { id: refA.id, sha256: refA.sha256 }, property: { pin: PIN, mailed_tot: 30000, char_bldg_sf: 1200 } })
    expect(gatewayCalls).toEqual([])
    // Stale disclosure: sources older than 24h never admit.
    const old = fixture('old-' + randomBytes(6).toString('hex'), new Date(Date.now() - 25 * 3600_000).toISOString())
    const refOld = await store.persist(old.snapshot, old.pages)
    expect(await loadNeutralCheckoutFromTransfer({ ...claim.claim, snapshotId: refOld.id, sha256: refOld.sha256 }, { snapshotStore: store })).toBeNull()

    // 4. Durable atomic binding: duplicate idempotent, replay/swap/forged denied.
    const order1 = 'ord_native_' + randomBytes(8).toString('hex'), order2 = 'ord_native_' + randomBytes(8).toString('hex')
    const dup = await Promise.all([bindings.bind({ orderId: order1, claim: claim.claim }), bindings.bind({ orderId: order1, claim: claim.claim })])
    expect(dup).toEqual([{ ok: true }, { ok: true }])
    expect(await bindings.bind({ orderId: order2, claim: claim.claim })).toEqual({ ok: false, blocker: 'TRANSFER_REPLAYED' })
    const swap = { snapshotId: refB.id, sha256: refB.sha256, pin: PIN, nonce: randomBytes(16).toString('hex'), exp: claim.claim.exp }
    expect(await bindings.bind({ orderId: order1, claim: swap })).toEqual({ ok: false, blocker: 'ORDER_SNAPSHOT_CONFLICT' })
    const unknown = { ...swap, snapshotId: 'acq_' + 'f'.repeat(64), sha256: 'f'.repeat(64), nonce: randomBytes(16).toString('hex') }
    expect((await bindings.bind({ orderId: 'ord_native_' + randomBytes(8).toString('hex'), claim: unknown })).ok).toBe(false)
    const foreignPin = { ...swap, pin: '14000000000078', nonce: randomBytes(16).toString('hex') }
    expect((await bindings.bind({ orderId: 'ord_native_' + randomBytes(8).toString('hex'), claim: foreignPin })).ok).toBe(false)

    // Database itself refuses rebinding or deletion, even for the binder role.
    const binder = raw(binderUrl!)
    await expect(binder.query('UPDATE ot_order_snapshot_binding SET snapshot_id=$1, snapshot_sha256=$2 WHERE order_id=$3', [refB.id, refB.sha256, order1])).rejects.toThrow()
    await expect(binder.query('DELETE FROM ot_order_snapshot_binding WHERE order_id=$1', [order1])).rejects.toThrow()
    await expect(raw(adminUrl!).query('UPDATE ot_order_snapshot_binding SET snapshot_id=$1, snapshot_sha256=$2 WHERE order_id=$3', [refB.id, refB.sha256, order1])).rejects.toThrow(/ORDER_SNAPSHOT_BINDING_IMMUTABLE/)
    await expect(raw(writerUrl!).query('SELECT 1 FROM ot_order_snapshot_binding')).rejects.toThrow()

    // 5. Paid reload by order id returns the bound snapshot, not a refetch, after upstream drift.
    const drifted = fixture('drift-' + randomBytes(6).toString('hex'), new Date().toISOString())
    await store.persist(drifted.snapshot, drifted.pages)
    const reloaded = await readOrderBoundSnapshot(order1, { bindingStore: bindings, snapshotStore: store })
    expect(reloaded?.id).toBe(refA.id)
    expect(reloaded?.sha256).toBe(refA.sha256)
    expect(reloaded?.snapshot).toEqual(a.snapshot)
    expect(await readOrderBoundSnapshot(order2, { bindingStore: bindings, snapshotStore: store })).toBeUndefined()
    expect(gatewayCalls).toEqual([])
  })
})
