import { FactualAcquisitionSnapshotSchema } from '@/lib/evidence/public-factual-contract'

const ref = () => ({
  id: 'acqsnap_' + 'a'.repeat(24),
  sha256: 'b'.repeat(64),
  schema: 'ot-acquisition-snapshot/v1',
  dataEvidenceSha256: 'c'.repeat(64),
  sharedMetric: {
    version: 'ot-shared-metric/v1',
    metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT',
    unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT',
    cohortRule: 'PAID_NEUTRAL_MATCH_V1',
    stage: 'mailed',
    taxYear: 2026,
    subjectExcluded: true,
    subjectAssessedCentsPerBuildingSqft: 2000,
    subjectAssessedTotalCents: 4_000_000,
    comparableMedian: { unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'COMPUTED', value: 2500, count: 2, minimumCount: 1 },
    sampleAdequacy: 'NOT_QUALIFIED',
    claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS',
  },
})

describe('factual result canonical acquisition reference (closed contract)', () => {
  it('accepts a strict canonical reference with the owner-selected per-sqft metric', () => {
    expect(FactualAcquisitionSnapshotSchema.safeParse(ref()).success).toBe(true)
  })
  it('requires explicit NOT_QUALIFIED sample adequacy (no implied sufficiency)', () => {
    const r: any = ref(); delete r.sharedMetric.sampleAdequacy
    expect(FactualAcquisitionSnapshotSchema.safeParse(r).success).toBe(false)
    r.sharedMetric.sampleAdequacy = 'QUALIFIED'
    expect(FactualAcquisitionSnapshotSchema.safeParse(r).success).toBe(false)
  })
  it('rejects the legacy free exact-class cohort or a total-assessed unit as the shared metric', () => {
    const a: any = ref(); a.sharedMetric.cohortRule = 'FREE_EXACT_CLASS_V1'
    expect(FactualAcquisitionSnapshotSchema.safeParse(a).success).toBe(false)
    const b: any = ref(); b.sharedMetric.comparableMedian.unit = 'ASSESSED_TOTAL_USD_CENTS'
    expect(FactualAcquisitionSnapshotSchema.safeParse(b).success).toBe(false)
  })
  it('rejects unknown keys and malformed hashes', () => {
    expect(FactualAcquisitionSnapshotSchema.safeParse({ ...ref(), extra: 1 }).success).toBe(false)
    expect(FactualAcquisitionSnapshotSchema.safeParse({ ...ref(), sha256: 'x' }).success).toBe(false)
  })
})
