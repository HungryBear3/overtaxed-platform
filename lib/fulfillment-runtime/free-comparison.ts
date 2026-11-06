import "server-only"

import { townshipKeyFromName } from "@/lib/deadlines/township-resolution"
import {
  RULE15_REQUIRED_MINIMUM,
  attachAssessedValues,
  candidatePoolSha256,
  measureUniformity,
  rejectionCountsByReason,
  selectNonDirectionalComparables,
} from "@/lib/fulfillment/t2-comparables"
import {
  SHARED_COLLECTOR_PROTECTIONS,
  readNeutralOfficialBytesRuntime,
  type NeutralRawEvidence,
} from "@/lib/fulfillment-runtime/neutral-raw-gateway"
import {
  COUNTY_DATASETS,
  OFFICIAL_TAX_YEAR,
  chicagoCalendarYear,
  parcelJoinRefusal,
  type LocalityKeys,
} from "@/lib/fulfillment-runtime/t2-county-gateway"
import type {
  FreeCheckComparisonEvidence,
  FreeCheckSharedMetric,
} from "@/lib/free-check-comparison-contract"

/**
 * The T2 comparison for one parcel, inside one request, for the free check.
 *
 * Read-only over the county's public datasets. Nothing here is written anywhere:
 * no order, no snapshot, no token, no database and no storage. The retained bytes
 * live only as long as this call and never leave it; the caller gets the compact
 * projection below.
 *
 * Selection and arithmetic are the report's own pure functions, and every row
 * rule is the report's own `parcelJoinRefusal`. There is no looser mode: where the
 * report would refuse, this refuses, and the caller shows no comparison at all.
 * That is why the gateway's stricter opt-in protections are requested and why a
 * parcel that fails any rule refuses the whole pool rather than dropping out.
 *
 * It does not establish that a free result and a later report agree. They are
 * separate reads of a county source with no read isolation, so the data can move
 * between them, and `upstreamAtomicGuarantee` says so on every result.
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
}

/** `blocker` is a bounded name for operators. It carries no parcel or address. */
export type FreeComparisonResult =
  | { ok: true; comparison: FreeComparison }
  | { ok: false; blocker: string }

type Row = Record<string, unknown>

function exactCents(dollars: number): number | null {
  const cents = Math.round(dollars * 100)
  return Number.isSafeInteger(cents) && cents > 0 && Math.abs(cents - dollars * 100) < 1e-6 ? cents : null
}

/**
 * Rows as the county published them, re-parsed from the retained bytes. The
 * gateway keeps only its normalized fields, and the report's rules read the
 * markers it never normalized: landlines, multi-land, tieback and proration.
 */
function publishedRows(evidence: NeutralRawEvidence, datasetId: string): Map<string, Row[]> {
  const byPin = new Map<string, Row[]>()
  for (const page of evidence.exactPages) {
    if (page.receipt.datasetId !== datasetId || !page.receipt.url.includes("/resource/")) continue
    for (const row of JSON.parse(page.bytes.toString("utf8")) as Row[]) {
      if (typeof row.pin !== "string") continue
      byPin.set(row.pin, [...(byPin.get(row.pin) ?? []), row])
    }
  }
  return byPin
}

function compare(evidence: NeutralRawEvidence, expectedTownship: string | null): FreeComparisonResult {
  const refuse = (blocker: string): FreeComparisonResult => ({ ok: false, blocker })
  const { subject, candidatePool, assessedValues, addresses } = evidence

  const collected = evidence.collectorProtections ?? []
  if (SHARED_COLLECTOR_PROTECTIONS.some((protection) => !collected.includes(protection))) {
    return refuse("FREE_COMPARISON_UNPROTECTED_READ")
  }

  // The report refuses a parcel whose county township is not the one on the
  // order. There is no order here, so the check is against the subject lookup
  // that named the window this result will show.
  if (expectedTownship && townshipKeyFromName(expectedTownship) !== townshipKeyFromName(subject.township)) {
    return refuse("SUBJECT_TOWNSHIP_MISMATCH")
  }

  const townshipCode = publishedRows(evidence, COUNTY_DATASETS.parcelUniverse.id).get(subject.pin)?.[0]?.township_code
  if (typeof townshipCode !== "string") return refuse("SUBJECT_LOCALITY_UNRECOGNIZED")
  const locality: LocalityKeys = { neighborhoodCode: subject.neighborhoodCode, townshipCode: townshipCode.trim() }

  const characteristics = publishedRows(evidence, COUNTY_DATASETS.characteristics.id)
  const assessed = publishedRows(evidence, COUNTY_DATASETS.assessedValues.id)
  const published = publishedRows(evidence, COUNTY_DATASETS.addresses.id)
  for (const candidate of candidatePool) {
    const blocker = parcelJoinRefusal(
      candidate.pin,
      {
        characteristics: characteristics.get(candidate.pin) ?? [],
        assessed: assessed.get(candidate.pin) ?? [],
        address: published.get(candidate.pin) ?? [],
      },
      candidate.propertyClass,
      locality,
    )
    if (blocker) return refuse(blocker)
  }

  const selection = selectNonDirectionalComparables(subject, candidatePool)
  if (!selection) return refuse("MISSING_PROPERTY_CHARACTERISTICS")
  const candidateRejectedByReason = rejectionCountsByReason(selection.rejected)
  if (selection.accepted.length + selection.rejected.length !== candidatePool.length) {
    return refuse("CANDIDATE_ACCOUNTING_MISMATCH")
  }
  if (selection.accepted.length < RULE15_REQUIRED_MINIMUM) return refuse("INSUFFICIENT_COMPARABLES")

  const { valued, missingValue } = attachAssessedValues(selection.accepted, assessedValues)
  if (missingValue.length > 0) return refuse("COMPARABLE_VALUE_INCOMPLETE")
  if (valued.some((comparable) => !addresses.get(comparable.pin)?.trim())) return refuse("COMPARABLE_ADDRESS_MISSING")

  const measurement = measureUniformity(subject, valued)
  const subjectAssessedTotalCents = exactCents(subject.assessedTotalValue)
  if (!measurement || subjectAssessedTotalCents === null) return refuse("UNIFORMITY_NOT_COMPUTABLE")

  const sources = evidence.sources
  return {
    ok: true,
    comparison: {
      subject: {
        propertyClass: subject.propertyClass,
        township: subject.township,
        neighborhoodCode: subject.neighborhoodCode,
        taxYear: subject.taxYear,
        assessedTotalValue: subject.assessedTotalValue,
      },
      comparables: valued.map((comparable) => ({
        pin: comparable.pin,
        address: addresses.get(comparable.pin)!,
        city: String(published.get(comparable.pin)?.[0]?.prop_address_city_name ?? "").trim(),
        assessedValue: comparable.assessedTotalValue,
        squareFeet: comparable.buildingSqft,
        yearBuilt: comparable.yearBuilt,
        propertyClass: comparable.propertyClass,
      })),
      sharedMetric: {
        version: "ot-shared-metric/v1",
        metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT",
        unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
        cohortRule: "PAID_NEUTRAL_MATCH_V1",
        stage: "mailed",
        taxYear: subject.taxYear,
        subjectExcluded: true,
        subjectAssessedCentsPerBuildingSqft: measurement.subjectAssessedPerSqft * 100,
        subjectAssessedTotalCents,
        comparableMedian: {
          unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
          status: "COMPUTED",
          value: measurement.comparableMedianAssessedPerSqft * 100,
          count: measurement.comparableCount,
          // The report's floor, not the accepted snapshot's 1: below it the report
          // refuses, so nothing is shown here either.
          minimumCount: RULE15_REQUIRED_MINIMUM,
        },
        sampleAdequacy: "NOT_QUALIFIED",
        claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS",
      },
      comparisonEvidence: {
        selectionRuleId: selection.ruleId,
        stage: "mailed",
        taxYear: subject.taxYear,
        candidateCount: candidatePool.length,
        candidateAcceptedCount: selection.accepted.length,
        candidateRejectedByReason,
        candidatePoolSha256: candidatePoolSha256(candidatePool),
        sourceDatasetIds: [...new Set(sources.map((source) => source.datasetId))].sort(),
        sourceResponseCount: sources.length,
        collectorProtections: [...collected],
        retrievedAt: sources[sources.length - 1].retrievedAt,
        upstreamAtomicGuarantee: "NOT_ESTABLISHED",
      },
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
    const read = await readNeutralOfficialBytesRuntime({
      propertyPin: input.propertyPin,
      deadline: input.deadline,
      sharedSnapshotProtections: true,
    })
    return read.ok ? compare(read.evidence, input.expectedTownship) : { ok: false, blocker: read.blocker }
  } catch {
    return { ok: false, blocker: "FREE_COMPARISON_FAILED" }
  }
}
