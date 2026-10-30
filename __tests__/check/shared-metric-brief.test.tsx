// F4: the free screen-only brief renders the SAVED shared metric verbatim from
// result.acquisitionSnapshot.sharedMetric (no recompute). Paid detail stays separate.
import React from 'react'
import { render, screen } from '@testing-library/react'
import { SharedMetricBrief } from '@/components/check/SharedEvidenceSummary'
import { FactualAcquisitionSnapshotSchema } from '@/lib/evidence/public-factual-contract'

const base = {
  version: 'ot-shared-metric/v1', metric: 'MEDIAN_ASSESSED_PER_BUILDING_SQFT', unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', cohortRule: 'PAID_NEUTRAL_MATCH_V1',
  stage: 'mailed', taxYear: 2026, subjectExcluded: true, subjectAssessedCentsPerBuildingSqft: 4000, subjectAssessedTotalCents: 4_000_000,
  sampleAdequacy: 'NOT_QUALIFIED', claims: 'ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS',
} as const
const computed = { ...base, comparableMedian: { unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'COMPUTED', value: 3000, count: 3, minimumCount: 1 } } as const
const unavailable = { ...base, comparableMedian: { unit: 'ASSESSED_USD_CENTS_PER_BUILDING_SQFT', status: 'NOT_COMPUTABLE', reason: 'EMPTY', count: 0, minimumCount: 1 } } as const
const ref = { id: 'acq_' + 'a'.repeat(64), sha256: 'a'.repeat(64), schema: 'ot-acquisition-snapshot/v1', dataEvidenceSha256: 'b'.repeat(64) }

describe('free brief: saved shared metric', () => {
  it('payload mapping keeps the saved metric unchanged (public contract parse)', () => {
    for (const m of [computed, unavailable]) expect(FactualAcquisitionSnapshotSchema.parse({ ...ref, sharedMetric: m }).sharedMetric).toEqual(m)
  })

  it('COMPUTED: subject and comparable median shown, NOT QUALIFIED, assessed-only; no download/report wording', () => {
    render(<SharedMetricBrief metric={computed as any} />)
    const el = screen.getByTestId('shared-metric-brief')
    expect(el.textContent).toContain('Your assessed value per building sq ft: $40.00')
    expect(el.textContent).toContain('Comparable median (3 properties, you excluded): $30.00')
    expect(el.textContent).toContain('Sample adequacy: NOT QUALIFIED')
    expect(el.textContent).toContain('Assessed values only, not market value or savings')
    expect(el.textContent).not.toMatch(/46\.67|download|PDF/i)
  })

  it('NOT_COMPUTABLE: comparable median unavailable, no dollar median', () => {
    render(<SharedMetricBrief metric={unavailable as any} />)
    const el = screen.getByTestId('shared-metric-brief')
    expect(el.textContent).toContain('Comparable median: unavailable')
    expect(el.textContent).toContain('Your assessed value per building sq ft: $40.00')
    expect(el.textContent).toContain('Sample adequacy: NOT QUALIFIED')
    expect(el.textContent).not.toContain('$30.00')
  })
})
