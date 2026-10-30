/**
 * The one fixed-template presentation of a decoded FACTUAL_ONLY result, used
 * by both free UIs and the paid preview document. No conclusions.
 */
import { LIMITATION_TEMPLATES, SOURCE_CATALOG, type FactualResult } from "./public-factual-contract"

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function presentFactualResult(r: FactualResult) {
  const synthetic = r.dataOrigin === "SYNTHETIC_PREVIEW"
  return {
    heading: synthetic ? "SYNTHETIC PREVIEW — assessment records on file" : "Assessment records on file",
    identity: { resultId: r.resultId, snapshotId: r.snapshotId, snapshotVersion: r.snapshotVersion, pin: r.subject.pin, township: r.subject.township, taxYear: r.subject.taxYear },
    findingText: `Subject assessed total: ${formatCents(r.finding.subjectAssessedTotalCents)}. Cohort assessed total: ${formatCents(r.finding.cohortAssessedTotalCents)} across ${r.finding.cohortCount} parcels (neighborhood ${r.cohort.neighborhoodCode}, class ${r.cohort.propertyClass}, tax year ${r.subject.taxYear}).`,
    windowText: "Filing window: UNKNOWN — not actionable from this record.",
    rows: r.records.map((x) => ({
      pin: x.pin,
      role: x.role === "subject" ? "Subject" : "Cohort",
      assessed: formatCents(x.assessedTotalCents),
      land: x.landCents === null ? "not stated" : formatCents(x.landCents),
      building: x.buildingCents === null ? "not stated" : formatCents(x.buildingCents),
      propertyClass: x.propertyClass,
      date: x.recordDate ?? "date not stated in source",
    })),
    limitations: r.limitations.map((k) => LIMITATION_TEMPLATES[k]),
    sources: r.sources.map((k) => SOURCE_CATALOG[k]),
  }
}
export type FactualPresentation = ReturnType<typeof presentFactualResult>
