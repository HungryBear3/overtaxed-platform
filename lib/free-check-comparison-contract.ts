/**
 * What `/api/free-check` publishes about the T2 comparison, and the words every
 * surface renders it in.
 *
 * Client-safe: no server module, no clock, no network. The response reaches two
 * renderers and `sessionStorage`, so the guards here are the trust boundary for
 * browser JSON, and the brief is built once so `/check` and the homepage cannot
 * word the same figures differently.
 */
import type { ComparableRejectionReason } from "@/lib/fulfillment/t2-comparables"

export type FreeCheckSharedMetric = {
  version: "ot-shared-metric/v1"
  metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT"
  unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT"
  cohortRule: "PAID_NEUTRAL_MATCH_V1"
  stage: "mailed"
  taxYear: number
  subjectExcluded: true
  subjectAssessedCentsPerBuildingSqft: number
  subjectAssessedTotalCents: number
  comparableMedian: {
    unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT"
    status: "COMPUTED"
    value: number
    count: number
    minimumCount: number
  }
  sampleAdequacy: "NOT_QUALIFIED"
  claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS"
}

export type FreeCheckComparisonEvidence = {
  selectionRuleId: string
  stage: "mailed"
  taxYear: number
  candidateCount: number
  candidateAcceptedCount: number
  candidateRejectedByReason: Record<ComparableRejectionReason, number>
  candidatePoolSha256: string
  sourceDatasetIds: string[]
  sourceResponseCount: number
  collectorProtections: string[]
  retrievedAt: string
  upstreamAtomicGuarantee: "NOT_ESTABLISHED"
}

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

export function isFreeCheckSharedMetric(value: unknown): value is FreeCheckSharedMetric {
  if (!value || typeof value !== "object") return false
  const metric = value as Record<string, unknown>
  const median = metric.comparableMedian as Record<string, unknown> | null | undefined
  return (
    metric.version === "ot-shared-metric/v1" &&
    metric.metric === "MEDIAN_ASSESSED_PER_BUILDING_SQFT" &&
    metric.unit === "ASSESSED_USD_CENTS_PER_BUILDING_SQFT" &&
    metric.cohortRule === "PAID_NEUTRAL_MATCH_V1" &&
    metric.stage === "mailed" &&
    count(metric.taxYear) &&
    metric.subjectExcluded === true &&
    positive(metric.subjectAssessedCentsPerBuildingSqft) &&
    positive(metric.subjectAssessedTotalCents) &&
    !!median &&
    median.unit === "ASSESSED_USD_CENTS_PER_BUILDING_SQFT" &&
    median.status === "COMPUTED" &&
    positive(median.value) &&
    count(median.count) &&
    count(median.minimumCount) &&
    median.minimumCount >= 3 &&
    median.count >= median.minimumCount &&
    metric.sampleAdequacy === "NOT_QUALIFIED" &&
    metric.claims === "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS"
  )
}

const perSqft = (cents: number) => `$${(cents / 100).toFixed(2)}`
const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`

export type FreeComparisonBrief = {
  subjectTotal: string
  subject: string
  median: string
  adequacy: string
  adequacyGloss: string
}

/** The accepted brief, verbatim, plus the subject's total with its stage and year. */
export function freeComparisonBrief(metric: FreeCheckSharedMetric): FreeComparisonBrief {
  const median = metric.comparableMedian
  return {
    subjectTotal: `Your mailed assessed value, tax year ${metric.taxYear}: ${wholeDollars(metric.subjectAssessedTotalCents)}`,
    subject: `Your assessed value per building sq ft: ${perSqft(metric.subjectAssessedCentsPerBuildingSqft)}`,
    median: `Comparable median (${median.count} properties, you excluded): ${perSqft(median.value)}`,
    adequacy: "Sample adequacy: NOT QUALIFIED. Assessed values only, not market value or savings.",
    adequacyGloss:
      "“NOT QUALIFIED” describes this data sample: whether it is large enough to rely on has not been validated. It does not mean the property or its owner is ineligible for anything.",
  }
}

/**
 * Where the figures came from, or `null` for anything that is not a county read.
 * The preview sample carries no evidence block, so it can never print this line.
 */
export function describeComparisonEvidence(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const evidence = value as Record<string, unknown>
  if (
    !count(evidence.taxYear) ||
    !count(evidence.candidateCount) ||
    !count(evidence.candidateAcceptedCount) ||
    typeof evidence.retrievedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(evidence.retrievedAt)
  ) {
    return null
  }
  return (
    `Mailed values for tax year ${evidence.taxYear}, read from the Cook County Assessor's public datasets ` +
    `on ${evidence.retrievedAt.slice(0, 10)}. ${evidence.candidateAcceptedCount} of ${evidence.candidateCount} ` +
    "parcels in the neighborhood pool met the selection rule. This is a point-in-time read, not a guaranteed snapshot of county data."
  )
}

export const FREE_COMPARISON_SELECTION_LABEL =
  "Every property in your Assessor neighborhood with the same class and residence type, building area within 15% and year built within 10 years of yours. None was ranked or chosen by value."

/** A limit of the check, stated as one. Says nothing about the property. */
export const FREE_COMPARISON_UNAVAILABLE_TEXT =
  "We could not complete the records comparison for this property from the county's published data, so no comparable figures are shown. That is a limit of this check, not a finding about your property."
