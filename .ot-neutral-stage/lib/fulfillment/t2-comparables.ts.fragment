/**
 * Non-directional comparable selection and the uniformity metric.
 *
 * PURE: no database, no provider, no network, no clock, no randomness.
 *
 * Two defects on `main` are structurally excluded here rather than merely
 * avoided by convention.
 *
 * 1. The degenerate metric. `lib/cook-county/api.ts` derives a subject market
 *    value as `assessedTotalValue * 10` and a comparable market value as
 *    `assessedTotal * 10`, so the free check's "assessment level" is exactly
 *    10.0 on both sides and its relative gap is identically zero for every
 *    parcel in Cook County. The 1,200-PIN public-data study confirmed that
 *    empirically on 857 subjects. The metric here is assessed value per
 *    building square foot against the median of the same quantity over the
 *    comparable set, which the same study showed is non-degenerate.
 *
 * 2. The cherry-pick. `getComparableEquity` sorts candidates ascending by
 *    assessed dollars per square foot and takes the lowest. Cook County
 *    Assessor Rule 15 tells filers to "refrain from 'cherry picking' only those
 *    comparable properties which are lower in value than the subject property",
 *    and the study measured what that selector does: at a 15% threshold it
 *    would call 88.5% of all Cook County class-2 homes supportive, against 8.6%
 *    for a non-directional rule.
 *
 * The structural guarantee against (2): [[selectNonDirectionalComparables]]
 * accepts candidates described ONLY by their matching attributes. Assessed
 * value is not a field of [[ComparableMatchAttributes]], so selection cannot
 * read it, and no future edit can quietly make it read it without changing the
 * type. Values are attached afterwards by [[attachAssessedValues]]. A test
 * proves that permuting every assessed value across the candidate pool leaves
 * the accepted set byte-identical.
 */

/**
 * The preregistered rule. The identifier is carried into the artifact manifest
 * so a later reader can bind an artifact to the exact selection rule that
 * produced it.
 */
export const NON_DIRECTIONAL_RULE_ID =
  "R1-same-neighborhood-class-subtype-sqft25-yrblt15-median-v1"

export const SQFT_TOLERANCE = 0.25
export const YEAR_BUILT_TOLERANCE = 15

/**
 * Cook County Assessor Rule 15: "At least 3 comparable properties must be
 * provided; however, at least 5 comparable properties are recommended."
 *
 * Three is a hard floor no signed policy may go below. Five is the county's own
 * recommendation, recorded in the artifact manifest so a reader can see whether
 * a given packet met it, but not enforced above an owner-signed OD-2 value.
 */
export const RULE15_REQUIRED_MINIMUM = 3
export const RULE15_RECOMMENDED_MINIMUM = 5

/** Everything selection is allowed to see. Assessed value is deliberately absent. */
export type ComparableMatchAttributes = {
  pin: string
  neighborhoodCode: string
  propertyClass: string
  residentialSubtype: string
  buildingSqft: number
  yearBuilt: number
}

export type SubjectMatchAttributes = ComparableMatchAttributes

export type ComparableRejection = {
  pin: string
  reason:
    | "same_parcel_as_subject"
    | "different_neighborhood"
    | "different_class"
    | "different_subtype"
    | "building_sqft_out_of_band"
    | "year_built_out_of_band"
    | "missing_or_invalid_attributes"
    | "duplicate_pin"
}

export type ComparableSelection = {
  ruleId: string
  accepted: ComparableMatchAttributes[]
  rejected: ComparableRejection[]
  sqftBand: { min: number; max: number }
  yearBuiltBand: { min: number; max: number }
}

function validAttributes(value: ComparableMatchAttributes | null | undefined): boolean {
  if (!value) return false
  return (
    typeof value.pin === "string" &&
    /^\d{14}$/.test(value.pin) &&
    typeof value.neighborhoodCode === "string" &&
    value.neighborhoodCode.trim().length > 0 &&
    typeof value.propertyClass === "string" &&
    value.propertyClass.trim().length > 0 &&
    typeof value.residentialSubtype === "string" &&
    value.residentialSubtype.trim().length > 0 &&
    Number.isFinite(value.buildingSqft) &&
    value.buildingSqft > 0 &&
    Number.isFinite(value.yearBuilt) &&
    value.yearBuilt > 1700
  )
}

/**
 * Select comparables by locality, classification and physical similarity only.
 *
 * Every qualifying candidate is accepted — there is no ranking and no "top k",
 * because a ranking needs a direction and the only directions available here
 * are the ones Rule 15 forbids. The output order is by ascending PIN so the
 * artifact bytes are deterministic.
 */
export function selectNonDirectionalComparables(
  subject: SubjectMatchAttributes,
  candidates: ReadonlyArray<ComparableMatchAttributes>,
  options: { sqftTolerance?: number; yearBuiltTolerance?: number } = {},
): ComparableSelection | null {
  if (!validAttributes(subject)) return null
  const sqftTolerance = options.sqftTolerance ?? SQFT_TOLERANCE
  const yearTolerance = options.yearBuiltTolerance ?? YEAR_BUILT_TOLERANCE
  const sqftBand = {
    min: subject.buildingSqft * (1 - sqftTolerance),
    max: subject.buildingSqft * (1 + sqftTolerance),
  }
  const yearBuiltBand = {
    min: subject.yearBuilt - yearTolerance,
    max: subject.yearBuilt + yearTolerance,
  }

  const accepted: ComparableMatchAttributes[] = []
  const rejected: ComparableRejection[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (!validAttributes(candidate)) {
      rejected.push({
        pin: typeof candidate?.pin === "string" ? candidate.pin : "",
        reason: "missing_or_invalid_attributes",
      })
      continue
    }
    if (candidate.pin === subject.pin) {
      rejected.push({ pin: candidate.pin, reason: "same_parcel_as_subject" })
      continue
    }
    if (seen.has(candidate.pin)) {
      rejected.push({ pin: candidate.pin, reason: "duplicate_pin" })
      continue
    }
    seen.add(candidate.pin)
    if (candidate.neighborhoodCode !== subject.neighborhoodCode) {
      rejected.push({ pin: candidate.pin, reason: "different_neighborhood" })
      continue
    }
    if (candidate.propertyClass !== subject.propertyClass) {
      rejected.push({ pin: candidate.pin, reason: "different_class" })
      continue
    }
    if (candidate.residentialSubtype !== subject.residentialSubtype) {
      rejected.push({ pin: candidate.pin, reason: "different_subtype" })
      continue
    }
    if (candidate.buildingSqft < sqftBand.min || candidate.buildingSqft > sqftBand.max) {
      rejected.push({ pin: candidate.pin, reason: "building_sqft_out_of_band" })
      continue
    }
    if (candidate.yearBuilt < yearBuiltBand.min || candidate.yearBuilt > yearBuiltBand.max) {
      rejected.push({ pin: candidate.pin, reason: "year_built_out_of_band" })
      continue
    }
    accepted.push(candidate)
  }

  accepted.sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0))
  rejected.sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0))
  return { ruleId: NON_DIRECTIONAL_RULE_ID, accepted, rejected, sqftBand, yearBuiltBand }
}

export type ValuedComparable = ComparableMatchAttributes & {
  assessedTotalValue: number
  assessedPerSqft: number
}

/**
 * Attach assessed values to an already-selected set.
 *
 * Runs after selection, never before. A comparable whose value is missing or
 * non-positive is dropped here and reported, because a median computed over a
 * set that silently lost members is not the median of the set the packet lists.
 */
export function attachAssessedValues(
  accepted: ReadonlyArray<ComparableMatchAttributes>,
  valueByPin: ReadonlyMap<string, number>,
): { valued: ValuedComparable[]; missingValue: string[] } {
  const valued: ValuedComparable[] = []
  const missingValue: string[] = []
  for (const comparable of accepted) {
    const value = valueByPin.get(comparable.pin)
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      missingValue.push(comparable.pin)
      continue
    }
    valued.push({
      ...comparable,
      assessedTotalValue: value,
      assessedPerSqft: value / comparable.buildingSqft,
    })
  }
  return { valued, missingValue }
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export type UniformityMeasurement = {
  subjectAssessedPerSqft: number
  comparableMedianAssessedPerSqft: number
  relativeGap: number
  comparableCount: number
}

/**
 * The uniformity comparison, stated as arithmetic over published assessed
 * values and published building areas.
 *
 * This is a description of the public record. It is not a savings estimate, a
 * probability, a grade, or an opinion about whether an appeal should be filed.
 */
export function measureUniformity(
  subject: { buildingSqft: number; assessedTotalValue: number },
  valued: ReadonlyArray<ValuedComparable>,
): UniformityMeasurement | null {
  if (
    !Number.isFinite(subject.buildingSqft) ||
    subject.buildingSqft <= 0 ||
    !Number.isFinite(subject.assessedTotalValue) ||
    subject.assessedTotalValue <= 0
  ) {
    return null
  }
  if (valued.length === 0) return null
  const comparableMedian = median(valued.map((c) => c.assessedPerSqft))
  if (comparableMedian === null || !Number.isFinite(comparableMedian) || comparableMedian <= 0) {
    return null
  }
  const subjectPerSqft = subject.assessedTotalValue / subject.buildingSqft
  return {
    subjectAssessedPerSqft: subjectPerSqft,
    comparableMedianAssessedPerSqft: comparableMedian,
    relativeGap: (subjectPerSqft - comparableMedian) / comparableMedian,
    comparableCount: valued.length,
  }
}
