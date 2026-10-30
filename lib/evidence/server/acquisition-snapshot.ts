import 'server-only'
import { createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { roleTransport } from './role-transport'
import { median, selectNonDirectionalComparables } from '@/lib/fulfillment/t2-comparables'
import { replayNeutralOfficialBytes, verifyAndCopyNeutralEvidence, SHARED_COLLECTOR_PROTECTIONS, type NeutralRawEvidence, type SharedCollectorProtection } from '@/lib/fulfillment-runtime/neutral-raw-gateway'
import type { NeutralSourceReceipt } from '@/lib/fulfillment/neutral-report-content'

/**
 * Canonical normalized acquisition snapshot. The ONE collector is the neutral raw
 * gateway (complete pool, one-card characteristic/value/address joins, exact
 * source bytes); this module only normalizes and freezes its verified evidence.
 *
 * Two cohort rules are recorded side by side and never merged. Medians carry an
 * explicit unit; no published/product metric is selected here (owner decision
 * pending). Assessed values are mailed-stage assessments, not market prices.
 */
export const ACQUISITION_SNAPSHOT_SCHEMA = 'ot-acquisition-snapshot/v1' as const
export const FREE_EXACT_CLASS_RULE = 'FREE_EXACT_CLASS_V1' as const
export const PAID_NEUTRAL_MATCH_RULE = 'PAID_NEUTRAL_MATCH_V1' as const
export const MEDIAN_UNITS = ['ASSESSED_TOTAL_USD_CENTS', 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT'] as const
export type MedianUnit = (typeof MEDIAN_UNITS)[number]
export type CohortRule = typeof FREE_EXACT_CLASS_RULE | typeof PAID_NEUTRAL_MATCH_RULE

export type NamedMedian =
  | { unit: MedianUnit; status: 'COMPUTED'; value: number; count: number; minimumCount: number }
  | { unit: MedianUnit; status: 'NOT_COMPUTABLE'; reason: 'EMPTY' | 'INSUFFICIENT' | 'INVALID_INPUT'; count: number; minimumCount: number }

/** Pure median with a declared unit; reuses the existing t2 median arithmetic. */
export function namedMedian(unit: MedianUnit, values: ReadonlyArray<number>, options: { minimumCount: number }): NamedMedian {
  if (!MEDIAN_UNITS.includes(unit)) throw new Error('UNIT_UNSUPPORTED')
  const minimumCount = options.minimumCount
  if (!Number.isSafeInteger(minimumCount) || minimumCount < 1) throw new Error('MINIMUM_INVALID')
  const count = values.length
  if (values.some(v => !Number.isFinite(v) || v < 0)) return { unit, status: 'NOT_COMPUTABLE', reason: 'INVALID_INPUT', count, minimumCount }
  if (count === 0) return { unit, status: 'NOT_COMPUTABLE', reason: 'EMPTY', count, minimumCount }
  if (count < minimumCount) return { unit, status: 'NOT_COMPUTABLE', reason: 'INSUFFICIENT', count, minimumCount }
  return { unit, status: 'COMPUTED', value: median(values)!, count, minimumCount }
}

export type SnapshotParcel = { pin: string; propertyClass: string; neighborhoodCode: string; residentialSubtype: string; buildingSqft: number; yearBuilt: number; assessedTotalCents: number; address: string }
export type SnapshotCohort = { rule: CohortRule; criteria: string; selected: string[]; excluded: Array<{ pin: string; reason: string }>; metrics: Record<MedianUnit, NamedMedian> }
export type CanonicalAcquisitionSnapshot = {
  schema: typeof ACQUISITION_SNAPSHOT_SCHEMA
  collector: 'neutral-raw-gateway'
  collectorProtections: SharedCollectorProtection[]
  subject: SnapshotParcel & { township: string; city: string; stage: 'mailed'; taxYear: number; assessedCentsPerBuildingSqft: number }
  units: { assessedTotal: 'USD_CENTS'; buildingArea: 'SQFT'; perArea: 'USD_CENTS_PER_BUILDING_SQFT' }
  pool: SnapshotParcel[]
  /** FREE_EXACT_CLASS_V1 is legacy/historical data only, never the shared comparable cohort. */
  cohorts: Record<CohortRule, SnapshotCohort>
  sharedMetric: SharedComparisonMetric
  subjectProration: Record<string, unknown>
  sources: NeutralSourceReceipt[]
  dataEvidenceSha256: string
  upstreamAtomicGuarantee: 'NOT_ESTABLISHED'
}
/**
 * Owner-selected shared comparison (free brief and paid detail read this same
 * field): median mailed assessed value per building sqft over the existing
 * qualified comparable cohort, subject excluded. Subject total shown separately.
 */
export const SHARED_METRIC_VERSION = 'ot-shared-metric/v1' as const
export type SharedComparisonMetric = {
  version: typeof SHARED_METRIC_VERSION
  metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT'
  unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT'
  cohortRule: typeof PAID_NEUTRAL_MATCH_RULE
  stage: 'mailed'
  taxYear: number
  subjectExcluded: true
  subjectAssessedCentsPerBuildingSqft: number
  subjectAssessedTotalCents: number
  comparableMedian: NamedMedian
  sampleAdequacy: 'NOT_QUALIFIED'
  claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS'
}
export type SnapshotPage = { receipt: NeutralSourceReceipt; bytes: Buffer }
export type StoredAcquisitionSnapshot = { id: string; sha256: string; snapshot: CanonicalAcquisitionSnapshot; pages: SnapshotPage[] }
export type AcquisitionSnapshotRef = { id: string; sha256: string }
export interface AcquisitionSnapshotStore {
  persist(snapshot: CanonicalAcquisitionSnapshot, pages: ReadonlyArray<SnapshotPage>): Promise<AcquisitionSnapshotRef>
  /** Privileged paid-server read. Never exposed to a browser role. */
  readPrivileged(id: string): Promise<StoredAcquisitionSnapshot | undefined>
  /**
   * Privileged paid-server read of the snapshot an unbound order was admitted with:
   * exactly one row for this PIN whose canonical data digest equals the order's
   * admitted digest. None -> undefined; more than one -> throws (ambiguous).
   */
  readAdmittedPrivileged?(pin: string, dataEvidenceSha256: string): Promise<StoredAcquisitionSnapshot | undefined>
}

const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex')
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  return JSON.stringify(value)
}
function deepFreeze<T>(v: T): T { if (v && typeof v === 'object' && !Buffer.isBuffer(v)) { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v) } return v }
function cents(dollars: number): number | null {
  const c = Math.round(dollars * 100)
  return Number.isSafeInteger(c) && c > 0 && Math.abs(c - dollars * 100) < 1e-6 ? c : null
}
const unavailable = () => new Error('SNAPSHOT_STORAGE_UNAVAILABLE')
const ID = /^acq_[a-f0-9]{64}$/
const PIN = /^\d{14}$/, DIGEST = /^[0-9a-f]{64}$/
/**
 * Engineering bound (not a product or cohort threshold): at most this many snapshot
 * rows for one PIN are ever considered. More than this fails closed (overflow),
 * even when a matching row is among them; no winner is chosen.
 */
export const ADMITTED_SNAPSHOT_CANDIDATE_CAP = 32
/**
 * Stage 1, one PIN only ($4 = CAP+1). Boundary, by SQL semantics rather than by any observed plan:
 * - the snapshot table is referenced exactly ONCE, in `bounded`, restricted only by PIN/schema equality and
 *   LIMIT $4; no expression over `canonical` exists at that scan, whatever access path is chosen;
 * - `bounded` is MATERIALIZED, so outer quals are never pushed into it: canonical text is cast only for the
 *   <= CAP+1 rows it holds, never for another PIN's row (no rejoin of the base table);
 * - the cast sits in CASE WHEN n < $4, which PostgreSQL evaluates only when true: overflow casts nothing, and
 *   under the cap at most CAP rows are cast. (The bare `counted.n < $4` qual only lets the plan skip the scan.)
 * Returns the candidate count and up to 2 matching ids, never canonical/pages text.
 */
export const ADMITTED_SNAPSHOT_CANDIDATES_SQL = "WITH bounded AS MATERIALIZED (SELECT id, canonical FROM ot_acquisition_snapshot WHERE subject_pin=$1 AND schema=$2 LIMIT $4::int), counted AS MATERIALIZED (SELECT count(*)::int AS n FROM bounded) SELECT counted.n AS candidates, m.id FROM counted LEFT JOIN LATERAL (SELECT b.id FROM bounded b WHERE counted.n < $4::int AND CASE WHEN counted.n < $4::int THEN (b.canonical::jsonb->>'dataEvidenceSha256')=$3 ELSE false END LIMIT 2) m ON true"
/** Stage 2: the body of the single matching snapshot only. */
export const ADMITTED_SNAPSHOT_BODY_SQL = 'SELECT id,sha256,canonical,pages,pages_sha256 FROM ot_acquisition_snapshot WHERE id=$1 AND subject_pin=$2'
function admittedMatch(rows: StoredAcquisitionSnapshot[], pin: string, dataEvidenceSha256: string): StoredAcquisitionSnapshot | undefined {
  if (rows.length > 1) throw unavailable()
  const found = rows[0]
  if (found && (found.snapshot.subject?.pin !== pin || found.snapshot.dataEvidenceSha256 !== dataEvidenceSha256 || found.snapshot.schema !== ACQUISITION_SNAPSHOT_SCHEMA)) throw unavailable()
  return found
}
const metrics = (parcels: SnapshotParcel[]): Record<MedianUnit, NamedMedian> => ({
  ASSESSED_TOTAL_USD_CENTS: namedMedian('ASSESSED_TOTAL_USD_CENTS', parcels.map(p => p.assessedTotalCents), { minimumCount: 1 }),
  ASSESSED_USD_CENTS_PER_BUILDING_SQFT: namedMedian('ASSESSED_USD_CENTS_PER_BUILDING_SQFT', parcels.map(p => p.assessedTotalCents / p.buildingSqft), { minimumCount: 1 }),
})

/** Normalize verified gateway evidence. Returns null (fail closed) on any inconsistency. */
export function buildAcquisitionSnapshot(evidence: NeutralRawEvidence): { snapshot: CanonicalAcquisitionSnapshot; pages: SnapshotPage[]; sha256: string; id: string } | null {
  // Only evidence collected WITH the retained free-collector protections qualifies.
  if (canonicalJson(evidence.collectorProtections ?? null) !== canonicalJson(SHARED_COLLECTOR_PROTECTIONS)) return null
  const pages = verifyAndCopyNeutralEvidence(evidence)
  if (!pages) return null
  const pool: SnapshotParcel[] = []
  const seen = new Set<string>()
  for (const c of [...evidence.candidatePool].sort((a, b) => (a.pin < b.pin ? -1 : 1))) {
    const value = evidence.assessedValues.get(c.pin), address = evidence.addresses.get(c.pin)
    const c100 = value === undefined ? null : cents(value)
    if (seen.has(c.pin) || c100 === null || !address || !(c.buildingSqft > 0)) return null
    seen.add(c.pin)
    pool.push({ pin: c.pin, propertyClass: c.propertyClass, neighborhoodCode: c.neighborhoodCode, residentialSubtype: c.residentialSubtype, buildingSqft: c.buildingSqft, yearBuilt: c.yearBuilt, assessedTotalCents: c100, address })
  }
  if (pool.length !== evidence.assessedValues.size || pool.length !== evidence.addresses.size) return null
  const s = evidence.subject, subjectParcel = pool.find(p => p.pin === s.pin), subjectCents = cents(s.assessedTotalValue)
  if (!subjectParcel || subjectCents !== subjectParcel.assessedTotalCents) return null
  const byPin = new Map(pool.map(p => [p.pin, p]))
  // Free rule: exact class, same complete pool, subject excluded; value blind.
  const freeExcluded: Array<{ pin: string; reason: string }> = [], freeSelected: string[] = []
  for (const p of pool) {
    if (p.pin === s.pin) freeExcluded.push({ pin: p.pin, reason: 'same_parcel_as_subject' })
    else if (p.propertyClass !== s.propertyClass) freeExcluded.push({ pin: p.pin, reason: 'different_class' })
    else freeSelected.push(p.pin)
  }
  // Paid rule: the existing neutral selector, unchanged.
  const strict = selectNonDirectionalComparables(s, evidence.candidatePool)
  if (!strict) return null
  const strictSelected = strict.accepted.map(a => a.pin)
  if (strictSelected.some(pin => !byPin.has(pin) || pin === s.pin)) return null
  const strictMetrics = metrics(strictSelected.map(p => byPin.get(p)!))
  const snapshot: CanonicalAcquisitionSnapshot = {
    schema: ACQUISITION_SNAPSHOT_SCHEMA,
    collector: 'neutral-raw-gateway',
    collectorProtections: [...SHARED_COLLECTOR_PROTECTIONS],
    subject: { ...subjectParcel, township: s.township, city: s.city, stage: 'mailed', taxYear: s.taxYear, assessedCentsPerBuildingSqft: subjectParcel.assessedTotalCents / subjectParcel.buildingSqft },
    units: { assessedTotal: 'USD_CENTS', buildingArea: 'SQFT', perArea: 'USD_CENTS_PER_BUILDING_SQFT' },
    pool,
    cohorts: {
      [FREE_EXACT_CLASS_RULE]: { rule: FREE_EXACT_CLASS_RULE, criteria: 'LEGACY historical free cohort: same year/township/neighborhood pool; exact class; subject excluded; not comparables', selected: freeSelected, excluded: freeExcluded, metrics: metrics(freeSelected.map(p => byPin.get(p)!)) },
      [PAID_NEUTRAL_MATCH_RULE]: { rule: PAID_NEUTRAL_MATCH_RULE, criteria: 'selectNonDirectionalComparables defaults: neighborhood/class/subtype, building area and year-built bands; subject excluded', selected: strictSelected, excluded: strict.rejected.map(r => ({ pin: r.pin, reason: r.reason })), metrics: strictMetrics },
    },
    sharedMetric: {
      version: SHARED_METRIC_VERSION,
      metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT',
      unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT',
      cohortRule: PAID_NEUTRAL_MATCH_RULE,
      stage: 'mailed',
      taxYear: s.taxYear,
      subjectExcluded: true,
      subjectAssessedCentsPerBuildingSqft: subjectParcel.assessedTotalCents / subjectParcel.buildingSqft,
      subjectAssessedTotalCents: subjectParcel.assessedTotalCents,
      comparableMedian: strictMetrics.ASSESSED_USD_CENTS_PER_BUILDING_SQFT,
      sampleAdequacy: 'NOT_QUALIFIED',
      claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS',
    },
    subjectProration: { ...evidence.subjectProration },
    sources: pages.map(p => ({ ...p.receipt, roles: [...p.receipt.roles] })),
    dataEvidenceSha256: evidence.dataEvidenceSha256,
    upstreamAtomicGuarantee: 'NOT_ESTABLISHED',
  }
  const canonical = canonicalJson(snapshot), digest = sha(canonical)
  return { snapshot: deepFreeze(JSON.parse(canonical)), pages, sha256: digest, id: 'acq_' + digest }
}

/** Paid replay: evidence re-parsed from the stored exact pages must rebuild this exact snapshot. */
export async function replayStoredAcquisitionEvidence(stored: StoredAcquisitionSnapshot): Promise<NeutralRawEvidence | null> {
  const replay = await replayNeutralOfficialBytes({ propertyPin: stored.snapshot.subject.pin, pages: stored.pages })
  if (!replay.ok) return null
  const rebuilt = buildAcquisitionSnapshot(replay.evidence)
  return rebuilt && rebuilt.sha256 === stored.sha256 && rebuilt.id === stored.id ? replay.evidence : null
}

function encodePages(snapshot: CanonicalAcquisitionSnapshot, pages: ReadonlyArray<SnapshotPage>): string {
  if (!Array.isArray(snapshot.sources) || snapshot.sources.length !== pages.length || pages.length === 0) throw new Error('SNAPSHOT_PAGES_INVALID')
  pages.forEach((p, i) => { if (sha(p.bytes) !== p.receipt.contentSha256 || canonicalJson(snapshot.sources[i]) !== canonicalJson(p.receipt)) throw new Error('SNAPSHOT_PAGES_INVALID') })
  return canonicalJson(pages.map(p => ({ receipt: p.receipt, bytesBase64: Buffer.from(p.bytes).toString('base64') })))
}
function decode(row: { id: string; sha256: string; canonical: string; pages: string; pages_sha256: string }): StoredAcquisitionSnapshot {
  if (!ID.test(row.id) || row.id !== 'acq_' + row.sha256 || sha(row.canonical) !== row.sha256 || sha(row.pages) !== row.pages_sha256) throw new Error('SNAPSHOT_STORAGE_UNAVAILABLE')
  const snapshot = JSON.parse(row.canonical) as CanonicalAcquisitionSnapshot
  if (canonicalJson(snapshot) !== row.canonical) throw new Error('SNAPSHOT_STORAGE_UNAVAILABLE')
  const pages = (JSON.parse(row.pages) as Array<{ receipt: NeutralSourceReceipt; bytesBase64: string }>).map(p => ({ receipt: p.receipt, bytes: Buffer.from(p.bytesBase64, 'base64') }))
  if (encodePages(snapshot, pages) !== row.pages) throw new Error('SNAPSHOT_STORAGE_UNAVAILABLE')
  return { id: row.id, sha256: row.sha256, snapshot: deepFreeze(snapshot), pages }
}
function rowFor(snapshot: CanonicalAcquisitionSnapshot, pages: ReadonlyArray<SnapshotPage>) {
  const canonical = canonicalJson(snapshot), digest = sha(canonical), encoded = encodePages(snapshot, pages)
  return { id: 'acq_' + digest, sha256: digest, canonical, pages: encoded, pages_sha256: sha(encoded) }
}

/** Process-local store for tests/local preview only; not durable. */
export function createInMemoryAcquisitionSnapshotStore(): AcquisitionSnapshotStore {
  // The admitted lookup applies the same bound as Postgres without scanning the store: a per-PIN candidate list is
  // maintained at persist time and never grows past CAP+1 (that length is the overflow sentinel). Its metadata is read
  // from the serialized row (the bytes decode will see), not from the caller's object. A lookup does one PIN get,
  // examines <= CAP entries, decodes nothing on overflow or ambiguity and one row on a unique match.
  const rows = new Map<string, ReturnType<typeof rowFor>>()
  const byPin = new Map<string, Array<{ readonly id: string; readonly digest: unknown }>>()
  return {
    async persist(snapshot, pages) {
      const row = rowFor(snapshot, pages)
      if (!rows.has(row.id)) {
        rows.set(row.id, row)
        let meta: any; try { meta = JSON.parse(row.canonical) } catch { meta = undefined }
        const pin = meta?.subject?.pin
        if (meta?.schema === ACQUISITION_SNAPSHOT_SCHEMA && typeof pin === 'string') {
          const list = byPin.get(pin) ?? []
          if (list.length <= ADMITTED_SNAPSHOT_CANDIDATE_CAP) list.push(Object.freeze({ id: row.id, digest: meta.dataEvidenceSha256 }))
          byPin.set(pin, list)
        }
      }
      return { id: row.id, sha256: row.sha256 }
    },
    async readPrivileged(id) { if (typeof id !== 'string' || !ID.test(id)) return undefined; const row = rows.get(id); return row ? decode(row) : undefined },
    async readAdmittedPrivileged(pin, dataEvidenceSha256) {
      if (typeof pin !== 'string' || !PIN.test(pin) || typeof dataEvidenceSha256 !== 'string' || !DIGEST.test(dataEvidenceSha256)) return undefined
      const list = byPin.get(pin)
      if (!list) return undefined
      if (list.length > ADMITTED_SNAPSHOT_CANDIDATE_CAP) throw unavailable()
      let match: string | undefined
      for (let i = 0; i < list.length; i++) {
        if (list[i].digest !== dataEvidenceSha256) continue
        if (match !== undefined) throw unavailable()
        match = list[i].id
      }
      if (match === undefined) return undefined
      return admittedMatch([decode(rows.get(match)!)], pin, dataEvidenceSha256)
    },
  }
}

type PgConfig = { writerUrl: string; readerUrl: string; ssl: 'require' | 'disable' }
const WRITER_ROLE = 'ot_factual_app', READER_ROLE = 'ot_paid_snapshot_reader'
function pool(raw: string, role: string, ssl: PgConfig['ssl']): Pool {
  let transport
  try { transport = roleTransport(raw, role, ssl) } catch { throw unavailable() }
  const p = new Pool({ ...transport, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000 })
  p.on('error', () => {})
  return p
}
async function inRole<T>(p: Pool, role: string, readOnly: boolean, fn: (c: PoolClient) => Promise<T>, boundedAdmission = false): Promise<T> {
  let c: PoolClient | undefined
  try {
    c = await p.connect()
    await c.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
    if (boundedAdmission) {
      await c.query("SET LOCAL lock_timeout = '2s'")
      await c.query("SET LOCAL statement_timeout = '3s'")
      await c.query("SET LOCAL idle_in_transaction_session_timeout = '10s'")
    }
    const who = await c.query('SELECT current_user::text AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user AND session_user=current_user')
    if (who.rows.length !== 1 || who.rows[0].u !== role || who.rows[0].rolsuper !== false || who.rows[0].rolbypassrls !== false) throw unavailable()
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch { if (c) await c.query('ROLLBACK').catch(() => {}); throw unavailable() } finally { c?.release() }
}

/** Writer = existing server factual role (INSERT); reader = dedicated paid-server SELECT-only role. */
export function createPostgresAcquisitionSnapshotStore(config: PgConfig): AcquisitionSnapshotStore & { close(): Promise<void> } {
  let writer: Pool | undefined, reader: Pool | undefined
  const w = () => (writer ??= pool(config.writerUrl, WRITER_ROLE, config.ssl)), r = () => (reader ??= pool(config.readerUrl, READER_ROLE, config.ssl))
  return {
    async persist(snapshot, pages) {
      const row = rowFor(snapshot, pages)
      await inRole(w(), WRITER_ROLE, false, c => c.query('INSERT INTO ot_acquisition_snapshot(id,schema,subject_pin,sha256,canonical,pages,pages_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', [row.id, String(snapshot.schema ?? ACQUISITION_SNAPSHOT_SCHEMA), String(snapshot.subject?.pin ?? pages[0].receipt.subjectPin), row.sha256, row.canonical, row.pages, row.pages_sha256]))
      return { id: row.id, sha256: row.sha256 }
    },
    async readPrivileged(id) {
      if (typeof id !== 'string' || !ID.test(id)) return undefined
      const rows = await inRole(r(), READER_ROLE, true, async c => (await c.query('SELECT id,sha256,canonical,pages,pages_sha256 FROM ot_acquisition_snapshot WHERE id=$1', [id])).rows)
      if (!rows.length) return undefined
      try { return decode(rows[0]) } catch { throw unavailable() }
    },
    async readAdmittedPrivileged(pin, dataEvidenceSha256) {
      if (typeof pin !== 'string' || !PIN.test(pin) || typeof dataEvidenceSha256 !== 'string' || !DIGEST.test(dataEvidenceSha256)) return undefined
      // Same SELECT-only paid reader role and bounded timeouts; both stages in one read-only transaction.
      const rows = await inRole(r(), READER_ROLE, true, async c => {
        const found = (await c.query(ADMITTED_SNAPSHOT_CANDIDATES_SQL, [pin, ACQUISITION_SNAPSHOT_SCHEMA, dataEvidenceSha256, ADMITTED_SNAPSHOT_CANDIDATE_CAP + 1])).rows
        if (found.length < 1 || !Number.isSafeInteger(found[0].candidates) || found[0].candidates > ADMITTED_SNAPSHOT_CANDIDATE_CAP) throw unavailable()
        const ids = found.map(f => f.id).filter((id): id is string => typeof id === 'string')
        if (ids.length !== 1) return ids.length === 0 ? [] : Promise.reject(unavailable())
        return (await c.query(ADMITTED_SNAPSHOT_BODY_SQL, [ids[0], pin])).rows
      }, true)
      let decoded: StoredAcquisitionSnapshot[]
      try { decoded = rows.map(decode) } catch { throw unavailable() }
      return admittedMatch(decoded, pin, dataEvidenceSha256)
    },
    async close() { await Promise.all([writer?.end(), reader?.end()].map(p => p?.catch(() => {}))) },
  }
}

/** Role-checked pool/transaction helpers shared with the order snapshot binding. */
export { pool as snapshotRolePool, inRole as inSnapshotRole }

export function createAcquisitionSnapshotStoreFromEnv(): (AcquisitionSnapshotStore & { close(): Promise<void> }) | null {
  const writerUrl = process.env.OT_FACTUAL_DATABASE_URL, readerUrl = process.env.OT_PAID_SNAPSHOT_READER_DATABASE_URL, ssl = process.env.OT_FACTUAL_DATABASE_SSL
  if (!writerUrl || !readerUrl || (ssl !== 'require' && ssl !== 'disable')) return null
  return createPostgresAcquisitionSnapshotStore({ writerUrl, readerUrl, ssl })
}
