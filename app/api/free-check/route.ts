/**
 * Free assessment check (top-of-funnel). No auth required.
 *
 * POST: { pin?: string, address?: string, city?: string, selectedPin?: string }
 *
 * Returns the subject property, up to three comparable properties from the
 * Cook County record with their assessed values and average, the assessment
 * level where a market value exists for both sides, the appeal argument for a
 * supportive outcome, the township window status, and the property
 * characteristics on file.
 *
 * No overpayment projection is returned on any path; see the note beside
 * `potentialOverpaymentPerYear` below. The doc comment here used to promise one.
 *
 * Address lookups can answer 409 `ADDRESS_AMBIGUOUS` with public-record
 * candidate fragments; the caller re-posts the same address with `selectedPin`.
 */
import { NextRequest, NextResponse } from "next/server"
import {
  getPropertyByPIN,
  searchPropertiesByAddress,
  getComparableSales,
  getComparableEquity,
  formatPIN,
  normalizePIN,
  isValidPIN,
  ADDRESS_LOOKUP_UNAVAILABLE,
} from "@/lib/cook-county"
import type { PropertyData, SalesRecord, EquityRecord } from "@/lib/cook-county"
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit"
import {
  getFreeCheckAppealWindowStatus,
  evaluateFreeCheckOutcome,
  type FreeCheckEvidence,
  type FreeCheckOutcome,
} from "@/lib/free-check-appeal-window"
import { CC_02, CC_05, CC_07 } from "@/lib/copy/canonical"
import {
  parseFreeCheckAddress,
  resolveAddressCandidates,
  recordCorroboratesAddress,
  type AddressCandidateRecord,
  type RankedAddressCandidate,
} from "@/lib/free-check-address"
import {
  hostFromRequest,
  marketingGateReason,
} from "@/lib/marketing/preview-gate"

export const maxDuration = 25

/**
 * Static sample returned to clients in preview/dev/test. Shaped to match
 * the live Result so `<FreeCheckResult>` renders without changes. Numbers
 * are illustrative — clearly inside the same neighborhood as the homepage
 * `/api/check` stub.
 */
const PREVIEW_SAMPLE_ADDRESS_PATTERN = /\b123\s+s\s+sample\s+ave\b/i

const PREVIEW_FREE_CHECK_SAMPLE = {
  success: true,
  mode: "preview_noop" as const,
  subject: {
    pin: "18-06-214-011-0000",
    address: "Sample result — not your submitted address",
    city: "Chicago",
    zipCode: "60526",
    township: "Cicero",
    neighborhoodCode: "78-120",
    taxYear: 2025,
    assessedTotalValue: 42500,
    marketValue: 425000,
  },
  compCount: 3,
  comps: [
    {
      pin: "18-06-214-012-0000",
      address: "123 Sample Ave",
      city: "Chicago",
      assessedValue: 36400,
      marketValue: 364000,
      squareFeet: 1200,
      yearBuilt: 1925,
      propertyClass: "2-03",
    },
    {
      pin: "18-06-214-013-0000",
      address: "127 Sample Ave",
      city: "Chicago",
      assessedValue: 34800,
      marketValue: 348000,
      squareFeet: 1180,
      yearBuilt: 1923,
      propertyClass: "2-03",
    },
    {
      pin: "18-06-214-014-0000",
      address: "131 Sample Ave",
      city: "Chicago",
      assessedValue: 34100,
      marketValue: 341000,
      squareFeet: 1210,
      yearBuilt: 1924,
      propertyClass: "2-03",
    },
  ],
  avgComparableAssessedValue: 35100,
  equityRatio: 12.1,
  targetEquityRatio: 10.0,
  avgCompEquityRatio: 10.3,
  assessmentGap: 7400,
  // No projected overpayment. The sample used to carry $1,420/yr and $4,260 over
  // three years, and those two figures escaped: `components/ot-design/HomePage.tsx`
  // spread this object as the base of every normalized result, so a real check
  // missing a field inherited them and displayed them as its own.
  potentialOverpaymentPerYear: null,
  potentialOverpayment3Year: null,
  appealArgumentText: null,
  disclosure: CC_02,
  sourceCaveat: CC_07,
  // The sample tracks what production can actually produce. It used to assert an
  // open Cicero window with concrete June/July 2026 dates — dates taken from the
  // design seed, never retrieved from anyone — while the canonical state refuses
  // the committed snapshot outright, so no township resolves to `open` today. A
  // preview fixture that is easier to sell than production is not a preview of
  // production, and this one was the sole surviving place those seed dates were
  // still rendered as a filing window.
  appealWindowStatus: {
    township: "Cicero",
    status: "unknown" as const,
    openDate: null,
    closeDate: null,
    filingUrl: "https://www.cookcountyassessoril.gov/online-appeals",
    note: "Preview sample — no county retrieval was performed. Check https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines for your township's appeal dates.",
    pendingReason: "synthetic_source" as const,
    allowCheckout: false,
    showDates: false,
    showCountdown: false,
    allowDeadlineCta: false,
    allowReminderSignup: false,
  },
  outcome: {
    code: "insufficient_evidence" as const,
    headline: CC_05,
    allowCheckout: false,
    reason: "eligibility_policy_unsigned" as const,
    showFigures: true,
    showRecordComparison: true,
  },
  propertyCharacteristics: null,
  compSelection: {
    basis: "cohort_recency" as const,
    distanceRanked: false,
    label: "Sample data — not selected from any real Cook County record.",
  },
  source: "preview-noop",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCompAssessedValue(sale: SalesRecord): number | null {
  if (sale.assessedMarketValue != null && sale.assessedMarketValue > 0) {
    return sale.assessedMarketValue / 10
  }
  if (sale.salePrice > 0) return sale.salePrice / 10
  return null
}

function getEquityAssessedValue(equity: EquityRecord): number | null {
  if (equity.assessedMarketValue != null && equity.assessedMarketValue > 0) {
    return equity.assessedMarketValue / 10
  }
  return null
}

function formatCurrencyShort(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`
  return `$${Math.round(n)}`
}

function buildAppealArgument(
  address: string,
  city: string,
  subjectAV: number,
  avgCompAV: number,
  marketValue: number | null,
  township: string | null,
  neighborhoodCode: string | null,
  equityRatio: number | null
): string {
  const gap = subjectAV - avgCompAV
  const targetAV = avgCompAV
  const mvStr = marketValue ? formatCurrencyShort(marketValue) : "estimated market value"
  const ratioStr = equityRatio != null ? `${equityRatio.toFixed(1)}%` : "above"
  const townshipStr = township ? `${township} township` : "this neighborhood"
  const nbhdStr = neighborhoodCode ? ` (CCAO neighborhood ${neighborhoodCode})` : ""

  return `The subject property at ${address}, ${city}${nbhdStr} has been assessed at $${subjectAV.toLocaleString()}, resulting in an assessment level of ${ratioStr} — above Cook County's 10% residential target.

Comparable properties in ${townshipStr} average $${Math.round(avgCompAV).toLocaleString()} in assessed value, giving a separate uniformity benchmark for similar homes.

Under Illinois law (35 ILCS 200/9-5) and the Cook County Assessor's rules, property assessments should reflect 10% of fair market value and be uniform with comparable properties. This property's assessment exceeds comparable properties by approximately $${Math.round(gap).toLocaleString()} in assessed value.

We request a reduction in the assessed value to $${Math.round(targetAV).toLocaleString()}, consistent with the ${mvStr} market value and comparable properties in the neighborhood.`
}


const ASSESSOR_ADDRESS_SEARCH_URL = "https://www.cookcountyassessoril.gov/address-search"

/**
 * How many address rows to pull before ranking.
 *
 * This was 5, which is smaller than a single Chicago condo building. A
 * ranker cannot report an eight-parcel address as ambiguous if the query only
 * ever showed it five rows, and truncation that silently narrows an ambiguity
 * verdict is the same defect as picking `data[0]` — just later in the pipeline.
 */
const ADDRESS_CANDIDATE_FETCH_LIMIT = 25

/** The most candidates offered back for selection. Reported, never silent. */
const ADDRESS_CANDIDATE_OFFER_LIMIT = 8

function candidateFromRow(row: unknown): AddressCandidateRecord | null {
  const r = (row ?? {}) as Record<string, unknown>
  const pin = String(r.pin ?? "").replace(/\D/g, "")
  if (pin.length !== 14) return null
  return {
    pin,
    address: String(r.property_address ?? r.prop_address_full ?? "").trim(),
    city: String(r.property_city ?? r.prop_address_city_name ?? "").trim(),
    zip: String(r.property_zip ?? r.prop_address_zipcode_1 ?? "").trim(),
  }
}

/**
 * The public-record fragments a selection step may show.
 *
 * Everything here is already published by the Cook County Assessor against that
 * PIN. No score, no ranking rationale, and nothing about the reader's own input
 * crosses back over the wire — a match score rendered next to a stranger's
 * address reads as a claim about which one is theirs.
 */
function publicSelectionFragment(candidate: RankedAddressCandidate) {
  return {
    pin: formatPIN(candidate.pin),
    address: candidate.address,
    city: candidate.city,
    zipCode: candidate.zip,
    unit: candidate.unit,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Dev/test and explicit override: return a static sample without touching
  // Cook County, rate-limit, or DB. Vercel Preview is production-built and
  // uses the real read-only Cook County lookup so we can QA the address flow
  // before promoting to production.
  const host = hostFromRequest(req)
  const forcePreviewStub =
    process.env.OT_FORCE_PREVIEW_STUB === "true" ||
    process.env.NEXT_PUBLIC_OT_FORCE_PREVIEW_STUB === "true"
  if (forcePreviewStub || process.env.NODE_ENV !== "production") {
    return NextResponse.json({
      ...PREVIEW_FREE_CHECK_SAMPLE,
      reason: forcePreviewStub ? "forced-override" : marketingGateReason({ host }),
    })
  }

  const { allowed } = rateLimit(getClientIdentifier(req), 10, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const pinRaw = typeof body.pin === "string" ? body.pin.trim() : ""
    const address = typeof body.address === "string" ? body.address.trim() : ""
    const city = typeof body.city === "string" ? body.city.trim() : ""
    // Set by the selection step below when a building resolved to more than one
    // parcel. It is never trusted on its own: it has to reappear among the
    // ranked survivors of the same address before it selects anything.
    const selectedPin =
      typeof body.selectedPin === "string" ? normalizePIN(body.selectedPin) : ""

    if (PREVIEW_SAMPLE_ADDRESS_PATTERN.test(address)) {
      return NextResponse.json({
        ...PREVIEW_FREE_CHECK_SAMPLE,
        reason: "sample-address",
      })
    }

    let propertyData: PropertyData | null = null

    if (pinRaw && isValidPIN(pinRaw)) {
      const res = await getPropertyByPIN(pinRaw)
      if (res.success && res.data) propertyData = res.data
      else {
        return NextResponse.json(
          { error: res.error ?? "Property not found for this PIN." },
          { status: 400 }
        )
      }
    } else {
      const parsed = parseFreeCheckAddress(address, city)
      if (!parsed.streetName || parsed.street.length < 5) {
        return NextResponse.json(
          { error: "Enter either a 14-digit Cook County PIN or a street address (at least 5 characters)." },
          { status: 400 }
        )
      }

      // The caller's own street line first, then the widening fragments — a
      // stored directional the homeowner omitted, a suffix they spelled out.
      const searchOptions = { fragments: parsed.queryFragments }
      let search = await searchPropertiesByAddress(
        parsed.street,
        parsed.city || undefined,
        ADDRESS_CANDIDATE_FETCH_LIMIT,
        searchOptions,
      )

      // A provider outage and an address that is not on file are different
      // facts, and they used to produce the same sentence. Telling a homeowner
      // with a perfectly good address to go find their PIN because Socrata was
      // down is a statement about their property that we did not establish.
      if (!search.success) {
        return NextResponse.json(
          {
            error:
              "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
            code:
              search.error === ADDRESS_LOOKUP_UNAVAILABLE
                ? "ADDRESS_LOOKUP_UNAVAILABLE"
                : "ADDRESS_LOOKUP_FAILED",
            retryable: true,
          },
          { status: 503 }
        )
      }

      if ((search.data?.length ?? 0) === 0 && parsed.city.trim()) {
        const relaxedSearch = await searchPropertiesByAddress(
          parsed.street,
          undefined,
          ADDRESS_CANDIDATE_FETCH_LIMIT,
          searchOptions,
        )
        if (!relaxedSearch.success) {
          return NextResponse.json(
            {
              error:
                "We could not reach the Cook County records service just now. Please try again in a few minutes — this is on our side, not your address.",
              code:
                relaxedSearch.error === ADDRESS_LOOKUP_UNAVAILABLE
                  ? "ADDRESS_LOOKUP_UNAVAILABLE"
                  : "ADDRESS_LOOKUP_FAILED",
              retryable: true,
            },
            { status: 503 }
          )
        }
        if (relaxedSearch.success && (relaxedSearch.data?.length ?? 0) > 0) {
          search = relaxedSearch
        }
      }

      const candidates = (search.data ?? [])
        .map((row) => candidateFromRow(row))
        .filter((row): row is AddressCandidateRecord => row !== null)

      const resolution = resolveAddressCandidates(parsed, candidates, {
        maxCandidates: ADDRESS_CANDIDATE_OFFER_LIMIT,
      })

      if (resolution.kind === "none") {
        return NextResponse.json(
          {
            error:
              "We could not find that address in the Cook County Assessor's records. Check it against the Assessor's own address search, or enter your 14-digit PIN.",
            code: "ADDRESS_NOT_FOUND",
            assessorAddressSearchUrl: ASSESSOR_ADDRESS_SEARCH_URL,
          },
          { status: 404 }
        )
      }

      // The selection step. A building with several parcels behind one street
      // address is not a failure and it is not the homeowner's problem to solve
      // on the Assessor's site — it is a question only they can answer, so it is
      // asked here rather than resolved by taking the first row.
      let chosen: RankedAddressCandidate
      if (resolution.kind === "ambiguous") {
        const picked = selectedPin
          ? resolution.candidates.find((candidate) => candidate.pin === selectedPin)
          : undefined
        if (!picked) {
          return NextResponse.json(
            {
              error: selectedPin
                ? "That PIN is not one of the matches for this address. Choose one of the listed properties."
                : "More than one Cook County property matches that address.",
              code: "ADDRESS_AMBIGUOUS",
              candidates: resolution.candidates.map(publicSelectionFragment),
              candidateCount: resolution.total,
              candidatesShown: resolution.candidates.length,
              assessorAddressSearchUrl: ASSESSOR_ADDRESS_SEARCH_URL,
              disclosure: CC_02,
            },
            { status: 409 }
          )
        }
        chosen = picked
      } else {
        chosen = resolution.candidate
      }

      const res = await getPropertyByPIN(chosen.pin)
      if (!res.success || !res.data) {
        return NextResponse.json(
          { error: res.error ?? "Could not load property details.", code: "PROPERTY_LOOKUP_FAILED" },
          { status: 400 }
        )
      }

      // The PIN travelled through a second dataset between the candidate row and
      // this record. If what came back no longer describes the address that was
      // asked about, the two pieces of evidence disagree and the check stops —
      // an answer assembled from a mismatched parcel is worse than no answer.
      if (!recordCorroboratesAddress(
        parsed,
        chosen,
        res.data.pin,
        res.data.address,
        res.data.city,
      )) {
        return NextResponse.json(
          {
            error:
              "The Cook County record for that address did not match it on retrieval. Enter your 14-digit PIN, or look the address up on the Assessor's site.",
            code: "ADDRESS_EVIDENCE_MISMATCH",
            assessorAddressSearchUrl: ASSESSOR_ADDRESS_SEARCH_URL,
          },
          { status: 409 }
        )
      }

      propertyData = res.data
    }

    if (!propertyData) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 })
    }

    const subjectAV = propertyData.assessedTotalValue ?? 0
    const neighborhoodCode = propertyData.neighborhood ?? null
    const taxYear = propertyData.assessmentHistory[0]?.year ?? null

    // ── Property characteristics ────────────────────────────────────────────
    const propertyCharacteristics = (
      propertyData.livingArea ||
      propertyData.yearBuilt ||
      propertyData.bedrooms ||
      propertyData.bathrooms ||
      propertyData.buildingClass
    ) ? {
      squareFeet: propertyData.livingArea,
      yearBuilt: propertyData.yearBuilt,
      bedrooms: propertyData.bedrooms,
      bathrooms: propertyData.bathrooms,
      propertyClass: propertyData.buildingClass,
      exterior: propertyData.exteriorWall,
      basement: propertyData.basement ? String(propertyData.basement) : null,
      garage: propertyData.garage,
      note: "These are the characteristics on file with the CCAO. Errors in square footage, bedroom count, or property class can support an appeal.",
    } : null

    // If no assessed value on file, return property info without overpayment estimate.
    // This is CC-05, not a softer variant of it: the check ran and established
    // nothing, and `noAssessedValue` alone left that to the caller to interpret.
    if (subjectAV <= 0) {
      const noValueWindow = getFreeCheckAppealWindowStatus(propertyData.township)
      const noValueOutcome = evaluateFreeCheckOutcome({
        window: noValueWindow,
        evidence: evidenceFor(propertyData, {
          assessedTotalValue: null,
          equityRatio: null,
          avgCompEquityRatio: null,
          compCount: 0,
        }),
      })
      return NextResponse.json({
        success: true,
        disclosure: CC_02,
        sourceCaveat: CC_07,
        outcome: noValueOutcome,
        subject: {
          pin: formatPIN(propertyData.pin),
          address: propertyData.address,
          city: propertyData.city,
          zipCode: propertyData.zipCode,
          township: propertyData.township,
          neighborhoodCode,
          taxYear,
          assessedTotalValue: null,
          marketValue: null,
        },
        compCount: 0,
        comps: [],
        avgComparableAssessedValue: null,
        equityRatio: null,
        targetEquityRatio: 10.0,
        avgCompEquityRatio: null,
        assessmentGap: null,
        potentialOverpaymentPerYear: null,
        potentialOverpayment3Year: null,
        appealArgumentText: null,
        appealWindowStatus: noValueWindow,
        propertyCharacteristics,
        compSelection: {
          basis: "cohort_recency" as const,
          distanceRanked: false,
          label: "No comparable properties were selected — the subject has no published assessed value.",
        },
        noAssessedValue: true,
        message: "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. This can happen with recently transferred properties or during reassessment. Check your assessment status at https://www.cookcountyassessoril.gov/address-search.",
        source: "Cook County Open Data",
      })
    }

    // ── Fetch comps ──────────────────────────────────────────────────────────
    const [salesRes, equityRes] = await Promise.all([
      getComparableSales(propertyData, { limit: 5, livingAreaTolerancePercent: 30, yearBuiltTolerance: 15 }),
      getComparableEquity(propertyData, { limit: 5, livingAreaTolerancePercent: 30, yearBuiltTolerance: 15 }),
    ])

    const sales = salesRes.success && salesRes.data ? salesRes.data : []
    const equity = equityRes.success && equityRes.data ? equityRes.data : []

    // Build comp values list (max 3)
    const compValues: number[] = []
    const compDetails: Array<{
      pin: string
      address: string
      city: string
      assessedValue: number
      marketValue: number | null
      squareFeet: number | null
      yearBuilt: number | null
      propertyClass: string | null
    }> = []

    sales.slice(0, 3).forEach((s) => {
      const av = getCompAssessedValue(s)
      if (av != null) {
        compValues.push(av)
        compDetails.push({
          pin: formatPIN(s.pin),
          address: s.address || "",
          city: s.city || "",
          assessedValue: Math.round(av),
          marketValue: s.assessedMarketValue != null ? Math.round(s.assessedMarketValue) : null,
          squareFeet: s.livingArea,
          yearBuilt: s.yearBuilt,
          propertyClass: s.buildingClass,
        })
      }
    })
    if (compValues.length < 3) {
      equity.forEach((e) => {
        if (compValues.length >= 3) return
        const av = getEquityAssessedValue(e)
        if (av != null) {
          compValues.push(av)
          compDetails.push({
            pin: formatPIN(e.pin),
            address: e.address || "",
            city: e.city || "",
            assessedValue: Math.round(av),
            marketValue: e.assessedMarketValue != null ? Math.round(e.assessedMarketValue) : null,
            squareFeet: e.livingArea,
            yearBuilt: e.yearBuilt,
            propertyClass: e.buildingClass,
          })
        }
      })
    }

    const avgCompAV = compValues.length > 0
      ? compValues.reduce((a, b) => a + b, 0) / compValues.length
      : null

    // ── Equity ratio calculation ─────────────────────────────────────────────
    // Equity ratio = assessed value / market value as percentage. CCAO target = 10%.
    const subjectMarketValue = propertyData.marketValue
    const equityRatio =
      subjectMarketValue != null && subjectMarketValue > 0
        ? Math.round((subjectAV / subjectMarketValue) * 1000) / 10  // e.g. 10.7
        : null

    // Average comp assessment level — use comp market values if available
    const compEquityRatios: number[] = []
    compDetails.forEach((c) => {
      if (c.marketValue != null && c.marketValue > 0 && c.assessedValue > 0) {
        compEquityRatios.push(c.assessedValue / c.marketValue)
      }
    })
    // No comparable had both a market and an assessed value, so there is no
    // comparable assessment level. This used to fall back to the literal 10.0 —
    // the county's statutory target — which meant a subject with no usable
    // comparables was silently measured against a policy number and reported as
    // if it had been compared with its neighbours. Absence stays absent.
    const avgCompEquityRatio =
      compEquityRatios.length > 0
        ? Math.round((compEquityRatios.reduce((a, b) => a + b, 0) / compEquityRatios.length) * 1000) / 10
        : null

    const assessmentGap = avgCompAV != null ? Math.round(subjectAV - avgCompAV) : null

    // ── No overpayment estimate is computed ──────────────────────────────────
    //
    // This block used to multiply the assessed-value gap by `taxRate ?? 0.07`
    // and `stateEqualizer ?? 3.0`, so a parcel whose record carried neither
    // still produced a precise dollar figure, rendered as "$1,420/yr" with no
    // indication that both multiplicands were invented. Removing the defaults
    // was not enough: even from real factors the product is a savings claim
    // about the reader's property, which BL-B1/B3 bans outright and which no
    // signed eligibility policy stands behind. The figure is not computed at
    // all now, so there is nothing for a later consumer to reach for.

    // ── The single evaluated outcome ─────────────────────────────────────────
    //
    // `MEANINGFUL_SAVINGS_THRESHOLD = 100` is gone. It decided, from a dollar
    // estimate built on two possibly-invented factors, whether the reader was
    // told anything at all — and two more copies of the same constant made the
    // same call independently in the result component and the email templates,
    // so the three could disagree about the same property. The decision is made
    // once, here, against the assessment evidence rather than a derived dollar
    // figure, and every surface renders what comes back.
    const appealWindowStatus = getFreeCheckAppealWindowStatus(propertyData.township)
    const outcome: FreeCheckOutcome = evaluateFreeCheckOutcome({
      window: appealWindowStatus,
      evidence: evidenceFor(propertyData, {
        assessedTotalValue: subjectAV,
        equityRatio,
        avgCompEquityRatio,
        compCount: compValues.length,
      }),
    })

    // ── Appeal argument text ─────────────────────────────────────────────────
    // Generated only for a supportive outcome. Argument text for a property we
    // have not concluded anything about reads as a conclusion.
    const appealArgumentText =
      outcome.code === "supportive" && avgCompAV != null
        ? buildAppealArgument(
            propertyData.address,
            propertyData.city,
            subjectAV,
            avgCompAV,
            subjectMarketValue,
            propertyData.township,
            neighborhoodCode,
            equityRatio
          )
        : null

    // Two different gates, because these are two different kinds of number.
    //
    // The assessment comparison — assessed value, comparable average, ratio —
    // is a description of the public record, and it survives `showFigures`.
    //
    // The projected annual overpayment is not a record. It is a forecast of a
    // tax bill that has not been issued, from an assessment the county has not
    // been asked to change. It is the figure a reader remembers, and it is
    // therefore released only for a supportive outcome. Shown beside
    // "Insufficient evidence" it simply overrides the words next to it.
    const showFigures = outcome.showFigures

    // The public-record comparison rides its own gate.
    //
    // It used to ride `showFigures`, and `showFigures` is false whenever the
    // assessment *level* cannot be computed — which happens whenever the county
    // carries no market value for the subject, or for any comparable. Those are
    // absences in a different column. A property with a published assessed value
    // and three published comparable assessed values had all of it suppressed
    // because a fourth field was blank, and the reader was shown "insufficient
    // evidence" over a comparison that was sitting complete in the response.
    const showRecordComparison = outcome.showRecordComparison

    return NextResponse.json({
      success: true,
      disclosure: CC_02,
      sourceCaveat: CC_07,
      outcome,
      subject: {
        pin: formatPIN(propertyData.pin),
        address: propertyData.address,
        city: propertyData.city,
        zipCode: propertyData.zipCode,
        township: propertyData.township,
        neighborhoodCode,
        taxYear,
        assessedTotalValue: subjectAV,
        marketValue: propertyData.marketValue,
      },
      compCount: showRecordComparison ? compValues.length : 0,
      comps: showRecordComparison ? compDetails : [],
      avgComparableAssessedValue: showRecordComparison ? avgCompAV : null,
      // Assessment levels are ratios against a market value, so they stay behind
      // the narrower gate even when the assessed-value comparison is released.
      equityRatio: showFigures ? equityRatio : null,
      targetEquityRatio: 10.0,
      avgCompEquityRatio: showFigures ? avgCompEquityRatio : null,
      assessmentGap: showRecordComparison ? assessmentGap : null,
      // Never released. A per-year or three-year dollar projection is a savings
      // claim about the reader's property (BL-B1/B3) and a merits
      // characterization (BL-C3), and no signed eligibility policy (OD-2/OD-3)
      // stands behind one. The assessment comparison above is the public
      // record; this was arithmetic performed on top of it and presented as an
      // outcome. It is computed no further and sent as null on every path.
      potentialOverpaymentPerYear: null,
      potentialOverpayment3Year: null,
      appealArgumentText,
      appealWindowStatus,
      propertyCharacteristics,
      // How the comparables above were actually chosen. Nothing in this route
      // computes a distance: `getComparableSales` filters on the subject's CCAO
      // neighbourhood code and building class and orders by sale date, widening
      // to a three-year window and then to the township when a cohort is thin,
      // and `getComparableEquity` fills any shortfall from the same neighbourhood
      // or township. Every surface that called these "the three nearest" or
      // "nearby" was describing a ranking that is not performed.
      compSelection: {
        basis: "cohort_recency" as const,
        distanceRanked: false,
        label: "Selected from available Cook County records for similar properties in the same assessment cohort.",
      },
      source: salesRes.source ?? "Cook County Open Data",
    })
  } catch (error) {
    console.error("[free-check] error:", error)
    return NextResponse.json(
      {
        error:
          "Something went wrong. Try again, or use your PIN from https://www.cookcountyassessoril.gov/address-search.",
      },
      { status: 500 }
    )
  }
}

/**
 * Assemble the evidence record the outcome is evaluated from.
 *
 * Kept in one place so the no-assessed-value branch and the main branch cannot
 * describe the same property differently. `pinCount` is 1 by construction on
 * both paths: this route resolves exactly one PIN, and a multi-PIN subject is
 * rejected earlier rather than averaged.
 */
function evidenceFor(
  propertyData: PropertyData,
  measured: Pick<
    FreeCheckEvidence,
    "assessedTotalValue" | "equityRatio" | "avgCompEquityRatio" | "compCount"
  >,
): FreeCheckEvidence {
  return {
    propertyClass: propertyData.buildingClass,
    pinCount: 1,
    // Checked rather than assumed. The lookup is a Cook County dataset, but an
    // address search can return a record whose county field says otherwise, and
    // the packet is defined for Cook County only.
    inCookCounty: (propertyData.county ?? "").trim().toLowerCase().startsWith("cook"),
    ...measured,
  }
}
