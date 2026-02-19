// GET /api/properties/[id]/comps - Fetch comparable sales for a property from Cook County
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getComparableSales, getAddressByPIN, formatPIN, haversineMiles } from "@/lib/cook-county"
import { propertyDataFromDb } from "@/lib/comps/property-data"
import { enrichCompsWithRealie } from "@/lib/comps/enrich-with-realie"

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

    const propertyData = propertyDataFromDb(property)
    const result = await getComparableSales(propertyData, {
      limit,
      livingAreaTolerancePercent: 25,
      yearBuiltTolerance: 10,
    })

    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch comps" },
        { status: 500 }
      )
    }

    const uniquePins = [...new Set(result.data.map((s) => s.pin))]
    const subjectEnriched = await getAddressByPIN(property.pin.replace(/\D/g, ""))
    const addressByPin = await enrichAddressesForPins(uniquePins)

    const subjectLat = subjectEnriched?.latitude ?? null
    const subjectLon = subjectEnriched?.longitude ?? null

    const countyComps = result.data.map((s) => {
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
        address: enriched?.address ?? (s.address || `PIN ${formatPIN(s.pin)}`),
        city: enriched?.city ?? s.city ?? "",
        zipCode: enriched?.zipCode ?? s.zipCode ?? "",
        neighborhood: s.neighborhood,
        saleDate: s.saleDate,
        salePrice: s.salePrice,
        pricePerSqft: s.pricePerSqft,
        buildingClass: s.buildingClass,
        livingArea: s.livingArea,
        yearBuilt: s.yearBuilt,
        bedrooms: s.bedrooms,
        bathrooms: s.bathrooms,
        dataSource: s.dataSource,
        distanceFromSubject,
      }
    })

    const comps = await enrichCompsWithRealie(countyComps, { maxRealie: 15 })

    return NextResponse.json({
      success: true,
      comps,
      source: result.source,
    })
  } catch (error) {
    console.error("Error fetching comps:", error)
    return NextResponse.json(
      { error: "Failed to fetch comparable properties" },
      { status: 500 }
    )
  }
}
