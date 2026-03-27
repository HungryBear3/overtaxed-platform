/**
 * Free assessment check (top-of-funnel). No auth required.
 * POST: { pin?: string, address?: string, city?: string }
 * Returns: subject property, up to 3 comps summary, avg comp value, potential overpayment/year.
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
          assessedTotalValue: null,
          marketValue: null,
        },
        compCount: 0,
        avgComparableAssessedValue: null,
        potentialOverpaymentPerYear: null,
        potentialOverpayment3Year: null,
        noAssessedValue: true,
        message: "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. This can happen with recently transferred properties or during reassessment. Visit cookcountyassessor.com to check your assessment status.",
        source: "Cook County Open Data",
      })
    }

    const [salesRes, equityRes] = await Promise.all([
      getComparableSales(propertyData, { limit: 5, livingAreaTolerancePercent: 30, yearBuiltTolerance: 15 }),
      getComparableEquity(propertyData, { limit: 5, livingAreaTolerancePercent: 30, yearBuiltTolerance: 15 }),
    ])

    const sales = salesRes.success && salesRes.data ? salesRes.data : []
    const equity = equityRes.success && equityRes.data ? equityRes.data : []

    const compValues: number[] = []
    sales.slice(0, 3).forEach((s) => {
      const av = getCompAssessedValue(s)
      if (av != null) compValues.push(av)
    })
    if (compValues.length < 3) {
      equity.forEach((e) => {
        if (compValues.length >= 3) return
        const av = getEquityAssessedValue(e)
        if (av != null) compValues.push(av)
      })
    }

    const avgCompAV = compValues.length > 0
      ? compValues.reduce((a, b) => a + b, 0) / compValues.length
      : null

    const taxRate = propertyData.taxRate ?? 0.07
    const equalizer = propertyData.stateEqualizer ?? 3.0
    const potentialOverpaymentPerYear =
      avgCompAV != null && subjectAV > avgCompAV
        ? Math.round((subjectAV - avgCompAV) * equalizer * taxRate)
        : 0

    return NextResponse.json({
      success: true,
      subject: {
        pin: formatPIN(propertyData.pin),
        address: propertyData.address,
        city: propertyData.city,
        zipCode: propertyData.zipCode,
        township: propertyData.township,
        assessedTotalValue: subjectAV,
        marketValue: propertyData.marketValue,
      },
      compCount: compValues.length,
      avgComparableAssessedValue: avgCompAV,
      potentialOverpaymentPerYear: potentialOverpaymentPerYear > 0 ? potentialOverpaymentPerYear : null,
      potentialOverpayment3Year:
        potentialOverpaymentPerYear > 0 ? potentialOverpaymentPerYear * 3 : null,
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
