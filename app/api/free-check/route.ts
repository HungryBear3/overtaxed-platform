/**
 * Free assessment check (top-of-funnel). No auth required.
 * POST: { pin?: string, address?: string, city?: string }
 * Returns: subject property, up to 3 comps summary, avg comp value, potential overpayment/year,
 *          equity ratios, comp details, appeal argument, township window status, property characteristics.
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
} from "@/lib/cook-county"
import type { PropertyData, SalesRecord, EquityRecord } from "@/lib/cook-county"

export const maxDuration = 25

// ─── Township appeal windows (approximate 2025/2026 Cook County schedule) ───
// CCAO opens townships on a rolling basis. Dates are approximate — users should verify at cookcountyassessoril.gov
const TOWNSHIP_APPEAL_WINDOWS: Record<string, { open: string; close: string }> = {
  "chicago": { open: "2026-01-12", close: "2026-04-30" },
  "city of chicago": { open: "2026-01-12", close: "2026-04-30" },
  "evanston": { open: "2026-03-02", close: "2026-06-12" },
  "new trier": { open: "2026-03-02", close: "2026-06-12" },
  "niles": { open: "2026-04-06", close: "2026-07-10" },
  "elk grove": { open: "2026-04-06", close: "2026-07-10" },
  "maine": { open: "2026-04-06", close: "2026-07-10" },
  "norwood park": { open: "2026-04-06", close: "2026-07-10" },
  "jefferson": { open: "2026-04-06", close: "2026-07-10" },
  "oak park": { open: "2026-02-17", close: "2026-05-22" },
  "river forest": { open: "2026-02-17", close: "2026-05-22" },
  "proviso": { open: "2026-02-17", close: "2026-05-22" },
  "berwyn": { open: "2026-02-17", close: "2026-05-22" },
  "cicero": { open: "2026-02-17", close: "2026-05-22" },
  "lyons": { open: "2026-02-17", close: "2026-05-22" },
  "riverside": { open: "2026-02-17", close: "2026-05-22" },
  "stickney": { open: "2026-02-17", close: "2026-05-22" },
  "worth": { open: "2026-05-04", close: "2026-08-07" },
  "palos": { open: "2026-05-04", close: "2026-08-07" },
  "orland": { open: "2026-05-04", close: "2026-08-07" },
  "lemont": { open: "2026-05-04", close: "2026-08-07" },
  "thornton": { open: "2026-05-04", close: "2026-08-07" },
  "calumet": { open: "2026-05-04", close: "2026-08-07" },
  "bloom": { open: "2026-05-04", close: "2026-08-07" },
  "rich": { open: "2026-05-04", close: "2026-08-07" },
  "Bremen": { open: "2026-05-04", close: "2026-08-07" },
  "lake": { open: "2026-04-06", close: "2026-07-10" },
  "hanover": { open: "2026-04-06", close: "2026-07-10" },
  "schaumburg": { open: "2026-04-06", close: "2026-07-10" },
  "palatine": { open: "2026-04-06", close: "2026-07-10" },
  "wheeling": { open: "2026-04-06", close: "2026-07-10" },
  "barrington": { open: "2026-04-06", close: "2026-07-10" },
  "north chicago": { open: "2026-03-02", close: "2026-06-12" },
  "south chicago": { open: "2026-01-12", close: "2026-04-30" },
  "west chicago": { open: "2026-02-17", close: "2026-05-22" },
}

function getAppealWindowStatus(township: string | null): {
  township: string
  status: "open" | "closed" | "unknown"
  openDate: string | null
  closeDate: string | null
  filingUrl: string
  note: string | null
} {
  const filingUrl = "https://www.cookcountyassessoril.gov/online-appeals"
  if (!township) {
    return { township: "Unknown", status: "unknown", openDate: null, closeDate: null, filingUrl, note: null }
  }
  const key = township.toLowerCase().replace(/\s*township$/i, "").trim()
  const window = TOWNSHIP_APPEAL_WINDOWS[key]
  if (!window) {
    return { township, status: "unknown", openDate: null, closeDate: null, filingUrl, note: `Check ${filingUrl} for your township's exact appeal dates.` }
  }
  const today = new Date()
  const open = new Date(window.open)
  const close = new Date(window.close)
  const status: "open" | "closed" = today >= open && today <= close ? "open" : "closed"
  return { township, status, openDate: window.open, closeDate: window.close, filingUrl, note: "Dates are approximate — verify at cookcountyassessoril.gov" }
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
  equityRatio: number | null,
  potentialOverpaymentPerYear: number
): string {
  const gap = subjectAV - avgCompAV
  const targetAV = avgCompAV
  const mvStr = marketValue ? formatCurrencyShort(marketValue) : "estimated market value"
  const ratioStr = equityRatio != null ? `${equityRatio.toFixed(1)}%` : "above"
  const townshipStr = township ? `${township} township` : "this neighborhood"
  const nbhdStr = neighborhoodCode ? ` (CCAO neighborhood ${neighborhoodCode})` : ""

  return `The subject property at ${address}, ${city}${nbhdStr} has been assessed at $${subjectAV.toLocaleString()}, resulting in an equity ratio of ${ratioStr} — above Cook County's 10% target.

Comparable properties in ${townshipStr} average $${Math.round(avgCompAV).toLocaleString()} in assessed value, consistent with a 10% equity ratio.

Under Illinois law (35 ILCS 200/9-5) and the Cook County Assessor's rules, property assessments should reflect 10% of fair market value and be uniform with comparable properties. This property's assessment exceeds comparable properties by approximately $${Math.round(gap).toLocaleString()}, resulting in an estimated overpayment of $${potentialOverpaymentPerYear.toLocaleString()}/year.

We request a reduction in the assessed value to $${Math.round(targetAV).toLocaleString()}, consistent with the ${mvStr} market value and comparable properties in the neighborhood.`
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const pinRaw = typeof body.pin === "string" ? body.pin.trim() : ""
    const address = typeof body.address === "string" ? body.address.trim() : ""
    const city = typeof body.city === "string" ? body.city.trim() : ""

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
    } else if (address.length >= 5) {
      const search = await searchPropertiesByAddress(address, city || undefined, 5)
      if (!search.success || !search.data?.length) {
        return NextResponse.json(
          { error: "No Cook County property found for this address. Try your 14-digit PIN instead." },
          { status: 400 }
        )
      }
      const first = search.data[0]
      const pin = String(first.pin ?? "").replace(/\D/g, "")
      if (!pin || pin.length !== 14) {
        return NextResponse.json(
          { error: "Could not resolve address to a valid PIN. Try entering your PIN from the Assessor site." },
          { status: 400 }
        )
      }
      const res = await getPropertyByPIN(pin)
      if (res.success && res.data) propertyData = res.data
      else {
        return NextResponse.json(
          { error: res.error ?? "Could not load property details." },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { error: "Enter either a 14-digit Cook County PIN or a street address (at least 5 characters)." },
        { status: 400 }
      )
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

    // If no assessed value on file, return property info without overpayment estimate
    if (subjectAV <= 0) {
      return NextResponse.json({
        success: true,
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
        appealWindowStatus: getAppealWindowStatus(propertyData.township),
        propertyCharacteristics,
        noAssessedValue: true,
        message: "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. This can happen with recently transferred properties or during reassessment. Visit cookcountyassessor.com to check your assessment status.",
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

    // Average comp equity ratio — use comp market values if available
    const compEquityRatios: number[] = []
    compDetails.forEach((c) => {
      if (c.marketValue != null && c.marketValue > 0 && c.assessedValue > 0) {
        compEquityRatios.push(c.assessedValue / c.marketValue)
      }
    })
    const avgCompEquityRatio =
      compEquityRatios.length > 0
        ? Math.round((compEquityRatios.reduce((a, b) => a + b, 0) / compEquityRatios.length) * 1000) / 10
        : (avgCompAV != null ? 10.0 : null)  // CCAO target is 10%, use as default if no data

    const assessmentGap = avgCompAV != null ? Math.round(subjectAV - avgCompAV) : null

    // ── Overpayment estimate ─────────────────────────────────────────────────
    const taxRate = propertyData.taxRate ?? 0.07
    const equalizer = propertyData.stateEqualizer ?? 3.0
    const potentialOverpaymentPerYear =
      avgCompAV != null && subjectAV > avgCompAV
        ? Math.round((subjectAV - avgCompAV) * equalizer * taxRate)
        : 0

    // ── Appeal argument text ─────────────────────────────────────────────────
    const appealArgumentText =
      potentialOverpaymentPerYear > 0 && avgCompAV != null
        ? buildAppealArgument(
            propertyData.address,
            propertyData.city,
            subjectAV,
            avgCompAV,
            subjectMarketValue,
            propertyData.township,
            neighborhoodCode,
            equityRatio,
            potentialOverpaymentPerYear
          )
        : null

    return NextResponse.json({
      success: true,
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
      compCount: compValues.length,
      comps: compDetails,
      avgComparableAssessedValue: avgCompAV,
      equityRatio,
      targetEquityRatio: 10.0,
      avgCompEquityRatio,
      assessmentGap,
      potentialOverpaymentPerYear: potentialOverpaymentPerYear > 0 ? potentialOverpaymentPerYear : null,
      potentialOverpayment3Year: potentialOverpaymentPerYear > 0 ? potentialOverpaymentPerYear * 3 : null,
      appealArgumentText,
      appealWindowStatus: getAppealWindowStatus(propertyData.township),
      propertyCharacteristics,
      source: salesRes.source ?? "Cook County Open Data",
    })
  } catch (error) {
    console.error("[free-check] error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Try again or use your PIN from cookcountyassessor.com." },
      { status: 500 }
    )
  }
}
