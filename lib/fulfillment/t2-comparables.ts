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

import { createHash } from "node:crypto";

/**
 * The preregistered rule. The identifier is carried into the artifact manifest
 * so a later reader can bind an artifact to the exact selection rule that
 * produced it.
 */
export const NON_DIRECTIONAL_RULE_ID =
  "R1-same-neighborhood-class-subtype-sqft25-yrblt15-median-v1";

export const SQFT_TOLERANCE = 0.25;
export const YEAR_BUILT_TOLERANCE = 15;

/**
 * Cook County Assessor Rule 15: "At least 3 comparable properties must be
 * provided; however, at least 5 comparable properties are recommended."
 *
 * Three is a hard floor no signed policy may go below. Five is the county's own
 * recommendation, recorded in the artifact manifest so a reader can see whether
 * a given packet met it, but not enforced above an owner-signed OD-2 value.
 */
export const RULE15_REQUIRED_MINIMUM = 3;
export const RULE15_RECOMMENDED_MINIMUM = 5;

/** Everything selection is allowed to see. Assessed value is deliberately absent. */
export type ComparableMatchAttributes = {
  pin: string;
  neighborhoodCode: string;
  propertyClass: string;
  residentialSubtype: string;
  buildingSqft: number;
  yearBuilt: number;
};

export type SubjectMatchAttributes = ComparableMatchAttributes;

/**
 * The bounded vocabulary of reasons a candidate row can be rejected. Closed and
 * ordered, so a manifest can carry an exhaustive, zero-filled count per reason.
 */
export const COMPARABLE_REJECTION_REASONS = [
  "same_parcel_as_subject",
  "different_neighborhood",
  "different_class",
  "different_subtype",
  "building_sqft_out_of_band",
  "year_built_out_of_band",
  "missing_or_invalid_attributes",
  "duplicate_pin",
  "conflicting_duplicate_rows",
] as const;

export type ComparableRejectionReason =
  (typeof COMPARABLE_REJECTION_REASONS)[number];

export type ComparableRejection = {
  pin: string;
  reason: ComparableRejectionReason;
};

/**
 * Domain separator for the candidate-pool digest. Bumping it changes every
 * pool hash, so it is part of the manifest and part of the producer version.
 */
export const CANDIDATE_POOL_HASH_DOMAIN = "ot-t2-candidate-pool/v1";

const CANDIDATE_ROW_KEYS = [
  "pin",
  "neighborhoodCode",
  "propertyClass",
  "residentialSubtype",
  "buildingSqft",
  "yearBuilt",
] as const;

/**
 * Canonical JSON for one candidate row exactly as it was handed to selection:
 * fixed key order, every field relevant to eligibility and deduplication, and
 * no coercion beyond what JSON itself does (a non-finite number becomes null,
 * an absent field becomes null). Rows are hashed as received, invalid ones
 * included, because the point is to bind what selection SAW, not what it kept.
 */
export function canonicalCandidateRow(row: ComparableMatchAttributes): string {
  const record = (row ?? {}) as Record<string, unknown>;
  return `{${CANDIDATE_ROW_KEYS.map(
    (key) => `${JSON.stringify(key)}:${JSON.stringify(record[key] ?? null)}`,
  ).join(",")}}`;
}

/**
 * Domain-separated SHA-256 over the complete candidate pool.
 *
 * Every row is canonicalised, the rows are sorted by their canonical bytes (so
 * the digest is independent of source ordering), the row count is bound in, and
 * the whole is prefixed with [[CANDIDATE_POOL_HASH_DOMAIN]]. Two pools that
 * differ by a single row — for instance a whole neighbourhood versus the same
 * neighbourhood with its higher-valued parcels removed — have different
 * digests, which is what lets a later reader tell them apart.
 */
export function candidatePoolSha256(
  candidates: ReadonlyArray<ComparableMatchAttributes>,
): string {
  const rows = candidates
    .map(canonicalCandidateRow)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const material = [
    CANDIDATE_POOL_HASH_DOMAIN,
    String(rows.length),
    ...rows,
  ].join("\n");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** Exhaustive, zero-filled count of rejections by bounded reason, in vocabulary order. */
export function rejectionCountsByReason(
  rejected: ReadonlyArray<ComparableRejection>,
): Record<ComparableRejectionReason, number> {
  const counts = Object.fromEntries(
    COMPARABLE_REJECTION_REASONS.map((reason) => [reason, 0]),
  ) as Record<ComparableRejectionReason, number>;
  for (const rejection of rejected) counts[rejection.reason] += 1;
  return counts;
}

export type ComparableSelection = {
  ruleId: string;
  accepted: ComparableMatchAttributes[];
  rejected: ComparableRejection[];
  sqftBand: { min: number; max: number };
  yearBuiltBand: { min: number; max: number };
};

function validAttributes(
  value: ComparableMatchAttributes | null | undefined,
): boolean {
  if (!value) return false;
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
  );
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
  if (!validAttributes(subject)) return null;
  const sqftTolerance = options.sqftTolerance ?? SQFT_TOLERANCE;
  const yearTolerance = options.yearBuiltTolerance ?? YEAR_BUILT_TOLERANCE;
  const sqftBand = {
    min: subject.buildingSqft * (1 - sqftTolerance),
    max: subject.buildingSqft * (1 + sqftTolerance),
  };
  const yearBuiltBand = {
    min: subject.yearBuilt - yearTolerance,
    max: subject.yearBuilt + yearTolerance,
  };

  const accepted: ComparableMatchAttributes[] = [];
  const rejected: ComparableRejection[] = [];

  // Resolve duplicate PINs BEFORE any attribute filtering, and resolve them by
  // content rather than by arrival order.
  //
  // An earlier version marked a PIN as seen as soon as it was encountered, so a
  // row rejected for a wrong neighbourhood still consumed the PIN and a later
  // good row for the same parcel was dropped as a duplicate. That made the
  // accepted set depend on the order the source returned rows in — a
  // determinism hole in the one module whose contract is determinism. A county
  // feed returning a stale row and a current row for one PIN in either order
  // would produce two different comparable sets, two different medians, and
  // potentially two different eligibility outcomes for the same order.
  //
  // Identical repeats collapse to one. Rows that disagree about the same parcel
  // are a contradiction in the source, so that PIN is dropped entirely and
  // reported: choosing between them would be choosing which record to believe.
  //
  // Accounting is per ROW, not per PIN (independent re-review of e5383bbc,
  // M1). A group of n identical rows yields one surviving row and n-1
  // `duplicate_pin` rejections; a group of n contradictory rows yields n
  // `conflicting_duplicate_rows` rejections and no survivor. Every raw
  // candidate row therefore lands in exactly one partition — accepted, or one
  // rejection reason — and `accepted + rejected === candidates.length` holds
  // by construction. The packet body states that identity to the reader, so
  // it has to be arithmetically true for every duplicate shape, and
  // `buildT2ArtifactContent` refuses rather than render if it ever is not.
  const byPin = new Map<string, ComparableMatchAttributes[]>();
  const invalid: ComparableMatchAttributes[] = [];
  for (const candidate of candidates) {
    if (!validAttributes(candidate)) {
      invalid.push(candidate);
      continue;
    }
    const rows = byPin.get(candidate.pin);
    if (rows) rows.push(candidate);
    else byPin.set(candidate.pin, [candidate]);
  }
  for (const candidate of invalid) {
    rejected.push({
      pin: typeof candidate?.pin === "string" ? candidate.pin : "",
      reason: "missing_or_invalid_attributes",
    });
  }

  const identity = (c: ComparableMatchAttributes) =>
    [
      c.neighborhoodCode,
      c.propertyClass,
      c.residentialSubtype,
      c.buildingSqft,
      c.yearBuilt,
    ].join("|");

  const deduped: ComparableMatchAttributes[] = [];
  for (const [pin, rows] of byPin) {
    if (rows.length > 1) {
      const distinct = new Set(rows.map(identity));
      if (distinct.size > 1) {
        // Contradictory group: every row is rejected, none survives.
        for (let i = 0; i < rows.length; i += 1) {
          rejected.push({ pin, reason: "conflicting_duplicate_rows" });
        }
        continue;
      }
      // Identical group: one row survives, each extra row is a duplicate.
      for (let i = 1; i < rows.length; i += 1) {
        rejected.push({ pin, reason: "duplicate_pin" });
      }
    }
    deduped.push(rows[0]);
  }

  for (const candidate of deduped) {
    if (candidate.pin === subject.pin) {
      rejected.push({ pin: candidate.pin, reason: "same_parcel_as_subject" });
      continue;
    }
    if (candidate.neighborhoodCode !== subject.neighborhoodCode) {
      rejected.push({ pin: candidate.pin, reason: "different_neighborhood" });
      continue;
    }
    if (candidate.propertyClass !== subject.propertyClass) {
      rejected.push({ pin: candidate.pin, reason: "different_class" });
      continue;
    }
    if (candidate.residentialSubtype !== subject.residentialSubtype) {
      rejected.push({ pin: candidate.pin, reason: "different_subtype" });
      continue;
    }
    if (
      candidate.buildingSqft < sqftBand.min ||
      candidate.buildingSqft > sqftBand.max
    ) {
      rejected.push({
        pin: candidate.pin,
        reason: "building_sqft_out_of_band",
      });
      continue;
    }
    if (
      candidate.yearBuilt < yearBuiltBand.min ||
      candidate.yearBuilt > yearBuiltBand.max
    ) {
      rejected.push({ pin: candidate.pin, reason: "year_built_out_of_band" });
      continue;
    }
    accepted.push(candidate);
  }

  accepted.sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0));
  // Several rejections may now share a PIN, so order by PIN and then by
  // reason: the list must not depend on the order the source returned rows in.
  rejected.sort((a, b) =>
    a.pin < b.pin
      ? -1
      : a.pin > b.pin
        ? 1
        : a.reason < b.reason
          ? -1
          : a.reason > b.reason
            ? 1
            : 0,
  );
  return {
    ruleId: NON_DIRECTIONAL_RULE_ID,
    accepted,
    rejected,
    sqftBand,
    yearBuiltBand,
  };
}

export type ValuedComparable = ComparableMatchAttributes & {
  assessedTotalValue: number;
  assessedPerSqft: number;
};

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
  const valued: ValuedComparable[] = [];
  const missingValue: string[] = [];
  for (const comparable of accepted) {
    const value = valueByPin.get(comparable.pin);
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      missingValue.push(comparable.pin);
      continue;
    }
    valued.push({
      ...comparable,
      assessedTotalValue: value,
      assessedPerSqft: value / comparable.buildingSqft,
    });
  }
  return { valued, missingValue };
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type UniformityMeasurement = {
  subjectAssessedPerSqft: number;
  comparableMedianAssessedPerSqft: number;
  relativeGap: number;
  comparableCount: number;
};

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
    return null;
  }
  if (valued.length === 0) return null;
  const comparableMedian = median(valued.map((c) => c.assessedPerSqft));
  if (
    comparableMedian === null ||
    !Number.isFinite(comparableMedian) ||
    comparableMedian <= 0
  ) {
    return null;
  }
  const subjectPerSqft = subject.assessedTotalValue / subject.buildingSqft;
  return {
    subjectAssessedPerSqft: subjectPerSqft,
    comparableMedianAssessedPerSqft: comparableMedian,
    relativeGap: (subjectPerSqft - comparableMedian) / comparableMedian,
    comparableCount: valued.length,
  };
}
