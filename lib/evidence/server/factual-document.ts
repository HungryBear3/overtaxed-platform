import "server-only"
/**
 * LOCAL paid preview document. Reloads the immutable server result by ID and
 * renders it with the existing T2 PDF renderer. Never accepts a client body.
 * Not live fulfillment: no order, payment or delivery is touched.
 */
import { renderT2ArtifactPdf } from "./free-factual-pdf"
import { formatCents, presentFactualResult } from "@/lib/evidence/evidence-presentation"
import type { FactualResult } from "@/lib/evidence/public-factual-contract"
import type { AnalysisStore } from "./analysis-store"

export const FREE_COHORT_DETAIL_LIMIT = 100

export function buildFactualDocumentText(r: FactualResult, opts: { detail?: "bounded" } = {}): string {
  const p = presentFactualResult(r)
  const cohort = r.records.filter((x) => x.role === "cohort")
  // Only the free report opts in. Default preview text remains unchanged.
  const bounded = opts.detail === "bounded"
  const selected = p.rows.filter((x) => x.role === "Cohort")
    .sort((a, b) => a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0)
    .slice(0, FREE_COHORT_DETAIL_LIMIT)
  const rows = bounded ? [...p.rows.filter((x) => x.role === "Subject"), ...selected] : p.rows
  return [
    p.heading,
    r.dataOrigin === "SYNTHETIC_PREVIEW" ? "SYNTHETIC PREVIEW — local instrumented data, not a Cook County record." : "",
    "",
    `Result: ${p.identity.resultId}`,
    `Snapshot: ${p.identity.snapshotId} (version ${p.identity.snapshotVersion})`,
    `Subject PIN: ${p.identity.pin}  Township: ${p.identity.township}  Tax year: ${p.identity.taxYear}`,
    "",
    "Finding",
    p.findingText,
    "",
    p.windowText,
    "",
    bounded ? "Raw parcel records — bounded detail" : "Raw parcel records",
    ...(bounded ? [
      `Listed: the subject parcel and ${selected.length} of ${cohort.length} cohort parcels. ${cohort.length - selected.length} cohort parcels are not listed.`,
      `Selection rule: first ${FREE_COHORT_DETAIL_LIMIT} cohort parcels in ascending PIN order. These are not a representative sample and are not selected comparables.`,
      "All records remain in the stored result; this PDF is a summary with bounded detail, not a complete record listing.",
      "",
    ] : []),
    ...rows.flatMap((x) => [
      `PIN ${x.pin} | ${x.role} | Class ${x.propertyClass}`,
      `Assessed ${x.assessed} | Land ${x.land} | Building ${x.building}`,
      `Date: ${x.date}`,
      "",
    ]),
    "",
    "Arithmetic",
    `Cohort assessed total: ${formatCents(r.finding.cohortAssessedTotalCents)} across ${cohort.length} parcels`,
    bounded
      ? `Total cents: ${r.finding.cohortAssessedTotalCents} (sum over all ${cohort.length} cohort parcels, including those not listed)`
      : `Total cents: ${cohort.map((x) => x.assessedTotalCents).join(" + ")} = ${r.finding.cohortAssessedTotalCents}`,
    "",
    "Limitations",
    ...p.limitations.map((l) => `- ${l}`),
    "",
    "Sources",
    ...p.sources.map((s) => `- ${s.label}: ${s.url}`),
  ].join("\n")
}

export async function produceFactualPreviewPdf(
  store: AnalysisStore,
  resultId: string,
  opts: {
    generatedAt: string
    clientBody?: unknown
    /** Free report only; preserve complete default preview text. */
    detail?: "bounded"
    /** Optional title/heading/disclaimer override (e.g. the paid factual report). Default output unchanged. */
    presentation?: { title: string; heading: { synthetic: string; county: string }; disclaimer: string }
  },
): Promise<{ bytes: Buffer; text: string; resultId: string }> {
  if (opts.clientBody !== undefined) throw new Error("CLIENT_BODY_REJECTED")
  const r = await store.getResult(resultId)
  if (!r) throw new Error("RESULT_NOT_FOUND")
  const text = buildFactualDocumentText(r, { detail: opts.detail })
  const p = opts.presentation
  const bytes = await renderT2ArtifactPdf(text, opts.generatedAt, {
    title: p?.title ?? "OverTaxed IL - Factual Record Preview",
    heading: r.dataOrigin === "SYNTHETIC_PREVIEW"
      ? p?.heading.synthetic ?? "SYNTHETIC PREVIEW  |  FACTUAL RECORD"
      : p?.heading.county ?? "OVERTAXED IL  |  FACTUAL RECORD",
    disclaimer: p?.disclaimer ?? "Raw records only. Unvalidated. Filing window UNKNOWN.",
    layout: "word-wrap",
  })
  return { bytes, text, resultId: r.resultId }
}
