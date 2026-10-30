/** @jest-environment node */
// Native PostgreSQL only (owned disposable socket). Skips when not configured.
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { createPostgresAcquisitionSnapshotStore, type CanonicalAcquisitionSnapshot } from '@/lib/evidence/server/acquisition-snapshot'

const writerUrl = process.env.SNAPSHOT_TEST_WRITER_URL, readerUrl = process.env.SNAPSHOT_TEST_READER_URL, anonUrl = process.env.SNAPSHOT_TEST_ANON_URL
const native = writerUrl && readerUrl ? describe : describe.skip
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

function fixture(seed: string): { snapshot: CanonicalAcquisitionSnapshot; pages: { receipt: any; bytes: Buffer }[] } {
  const bytes = Buffer.from(JSON.stringify([{ pin: '14000000000000', seed }]))
  const receipt = { datasetId: 'pabr-t5kh', datasetTitle: 't', url: 'https://datacatalog.cookcountyil.gov/resource/pabr-t5kh.json?$where=x', retrievedAt: '2026-10-20T00:00:00.000Z', contentSha256: sha(bytes), roles: ['subject'], subjectPin: '14000000000000', taxYear: 2026 }
  // Store requires snapshot.sources to bind 1:1 to the persisted exact pages.
  return { pages: [{ receipt, bytes }], snapshot: { schema: 'ot-acquisition-snapshot/v1', seed, subject: { pin: '14000000000000' }, sources: [receipt] } as any }
}

native('acquisition snapshot native persistence and role separation', () => {
  const pools: Pool[] = []
  const raw = (url: string) => { const p = new Pool({ connectionString: url, max: 1 }); p.on('error', () => {}); pools.push(p); return p }
  afterAll(async () => { await Promise.all(pools.map(p => p.end().catch(() => {}))) })

  it('persists immutably, survives restart, is read by a separate privileged instance, refuses others', async () => {
    const config = { writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' as const }
    const a = createPostgresAcquisitionSnapshotStore(config)
    const { snapshot, pages } = fixture('native-' + Date.now())
    const ref = await a.persist(snapshot, pages)
    expect(ref.id).toBe('acq_' + ref.sha256)
    // Idempotent re-persist of identical content returns same identity.
    expect(await a.persist(snapshot, pages)).toEqual(ref)
    await a.close()
    // "Restart": a brand-new store instance with fresh pools reads via reader role.
    const b = createPostgresAcquisitionSnapshotStore(config)
    const stored = await b.readPrivileged(ref.id)
    expect(stored?.sha256).toBe(ref.sha256)
    expect(stored?.snapshot).toEqual(snapshot)
    expect(Buffer.compare(stored!.pages[0].bytes, pages[0].bytes)).toBe(0)
    expect(await b.readPrivileged('acq_' + '0'.repeat(64))).toBeUndefined()
    await b.close()

    const reader = raw(readerUrl!), writer = raw(writerUrl!)
    expect((await reader.query('SELECT current_user AS u')).rows[0].u).toBe('ot_paid_snapshot_reader')
    await expect(reader.query(`INSERT INTO ot_acquisition_snapshot(id,schema,subject_pin,sha256,canonical,pages,pages_sha256) VALUES ('acq_${'1'.repeat(64)}','x','14000000000000','${'1'.repeat(64)}','{}','[]','${'1'.repeat(64)}')`)).rejects.toThrow(/permission denied/)
    await expect(reader.query('SELECT * FROM ot_factual_result')).rejects.toThrow(/permission denied/)
    await expect(writer.query(`UPDATE ot_acquisition_snapshot SET canonical='{}' WHERE id=$1`, [ref.id])).rejects.toThrow(/permission denied|IMMUTABLE/)
    await expect(writer.query(`DELETE FROM ot_acquisition_snapshot WHERE id=$1`, [ref.id])).rejects.toThrow(/permission denied|IMMUTABLE/)
    if (anonUrl) {
      const anon = raw(anonUrl)
      await expect(anon.query('SELECT * FROM ot_acquisition_snapshot')).rejects.toThrow(/permission denied/)
    }
    // Wrong role for the reader handle is refused before any read.
    const swapped = createPostgresAcquisitionSnapshotStore({ writerUrl: readerUrl!, readerUrl: writerUrl!, ssl: 'disable' })
    await expect(swapped.readPrivileged(ref.id)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
    await swapped.close()
  })

  it('detects tampered canonical bytes at privileged read', async () => {
    const config = { writerUrl: writerUrl!, readerUrl: readerUrl!, ssl: 'disable' as const }
    const s = createPostgresAcquisitionSnapshotStore(config)
    const { snapshot, pages } = fixture('tamper-' + Date.now())
    const ref = await s.persist(snapshot, pages)
    const admin = process.env.SNAPSHOT_TEST_ADMIN_URL
    if (admin) {
      const p = raw(admin)
      await p.query('ALTER TABLE ot_acquisition_snapshot DISABLE TRIGGER ot_acquisition_snapshot_immutable')
      try { await p.query(`UPDATE ot_acquisition_snapshot SET canonical='{"seed":"forged"}' WHERE id=$1`, [ref.id]) }
      finally { await p.query('ALTER TABLE ot_acquisition_snapshot ENABLE TRIGGER ot_acquisition_snapshot_immutable') }
      await expect(s.readPrivileged(ref.id)).rejects.toThrow('SNAPSHOT_STORAGE_UNAVAILABLE')
    }
    await s.close()
  })
})
