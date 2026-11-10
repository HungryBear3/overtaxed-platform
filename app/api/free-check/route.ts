/**
 * Free assessment check (top-of-funnel). No auth required.
 *
 * POST: { pin?: string, address?: string, city?: string, selectedPin?: string }
 *
 * Returns the subject property, the T2 report's selection rule applied to it (every
 * qualifying comparable and the median mailed assessed value per building square
 * foot, subject excluded), the township window status, and the property
 * characteristics on file. Where the subject or the read fails, no comparison is
 * returned at all; see `readFreeComparison`.
 *
 * No overpayment projection is returned on any path; see the note beside
 * `potentialOverpaymentPerYear` below. The doc comment here used to promise one.
 *
 * Address lookups can answer 409 `ADDRESS_AMBIGUOUS` with public-record
 * candidate fragments; the caller re-posts the same address with `selectedPin`.
 */
import { recordFreeCheckCompletion } from "@/lib/analytics/free-check-measurement"
import { classifyFreeCheckInternalTest } from "@/lib/analytics/free-check-internal-test"
import { NextRequest, NextResponse } from "next/server"
import {
  getPropertyByPIN,
  searchPropertiesByAddress,
  formatPIN,
  normalizePIN,
  isValidPIN,
  ADDRESS_LOOKUP_UNAVAILABLE,
} from "@/lib/cook-county"
import type { PropertyData } from "@/lib/cook-county"
import { NON_DIRECTIONAL_RULE_ID } from "@/lib/fulfillment/t2-comparables"
import { readFreeComparison } from "@/lib/fulfillment-runtime/free-comparison"
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit"
import {
  getFreeCheckAppealWindowStatus,
  evaluateFreeCheckOutcome,
  type FreeCheckEvidence,
  type FreeCheckOutcome,
} from "@/lib/free-check-appeal-window"
import { CC_02, CC_05, CC_07 } from "@/lib/copy/canonical"
import {
  FREE_COMPARISON_SELECTION_LABEL,
  type FreeCheckSharedMetric,
} from "@/lib/free-check-comparison-contract"
import {
  parseFreeCheckAddress,
  resolveAddressCandidates,
  recordCorroboratesAddress,
  type AddressCandidateRecord,
  type RankedAddressCandidate,
} from "@/lib/free-check-address"
import {
  hostFromRequest,
  isPreviewStubEnabled,
  marketingGateReason,
} from "@/lib/marketing/preview-gate"

export const maxDuration = 25

/**
 * The share of `maxDuration` the county comparison may spend, counted from the
 * start of the request. The rest is for the measurement write and the response,
 * so a slow read refuses instead of being killed mid-answer.
 */
const COMPARISON_BUDGET_MS = 22_000

/**
 * Static sample returned to clients in preview/dev/test. Shaped to match
 * the live Result so `<FreeCheckResult>` renders without changes. Numbers
 * are illustrative — clearly inside the same neighborhood as the homepage
 * `/api/check` stub.
 */
const PREVIEW_SAMPLE_ADDRESS_PATTERN = /\b123\s+s\s+sample\s+ave\b/i

/**
 * Synthetic throughout, including the metric: no county read happened, so it
 * carries no `comparisonEvidence`. The figures are the sample comparables' own
 * dollars per sq ft, so the median on screen is the median of the rows beneath it.
 */
const PREVIEW_SHARED_METRIC: FreeCheckSharedMetric = {
  version: "ot-shared-metric/v1",
  metric: "MEDIAN_ASSESSED_PER_BUILDING_SQFT",
  unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
  cohortRule: "FREE_ELIGIBLE_POOL_MATCH_V1",
  stage: "mailed",
  taxYear: 2025,
  subjectExcluded: true,
  subjectAssessedCentsPerBuildingSqft: 3400,
  subjectAssessedTotalCents: 4250000,
  comparableMedian: {
    unit: "ASSESSED_USD_CENTS_PER_BUILDING_SQFT",
    status: "COMPUTED",
    value: (34800 / 1180) * 100,
    count: 3,
    minimumCount: 3,
  },
  sampleAdequacy: "NOT_QUALIFIED",
  claims: "ASSESSED_VALUES_ONLY_NO_MARKET_VALUE_NO_SAVINGS",
}

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
    marketValue: null,
  },
  compCount: 3,
  comps: [
    {
      pin: "18-06-214-012-0000",
      address: "123 Sample Ave",
      city: "Chicago",
      assessedValue: 36400,
      marketValue: null,
      squareFeet: 1200,
      yearBuilt: 1925,
      propertyClass: "203",
    },
    {
      pin: "18-06-214-013-0000",
      address: "127 Sample Ave",
      city: "Chicago",
      assessedValue: 34800,
      marketValue: null,
      squareFeet: 1180,
      yearBuilt: 1923,
      propertyClass: "203",
    },
    {
      pin: "18-06-214-014-0000",
      address: "131 Sample Ave",
      city: "Chicago",
      assessedValue: 34100,
      marketValue: null,
      squareFeet: 1210,
      yearBuilt: 1924,
      propertyClass: "203",
    },
  ],
  sharedMetric: PREVIEW_SHARED_METRIC,
  comparisonEvidence: null,
  avgComparableAssessedValue: null,
  equityRatio: null,
  targetEquityRatio: 10.0,
  avgCompEquityRatio: null,
  assessmentGap: null,
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
    reason: "no_comparable_level" as const,
    showFigures: false,
    showRecordComparison: true,
  },
  propertyCharacteristics: null,
  compSelection: {
    basis: "preview_sample" as const,
    distanceRanked: false,
    label: "Sample data — not selected from any real Cook County record.",
  },
  source: "preview-noop",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

  // Production deployment URLs and Preview serve real results but must not enter
  // the measurement ledger. The gate stays open on a missing host, so close it here.
  const excludeFromMeasurement = !host || isPreviewStubEnabled({ host })

  const { allowed } = rateLimit(getClientIdentifier(req), 10, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const comparisonDeadline = Date.now() + COMPARISON_BUDGET_MS

  try {
    const body = await req.json().catch(() => ({}))
    // Default OFF. Only a verified ADMIN session can make this true; the body
    // marker alone is ignored. It changes measurement only, never the result.
    const internalTest =
      body && typeof body === "object" ? await classifyFreeCheckInternalTest(req, body) : false
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
      //
      // Once it is answered, the answer is an authority boundary and it does not
      // become advisory because the repeated county lookup happened to narrow.
      // Remote-result drift, a partial dataset response, a cache difference or a
      // changed widening fragment can all turn a two-parcel address into one
      // parcel between the two requests, and the parcel left standing need not be
      // the one that was chosen. So the posted PIN is required among this
      // lookup's selectable parcels whichever way it resolved, and if it is not
      // there the check fails closed and asks again — it never transfers the
      // selection to a parcel the reader did not pick, however well that parcel
      // matches the typed street.
      const selectable = resolution.selectable
      const selectionRequired = (message: string) =>
        NextResponse.json(
          {
            error: message,
            code: "ADDRESS_AMBIGUOUS",
            candidates: selectable.map(publicSelectionFragment),
            candidateCount: resolution.kind === "ambiguous" ? resolution.total : selectable.length,
            candidatesShown: selectable.length,
            assessorAddressSearchUrl: ASSESSOR_ADDRESS_SEARCH_URL,
            disclosure: CC_02,
          },
          { status: 409 }
        )

      const picked = selectedPin
        ? selectable.find((candidate) => candidate.pin === selectedPin)
        : undefined

      let chosen: RankedAddressCandidate
      if (selectedPin && !picked) {
        return selectionRequired(
          "That PIN is not one of the matches for this address. Choose one of the listed properties."
        )
      } else if (picked) {
        chosen = picked
      } else if (resolution.kind === "ambiguous") {
        return selectionRequired("More than one Cook County property matches that address.")
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
      const measurement = await recordFreeCheckCompletion({ body, outcome: noValueOutcome, windowStatus: noValueWindow.status, preview: excludeFromMeasurement, internalTest })
      return NextResponse.json({
        success: true,
        measurement,
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
        sharedMetric: null,
        comparisonEvidence: null,
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
          basis: NON_DIRECTIONAL_RULE_ID,
          distanceRanked: false,
          label: "No comparable properties were selected — the subject has no published assessed value.",
        },
        noAssessedValue: true,
        message: "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. This can happen with recently transferred properties or during reassessment. Check your assessment status at https://www.cookcountyassessoril.gov/address-search.",
        source: "Cook County Open Data",
      })
    }

    // ── The report's comparison ──────────────────────────────────────────────
    //
    // The same selection and median as the T2 report, over the whole neighborhood
    // pool with unusable parcels counted out, read inside this request and stored
    // nowhere. It used to be the first three parcels of a
    // sales-then-equity search with looser bands and widening fallbacks, a mean of
    // whichever total each happened to carry, and a market value that was the
    // assessed value times ten. None of that survives: a refused read means no
    // comparison, never a looser one, and no subject figure beside it, because
    // the lookup's figure above can be a later stage than the mailed one.
    const comparisonRead = await readFreeComparison({
      propertyPin: propertyData.pin,
      expectedTownship: propertyData.township,
      deadline: comparisonDeadline,
    })
    // The blocker is a bounded name. No PIN or address reaches a log line here.
    if (!comparisonRead.ok) console.warn("[free-check] comparison unavailable:", comparisonRead.blocker)
    const comparison = comparisonRead.ok ? comparisonRead.comparison : null

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
    //
    // No assessment level enters it. The only market value this route ever had
    // was the assessed value times ten, which makes the ratio 10.0 for every
    // parcel, so both levels are absent and the outcome resolves on the record
    // comparison alone.
    const township = comparison?.subject.township ?? propertyData.township
    const appealWindowStatus = getFreeCheckAppealWindowStatus(township)
    const outcome: FreeCheckOutcome = evaluateFreeCheckOutcome({
      window: appealWindowStatus,
      evidence: evidenceFor(propertyData, {
        assessedTotalValue: comparison?.subject.assessedTotalValue ?? subjectAV,
        equityRatio: null,
        avgCompEquityRatio: null,
        compCount: comparison?.comparables.length ?? 0,
        ...(comparison ? { propertyClass: comparison.subject.propertyClass } : {}),
      }),
    })

    // The public-record comparison rides its own gate.
    //
    // It used to ride `showFigures`, and `showFigures` is false whenever the
    // assessment *level* cannot be computed — which happens whenever the county
    // carries no market value for the subject, or for any comparable. Those are
    // absences in a different column. A property with a published assessed value
    // and three published comparable assessed values had all of it suppressed
    // because a fourth field was blank, and the reader was shown "insufficient
    // evidence" over a comparison that was sitting complete in the response.
    const released = outcome.showRecordComparison ? comparison : null

    const measurement = await recordFreeCheckCompletion({ body, outcome, windowStatus: appealWindowStatus.status, preview: excludeFromMeasurement, internalTest })
    return NextResponse.json({
      success: true,
      measurement,
      disclosure: CC_02,
      sourceCaveat: CC_07,
      outcome,
      subject: {
        pin: formatPIN(propertyData.pin),
        address: propertyData.address,
        city: propertyData.city,
        zipCode: propertyData.zipCode,
        township,
        neighborhoodCode: released?.subject.neighborhoodCode ?? neighborhoodCode,
        taxYear: released?.subject.taxYear ?? taxYear,
        // Mailed, from the same read as the comparison, or nothing.
        assessedTotalValue: released?.subject.assessedTotalValue ?? null,
        marketValue: null,
      },
      compCount: released?.comparables.length ?? 0,
      comps: (released?.comparables ?? []).map((comparable) => ({
        ...comparable,
        pin: formatPIN(comparable.pin),
        marketValue: null,
      })),
      sharedMetric: released?.sharedMetric ?? null,
      comparisonEvidence: released?.comparisonEvidence ?? null,
      // Gone with the mean and the times-ten market value they were computed
      // from. Still sent as null so the `Result` shape every surface reads holds.
      avgComparableAssessedValue: null,
      equityRatio: null,
      targetEquityRatio: 10.0,
      avgCompEquityRatio: null,
      assessmentGap: null,
      // Never released. A per-year or three-year dollar projection is a savings
      // claim about the reader's property (BL-B1/B3) and a merits
      // characterization (BL-C3), and no signed eligibility policy (OD-2/OD-3)
      // stands behind one. The assessment comparison above is the public
      // record; this was arithmetic performed on top of it and presented as an
      // outcome. It is computed no further and sent as null on every path.
      potentialOverpaymentPerYear: null,
      potentialOverpayment3Year: null,
      // The drafted argument was built from the mean. Nothing replaces it here:
      // the report omits a drafted argument too, under the unsigned OD-5.
      appealArgumentText: null,
      appealWindowStatus,
      propertyCharacteristics,
      // How the comparables above were actually chosen. Nothing in this route
      // computes a distance, and nothing ranks at all: every parcel that meets
      // the rule is listed. Every surface that called these "the three nearest"
      // or "nearby" was describing a ranking that is not performed.
      compSelection: {
        basis: NON_DIRECTIONAL_RULE_ID,
        distanceRanked: false,
        label: released
          ? FREE_COMPARISON_SELECTION_LABEL
          : "No comparable properties are shown for this property.",
      },
      source: "Cook County Open Data",
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
  > & Partial<Pick<FreeCheckEvidence, "propertyClass">>,
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
