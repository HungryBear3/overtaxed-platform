// GET /api/properties/[id]/comps - Fetch comparable sales for a property from Cook County
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getComparableSales } from "@/lib/cook-county"
import { formatPIN } from "@/lib/cook-county"
import { propertyDataFromDb } from "@/lib/comps/property-data"

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

    const comps = result.data.map((s) => ({
      pin: formatPIN(s.pin),
      pinRaw: s.pin,
      address: s.address || `PIN ${formatPIN(s.pin)}`,
      city: s.city,
      zipCode: s.zipCode,
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
    }))

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
