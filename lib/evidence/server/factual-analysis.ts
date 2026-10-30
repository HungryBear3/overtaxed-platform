import "server-only"
/**
 * Typed acquisition adapter contract and the one server analysis per snapshot.
 *
 * County facts require server-issued immutable captures. Upstream atomicity is
 * explicitly not established; this local successor is not deployed/paid-qualified.
 */
import {
  FactualResultSchema,
  FACTUAL_SCHEMA_VERSION,
  type FactualResult,
  type LimitationKey,
  type SourceKey,
} from "@/lib/evidence/public-factual-contract"
import type { AnalysisStore } from "./analysis-store"
import { currentOfficialWindow } from "./official-window"
import { createCountyFactualAdapter, isCollectedCountyAcquisition, countyCaptureFor } from './county-factual-acquisition'

export type AcquisitionRequest = { pin?: string; address?: string; city?: string; selectedPin?: string; unit?: string; crossStreet?: string; taxYear?: string }
export type AcquisitionHold = "ACQUISITION_UNSUPPORTED" | "ACQUISITION_REJECTED" | "STORAGE_UNAVAILABLE"
export type Acquisition =
  | {
      ok: true
      origin: "SYNTHETIC_PREVIEW" | "COUNTY_RECORD"
      atomic: boolean
      countyCapture?: FactualResult['countyCapture']
      /** Server-issued canonical snapshot reference; only on collector-issued county acquisitions. */
      acquisitionSnapshot?: FactualResult['acquisitionSnapshot']
      sources: SourceKey[]
      subject: { pin: string; township: string; taxYear: number }
      cohort: { neighborhoodCode: string; propertyClass: string }
      parcels: Array<{
        pin: string
        role: "subject" | "cohort"
        taxYear: number
        assessedTotalCents: number
        landCents: number | null
        buildingCents: number | null
        propertyClass: string
        township: string
        neighborhoodCode: string
        sourceId: SourceKey
        parcelSourceId: "ccao_parcel_universe"
        recordDate: string | null
      }>
    }
  | { ok: false; hold: AcquisitionHold }

export interface FactualAcquisitionAdapter {
  readonly id: string
  readonly addressSource?: import("./address-resolution").AddressRecordSource
  acquire(req: AcquisitionRequest): Promise<Acquisition>
}

/** Historical export name retained for route compatibility; local code only. */
export const cookCountyUnsupportedAdapter: FactualAcquisitionAdapter = createCountyFactualAdapter()

export async function analyzeAcquisition(
  store: AnalysisStore,
  acq: Acquisition,
): Promise<{ ok: true; result: FactualResult } | { ok: false; hold: AcquisitionHold }> {
  if (!acq.ok) return acq
  // A caller-supplied flag/hash is not authority: county data must be the exact
  // frozen object issued by the server collector, not a JSON reconstruction.
  if (acq.origin === "COUNTY_RECORD" && !isCollectedCountyAcquisition(acq)) return { ok: false, hold: "ACQUISITION_UNSUPPORTED" }
  if ((acq.origin === 'SYNTHETIC_PREVIEW' && acq.atomic !== true) || acq.sources.length === 0) return { ok: false, hold: "ACQUISITION_REJECTED" }
  const subject = acq.parcels.filter((p) => p.role === "subject")
  const cohort = acq.parcels.filter((p) => p.role === "cohort")
  const limitations: LimitationKey[] = ["unvalidated", "window_unknown", "cohort_not_comparables"]
  if (acq.parcels.some((p) => p.recordDate === null)) limitations.push("date_unknown")
  if (acq.origin === "SYNTHETIC_PREVIEW") limitations.push("synthetic_preview")
  if (acq.origin === 'COUNTY_RECORD') limitations.push('upstream_not_atomic','provisional_current_year',acq.acquisitionSnapshot ? 'area_snapshot_metric_only' : 'area_unknown')
  const candidate = {
    schema: FACTUAL_SCHEMA_VERSION,
    kind: "FACTUAL_ONLY",
    validation: "UNVALIDATED",
    dataOrigin: acq.origin,
    ...(acq.countyCapture ? {countyCapture:acq.countyCapture} : {}),
    ...(acq.acquisitionSnapshot ? {acquisitionSnapshot:acq.acquisitionSnapshot} : {}),
    resultId: store.newId("res"),
    snapshotId: store.newId("snap"),
    snapshotVersion: 0,
    subject: { ...acq.subject },
    cohort: { ...acq.cohort, count: cohort.length },
    records: acq.parcels.map((p) => ({ ...p })),
    finding: {
      template: "raw_assessment_record_v1",
      subjectAssessedTotalCents: subject[0]?.assessedTotalCents ?? -1,
      cohortAssessedTotalCents: cohort.reduce((a, p) => a + p.assessedTotalCents, 0),
      cohortCount: cohort.length,
    },
    window: { ...currentOfficialWindow() },
    limitations,
    sources: [...acq.sources],
  }
  // Validate before consuming a snapshot version, so rejected acquisitions leave no trace.
  const probe = FactualResultSchema.safeParse({ ...candidate, snapshotVersion: 1 })
  if (!probe.success) return { ok: false, hold: "ACQUISITION_REJECTED" }
  try {
    return { ok: true, result: await store.persistResult(probe.data, countyCaptureFor(acq)) }
  } catch { return { ok: false, hold: "STORAGE_UNAVAILABLE" } }
}
