// GET /api/properties/[id]/comps - Fetch comparable sales for a property from Cook County or Realie Premium
import { NextRequest, NextResponse } from "next/server"

/** Allow up to 30s — comps flow calls Cook County + address enrichment + Realie (many external APIs). Vercel Hobby caps at 10s. */
export const maxDuration = 30
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getComparableSales, getComparableEquity, getAddressByPIN, formatPIN, haversineMiles } from "@/lib/cook-county"
import { propertyDataFromDb } from "@/lib/comps/property-data"
import { enrichCompsWithRealie } from "@/lib/comps/enrich-with-realie"
import { fetchRealieComparables, fetchRealieAddressLookup, parseUnitFromAddress } from "@/lib/realie"

const ADDRESS_ENRICH_CONCURRENCY = 5

type EnrichedAddress = {
  address: string
  city: string
  zipCode: string
  latitude: number | null
  longitude: number | null
}

async function enrichAddressesForPins(pins: string[]): Promise<Map<string, EnrichedAddress>> {
  const map = new Map<string, EnrichedAddress>()
  for (let i = 0; i < pins.length; i += ADDRESS_ENRICH_CONCURRENCY) {
    const batch = pins.slice(i, i + ADDRESS_ENRICH_CONCURRENCY)
    const results = await Promise.all(batch.map((pin) => getAddressByPIN(pin)))
    batch.forEach((pin, j) => {
      const addr = results[j]
      if (addr) map.set(pin, addr)
    })
  }
  return map
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    })

    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "20", 10), 1),
      50
    )
    const unitOverride = searchParams.get("unitNumber")?.trim() || null

    const propertyPin = property.pin.replace(/\D/g, "")
    const subjectEnriched = await getAddressByPIN(propertyPin)
    let subjectLat = subjectEnriched?.latitude ?? null
    let subjectLon = subjectEnriched?.longitude ?? null

    // Fallback: when Parcel Universe has no coords, try Realie Address Lookup (address + unit)
    if ((subjectLat == null || subjectLon == null) && !!process.env.REALIE_API_KEY && property.address?.trim()) {
      const unit = unitOverride ?? (property as { unitNumber?: string | null }).unitNumber ?? parseUnitFromAddress(property.address)
      const addrResult = await fetchRealieAddressLookup({
        state: property.state || "IL",
        address: property.address,
        unitNumberStripped: unit,
        city: property.city,
        county: property.county || "Cook",
      })
      if (addrResult.success) {
        subjectLat = addrResult.latitude
        subjectLon = addrResult.longitude
        console.log("[comps] Got coords from Realie Address Lookup", { propertyId: id })
      } else {
        const isCondoClass =
          property.buildingClass != null &&
          (property.buildingClass.startsWith("2") || property.buildingClass === "299")
        const hasNoUnit = !unit
        if (isCondoClass && hasNoUnit) {
          return NextResponse.json({
            success: false,
            needsUnitConfirmation: true,
            reason: "condo",
            error: "Unit number may be required for this address. Enter your unit (e.g. 2B) and try again.",
          }, { status: 200 })
        }
        console.log("[comps] Realie Address Lookup failed", { error: addrResult.error, propertyId: id })
      }
    }

    // Try Realie Premium Comparables when subject has lat/long (1 API call vs Cook County + 15 Realie)
    const realieAttempted = subjectLat != null && subjectLon != null && !!process.env.REALIE_API_KEY
    if (realieAttempted && subjectLat != null && subjectLon != null) {
      const realieResult = await fetchRealieComparables({
        latitude: subjectLat,
        longitude: subjectLon,
        radius: 1,
        timeFrame: 18,
        maxResults: limit,
        subjectPin: propertyPin,
      })
      if (realieResult.success && realieResult.comps.length > 0) {
        console.log("[comps] Using Realie Premium Comparables", { count: realieResult.comps.length, propertyId: id })
        const realieSales = realieResult.comps.map((c) => ({
          ...c,
          compType: "SALES" as const,
          inBothSources: true,
          assessedMarketValue: null as number | null,
          assessedMarketValuePerSqft: null as number | null,
        }))
        const subjectMarket =
          property.currentMarketValue != null
            ? parseFloat(String(property.currentMarketValue))
            : property.currentAssessmentValue != null
              ? parseFloat(String(property.currentAssessmentValue)) * 10
              : null
        realieSales.sort((a, b) => {
          const priceA = a.salePrice ?? Infinity
          const priceB = b.salePrice ?? Infinity
          if (subjectMarket != null && subjectMarket > 0) {
            const aSupportive = priceA <= subjectMarket * 1.15
            const bSupportive = priceB <= subjectMarket * 1.15
            if (aSupportive !== bSupportive) return aSupportive ? -1 : 1
          }
          return priceA - priceB
        })

        // Also fetch equity comps from Cook County (Realie only has sales)
        const propertyData = propertyDataFromDb(property)
        const equityResult = await getComparableEquity(propertyData, { limit: 10, livingAreaTolerancePercent: 25 })
        console.log('[comps] Realie path + equity', { equityCount: equityResult.data?.length ?? 0, equitySuccess: equityResult.success, propertyNeighborhood: propertyData.neighborhood })
        const salesPins = new Set(realieSales.map((c) => (c.pinRaw ?? c.pin).replace(/\D/g, "")))
        const equityData =
          equityResult.success && equityResult.data
            ? equityResult.data.filter((e) => !salesPins.has(e.pin))
            : []

        const equityPins = equityData.map((e) => e.pin)
        const allPins = [...realieSales.map((c) => (c.pinRaw ?? c.pin).replace(/\D/g, "")), ...equityPins]
        const addressByPin = await enrichAddressesForPins([...new Set(allPins)])

        const equityComps = equityData.map((e) => {
          const enriched = addressByPin.get(e.pin)
          const compLat = enriched?.latitude ?? null
          const compLon = enriched?.longitude ?? null
          const distanceFromSubject =
            subjectLat != null && subjectLon != null && compLat != null && compLon != null
              ? haversineMiles(subjectLat, subjectLon, compLat, compLon)
              : null
          return {
            pin: formatPIN(e.pin),
            pinRaw: e.pin,
            compType: "EQUITY" as const,
            inBothSources: false,
            address: enriched?.address ?? (e.address || `PIN ${formatPIN(e.pin)}`),
            city: enriched?.city ?? e.city ?? "",
            zipCode: enriched?.zipCode ?? e.zipCode ?? "",
            neighborhood: e.neighborhood,
            saleDate: null as string | null,
            salePrice: null as number | null,
            pricePerSqft: e.assessedMarketValuePerSqft,
            buildingClass: e.buildingClass,
            livingArea: e.livingArea,
            yearBuilt: e.yearBuilt,
            bedrooms: e.bedrooms,
            bathrooms: e.bathrooms,
            dataSource: e.dataSource,
            distanceFromSubject,
            assessedMarketValue: e.assessedMarketValue,
            assessedMarketValuePerSqft: e.assessedMarketValuePerSqft,
          }
        })

        const comps = [...realieSales, ...equityComps]
        const source =
          equityComps.length > 0
            ? `Realie Premium Comparables; ${equityResult.source}`
            : "Realie Premium Comparables"

        return NextResponse.json({
          success: true,
          comps,
          source,
        })
      } else if (!realieResult.success) {
        console.log("[comps] Realie Premium skipped", { error: realieResult.error, propertyId: id })
      } else {
        console.log("[comps] Realie Premium returned 0 comps, falling back to Cook County", { propertyId: id })
      }
    } else if (subjectLat == null || subjectLon == null) {
      console.log("[comps] Realie Premium skipped: no subject lat/long from Parcel Universe", { propertyId: id })
    }

    // Fall back to Cook County: fetch both sales and equity comps (Rule 15: 3 sales, 5 equity)
    const propertyData = propertyDataFromDb(property)
    const [salesResult, equityResult] = await Promise.all([
      getComparableSales(propertyData, {
        limit: Math.min(limit, 15),
        livingAreaTolerancePercent: 25,
        yearBuiltTolerance: 10,
      }),
      getComparableEquity(propertyData, {
        limit: 10,
        livingAreaTolerancePercent: 25,
      }),
    ])

    if (!salesResult.success || !salesResult.data) {
      return NextResponse.json(
        { error: salesResult.error ?? "Failed to fetch comps" },
        { status: 500 }
      )
    }

    const salesPins = new Set(salesResult.data.map((s) => s.pin))
    const equityData =
      equityResult.success && equityResult.data
        ? equityResult.data.filter((e) => !salesPins.has(e.pin))
        : []
    console.log('[comps] Cook County path', { salesCount: salesResult.data.length, equityRaw: equityResult.data?.length ?? 0, equityAfterDedup: equityData.length, propertyNeighborhood: propertyData.neighborhood })

    const allPins = [...salesResult.data.map((s) => s.pin), ...equityData.map((e) => e.pin)]
    const uniquePins = [...new Set(allPins)]
    const addressByPin = await enrichAddressesForPins(uniquePins)

    const salesComps = salesResult.data.map((s) => {
      const enriched = addressByPin.get(s.pin)
      const compLat = enriched?.latitude ?? null
      const compLon = enriched?.longitude ?? null
      const distanceFromSubject =
        subjectLat != null && subjectLon != null && compLat != null && compLon != null
          ? haversineMiles(subjectLat, subjectLon, compLat, compLon)
          : null
      return {
        pin: formatPIN(s.pin),
        pinRaw: s.pin,
        compType: "SALES" as const,
        address: enriched?.address ?? (s.address || `PIN ${formatPIN(s.pin)}`),
        city: enriched?.city ?? s.city ?? "",
        zipCode: enriched?.zipCode ?? s.zipCode ?? "",
        neighborhood: s.neighborhood,
        saleDate: s.saleDate instanceof Date ? s.saleDate.toISOString() : (s.saleDate ?? null),
        salePrice: s.salePrice,
        pricePerSqft: s.pricePerSqft,
        buildingClass: s.buildingClass,
        livingArea: s.livingArea,
        yearBuilt: s.yearBuilt,
        bedrooms: s.bedrooms,
        bathrooms: s.bathrooms,
        dataSource: s.dataSource,
        distanceFromSubject,
        assessedMarketValue: (s as { assessedMarketValue?: number | null }).assessedMarketValue ?? null,
        assessedMarketValuePerSqft: (s as { assessedMarketValuePerSqft?: number | null }).assessedMarketValuePerSqft ?? null,
      }
    })

    const equityComps = equityData.map((e) => {
      const enriched = addressByPin.get(e.pin)
      const compLat = enriched?.latitude ?? null
      const compLon = enriched?.longitude ?? null
      const distanceFromSubject =
        subjectLat != null && subjectLon != null && compLat != null && compLon != null
          ? haversineMiles(subjectLat, subjectLon, compLat, compLon)
          : null
      return {
        pin: formatPIN(e.pin),
        pinRaw: e.pin,
        compType: "EQUITY" as const,
        address: enriched?.address ?? (e.address || `PIN ${formatPIN(e.pin)}`),
        city: enriched?.city ?? e.city ?? "",
        zipCode: enriched?.zipCode ?? e.zipCode ?? "",
        neighborhood: e.neighborhood,
        saleDate: null as string | null,
        salePrice: null as number | null,
        pricePerSqft: e.assessedMarketValuePerSqft,
        buildingClass: e.buildingClass,
        livingArea: e.livingArea,
        yearBuilt: e.yearBuilt,
        bedrooms: e.bedrooms,
        bathrooms: e.bathrooms,
        dataSource: e.dataSource,
        distanceFromSubject,
        assessedMarketValue: e.assessedMarketValue,
        assessedMarketValuePerSqft: e.assessedMarketValuePerSqft,
      }
    })

    const countyComps = [...salesComps, ...equityComps]
    let comps = await enrichCompsWithRealie(countyComps, { maxRealie: 15 })

    // Sort: sales first (by sale price), then equity (by assessed $/sqft). Most supportive first.
    const subjectMarket =
      property.currentMarketValue != null
        ? parseFloat(String(property.currentMarketValue))
        : property.currentAssessmentValue != null
          ? parseFloat(String(property.currentAssessmentValue)) * 10
          : null
    comps = [...comps].sort((a, b) => {
      const aSales = a.compType === "SALES"
      const bSales = b.compType === "SALES"
      if (aSales && !bSales) return -1
      if (!aSales && bSales) return 1
      if (aSales && bSales) {
        const priceA = a.salePrice ?? Infinity
        const priceB = b.salePrice ?? Infinity
        if (subjectMarket != null && subjectMarket > 0) {
          const aSupportive = priceA <= subjectMarket * 1.15
          const bSupportive = priceB <= subjectMarket * 1.15
          if (aSupportive !== bSupportive) return aSupportive ? -1 : 1
        }
        return priceA - priceB
      }
      const valA = a.assessedMarketValuePerSqft ?? Infinity
      const valB = b.assessedMarketValuePerSqft ?? Infinity
      return valA - valB
    })

    const source = equityData.length > 0
      ? `${salesResult.source}; ${equityResult.source}`
      : salesResult.source

    return NextResponse.json({
      success: true,
      comps,
      source,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Error fetching comps:", error)
    return NextResponse.json(
      { error: "Failed to fetch comparable properties", detail: msg },
      { status: 500 }
    )
  }
}
