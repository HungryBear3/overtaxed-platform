import "server-only"

import { createHash } from "node:crypto"

import { townshipKeyFromName } from "@/lib/deadlines/township-resolution"
import {
  RULE15_REQUIRED_MINIMUM,
  attachAssessedValues,
  candidatePoolSha256,
  measureUniformity,
  rejectionCountsByReason,
  selectNonDirectionalComparables,
  type ComparableMatchAttributes,
  type ComparableRejectionReason,
} from "@/lib/fulfillment/t2-comparables"
import {
  FREE_EXCLUSION_REASONS,
  classifyFreeParcel,
  type FreeExclusionReason,
} from "@/lib/fulfillment-runtime/free-eligibility"
import {
  SHARED_COLLECTOR_PROTECTIONS,
  readFreePoolRuntime,
  type FreePoolRead,
} from "@/lib/fulfillment-runtime/neutral-raw-gateway"
import { OFFICIAL_TAX_YEAR, chicagoCalendarYear } from "@/lib/fulfillment-runtime/t2-county-gateway"
import type {
  FreeCheckComparisonEvidence,
  FreeCheckSharedMetric,
} from "@/lib/free-check-comparison-contract"

/**
 * The comparison for one parcel, inside one request, for the free check.
 *
 * Read-only over the county's public datasets. Nothing here is written anywhere:
 * no order, no snapshot, no token, no database and no storage. The retained bytes
 * live only as long as this call and never leave it; the caller gets the compact
 * projection below.
 *
 * Selection and arithmetic are the report's own pure functions. Eligibility is
 * not: the report's `parcelJoinRefusal` refuses a pool for any one unusable
 * parcel, and on the county's real rows no neighborhood survives that, because
 * vacant and multi-building parcels are ordinary members of a class-2 pool. Here
 * the whole pool is kept and every parcel in it ends in exactly one disposition:
 * accepted, rejected by the selector, or excluded by `free-eligibility` with a
 * named reason. The subject gets no such allowance. If it cannot be compared,
 * neither can anything else, and any failure of the read refuses outright.
 *
 * It does not establish that a free result and a later report agree. They are
 * separate reads of a county source with no read isolation, so the data can move
 * between them, and `upstreamAtomicGuarantee` says so on every result. A report
 * can also refuse a pool this one compares.
 */

export type FreeComparison = {
  subject: {
    propertyClass: string
    township: string
    neighborhoodCode: string
    taxYear: number
    assessedTotalValue: number
  }
  comparables: Array<{
    pin: string
    address: string
    city: string
    assessedValue: number
    squareFeet: number
    yearBuilt: number
    propertyClass: string
  }>
  sharedMetric: FreeCheckSharedMetric
  comparisonEvidence: FreeCheckComparisonEvidence
  /**
   * One line per parcel in the pool, in PIN order. Server side only: the route
   * publishes its counts and digest, not a list of the neighbors.
   */
  poolDispositions: ReadonlyArray<PoolDisposition>
}

export type PoolDisposition = {
  pin: string
  disposition: "accepted" | ComparableRejectionReason | FreeExclusionReason
}

/** `blocker` is a bounded name for operators. It carries no parcel or address. */
export type FreeComparisonResult =
  | { ok: true; comparison: FreeComparison }
  | { ok: false; blocker: string }

const POOL_DISPOSITIONS_HASH_DOMAIN = "ot-free-pool-dispositions/v1"

function exactCents(dollars: number): number | null {
  const cents = Math.round(dollars * 100)
  return Number.isSafeInteger(cents) && cents > 0 && Math.abs(cents - dollars * 100) < 1e-6 ? cents : null
}

function poolDispositionsSha256(dispositions: ReadonlyArray<PoolDisposition>): string {
  const material = [
    POOL_DISPOSITIONS_HASH_DOMAIN,
    String(dispositions.length),
    ...dispositions.map(({ pin, disposition }) => `${pin}:${disposition}`),
  ].join("\n")
  return createHash("sha256").update(material, "utf8").digest("hex")
}

/**
 * What the pool row can say about a parcel that never reached selection, so the
 * pool digest still binds it. Absent features hash as null, by design of
 * `canonicalCandidateRow`.
 */
function poolRowOnly(row: Record<string, unknown>): ComparableMatchAttributes {
  return {
    pin: String(row.pin),
    neighborhoodCode: String(row.nbhd_code).trim(),
    propertyClass: String(row.class).trim(),
  } as ComparableMatchAttributes
}

function compare(read: FreePoolRead, expectedTownship: string | null): FreeComparisonResult {
  const refuse = (blocker: string): FreeComparisonResult => ({ ok: false, blocker })

  // The report refuses a parcel whose county township is not the one on the
  // order. There is no order here, so the check is against the subject lookup
  // that named the window this result will show.
  if (expectedTownship && townshipKeyFromName(expectedTownship) !== townshipKeyFromName(read.township)) {
    return refuse("SUBJECT_TOWNSHIP_MISMATCH")
  }

  const eligible: ComparableMatchAttributes[] = []
  const hashedPool: ComparableMatchAttributes[] = []
  const values = new Map<string, number>()
  const addresses = new Map<string, { address: string; city: string }>()
  const excluded: PoolDisposition[] = []
  const candidateExcludedByReason = Object.fromEntries(FREE_EXCLUSION_REASONS.map((reason) => [reason, 0])) as Record<
    FreeExclusionReason,
    number
  >

  for (const universe of read.pool) {
    const pin = String(universe.pin)
    const parcel = classifyFreeParcel({
      universe,
      characteristics: read.characteristics.get(pin) ?? [],
      // `readFreePool` refuses a pool PIN missing either row.
      assessed: read.assessed.get(pin)!,
      address: read.addresses.get(pin)!,
    })
    if (parcel.kind === "conflict") return refuse(parcel.blocker)
    if (parcel.kind === "excluded") {
      if (pin === read.subjectPin) return refuse(`FREE_SUBJECT_${parcel.reason.toUpperCase()}`)
      candidateExcludedByReason[parcel.reason] += 1
      excluded.push({ pin, disposition: parcel.reason })
      hashedPool.push(poolRowOnly(universe))
      continue
    }
    eligible.push(parcel.attributes)
    hashedPool.push(parcel.attributes)
    values.set(pin, parcel.assessedValue)
    addresses.set(pin, { address: parcel.address, city: parcel.city })
  }

  const subjectAttributes = eligible.find((row) => row.pin === read.subjectPin)
  const subjectValue = values.get(read.subjectPin)
  const subjectAddress = addresses.get(read.subjectPin)
  if (!subjectAttributes || subjectValue === undefined || !subjectAddress) return refuse("SUBJECT_NOT_IN_POOL")

  const selection = selectNonDirectionalComparables(subjectAttributes, eligible)
  if (!selection) return refuse("MISSING_PROPERTY_CHARACTERISTICS")
  const candidateRejectedByReason = rejectionCountsByReason(selection.rejected)
  const candidateCount = read.pool.length
  if (selection.accepted.length + selection.rejected.length + excluded.length !== candidateCount) {
    return refuse("CANDIDATE_ACCOUNTING_MISMATCH")
  }
  if (selection.accepted.length < RULE15_REQUIRED_MINIMUM) return refuse("INSUFFICIENT_COMPARABLES")

  const { valued, missingValue } = attachAssessedValues(selection.accepted, values)
  if (missingValue.length > 0) return refuse("COMPARABLE_VALUE_INCOMPLETE")

  const measurement = measureUniformity({ buildingSqft: subjectAttributes.buildingSqft, assessedTotalValue: subjectValue }, valued)
  const subjectAssessedTotalCents = exactCents(subjectValue)
  if (!measurement || subjectAssessedTotalCents === null) return refuse("UNIFORMITY_NOT_COMPUTABLE")

  const poolDispositions: PoolDisposition[] = [
    ...selection.accepted.map(({ pin }) => ({ pin, disposition: "accepted" as const })),
    ...selection.rejected.map(({ pin, reason }) => ({ pin, disposition: reason })),
    ...excluded,
  ].sort((a, b) => (a.pin < b.pin ? -1 : a.pin > b.pin ? 1 : 0))
  if (new Set(poolDispositions.map(({ pin }) => pin)).size !== candidateCount) return refuse("CANDIDATE_ACCOUNTING_MISMATCH")

  const { sources } = read
  return {
    ok: true,
    comparison: {
      subject: {
        propertyClass: subjectAttributes.propertyClass,
        township: read.township,
        neighborhoodCode: read.neighborhoodCode,
        taxYear: OFFICIAL_TAX_YEAR,
        assessedTotalValue: subjectValue,
      },
      comparables: valued.map((comparable) => ({
        pin: comparable.pin,
        address: addresses.get(comparable.pin)!.address,
        city: addresses.get(comparable.pin)!.city,
        assessedValue: comparable.assessedTotalValue,
        squareFeet: comparable.buildingSqft,
        yearBuilt: comparable.yearBuilt,
        propertyClass: comparable.propertyClass,
      })),
      sharedMetric: {
        version: "ot-shared-metric/v1",
        metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT",
        unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
        cohortRule: "FREE_ELIGIBLE_POOL_MATCH_V1",
        stage: "mailed",
        taxYear: OFFICIAL_TAX_YEAR,
        subjectExcluded: true,
        subjectAssessedCentsPerBuildingSqft: measurement.subjectAssessedPerSqft * 100,
        subjectAssessedTotalCents,
        comparableMedian: {
          unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
          status: "COMPUTED",
          value: measurement.comparableMedianAssessedPerSqft * 100,
          count: measurement.comparableCount,
          // The report's floor, not the accepted snapshot's 1: below it nothing
          // is shown here either.
          minimumCount: RULE15_REQUIRED_MINIMUM,
        },
        sampleAdequacy: "NOT_QUALIFIED",
        claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS",
      },
      comparisonEvidence: {
        selectionRuleId: selection.ruleId,
        stage: "mailed",
        taxYear: OFFICIAL_TAX_YEAR,
        candidateCount,
        candidateAcceptedCount: selection.accepted.length,
        candidateRejectedByReason,
        candidateExcludedCount: excluded.length,
        candidateExcludedByReason,
        candidatePoolSha256: candidatePoolSha256(hashedPool),
        poolDispositionsSha256: poolDispositionsSha256(poolDispositions),
        sourceDatasetIds: [...new Set(sources.map((source) => source.datasetId))].sort(),
        sourceResponseCount: sources.length,
        collectorProtections: [...SHARED_COLLECTOR_PROTECTIONS],
        retrievedAt: sources.map((source) => source.retrievedAt).sort()[sources.length - 1],
        upstreamAtomicGuarantee: "NOT_ESTABLISHED",
      },
      poolDispositions,
    },
  }
}

/** Never throws. Any failure is a refusal, and a refusal means no comparison. */
export async function readFreeComparison(input: {
  propertyPin: string
  expectedTownship: string | null
  deadline: number
}): Promise<FreeComparisonResult> {
  // The report cross-checks the pinned tax year against the clock. A rollover
  // refuses here too, rather than reading a year nobody validated.
  if (chicagoCalendarYear(new Date()) !== OFFICIAL_TAX_YEAR) return { ok: false, blocker: "COUNTY_TAX_YEAR_UNVERIFIED" }
  try {
    const read = await readFreePoolRuntime({ propertyPin: input.propertyPin, deadline: input.deadline })
    return read.ok ? compare(read.read, input.expectedTownship) : { ok: false, blocker: read.blocker }
  } catch {
    return { ok: false, blocker: "FREE_COMPARISON_FAILED" }
  }
}
