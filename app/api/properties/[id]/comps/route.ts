// GET /api/properties/[id]/comps - Fetch comparable sales for a property from Cook County
import { NextRequest, NextResponse } from "next/server"

/** Allow up to 30s — comps flow calls Cook County + address enrichment + Realie (many external APIs). Vercel Hobby caps at 10s. */
export const maxDuration = 30
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:entry',message:'comps GET entry',data:{hypothesisId:'A'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const session = await getSession(request)
    if (!session?.user) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:no-session',message:'Unauthorized',data:{hypothesisId:'A'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    const property = await prisma.property.findFirst({
      where: { id, userId: session.user.id },
    })

    if (!property) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:property-not-found',message:'Property not found',data:{propertyId:id,hypothesisId:'B'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return NextResponse.json({ error: "Property not found" }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "20", 10), 1),
      50
    )

    const propertyData = propertyDataFromDb(property)
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:before-getComparableSales',message:'About to call Cook County getComparableSales',data:{propertyId:id,pin:propertyData.pin,neighborhood:propertyData.neighborhood,buildingClass:propertyData.buildingClass,limit,hypothesisId:'C'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const result = await getComparableSales(propertyData, {
      limit,
      livingAreaTolerancePercent: 25,
      yearBuiltTolerance: 10,
    })

    if (!result.success || !result.data) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:getComparableSales-failed',message:'getComparableSales failed',data:{propertyId:id,error:result.error,source:result.source,hypothesisId:'C'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch comps" },
        { status: 500 }
      )
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:getComparableSales-ok',message:'getComparableSales succeeded',data:{propertyId:id,compsCount:result.data.length,hypothesisId:'C'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:before-enrichRealie',message:'About to call enrichCompsWithRealie',data:{propertyId:id,countyCompsCount:countyComps.length,hypothesisId:'D'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let comps = await enrichCompsWithRealie(countyComps, { maxRealie: 15 })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:after-enrichRealie',message:'enrichCompsWithRealie succeeded',data:{propertyId:id,compsCount:comps.length,hypothesisId:'D'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Sort: most supportive comps first (lower sale price supports a lower assessment).
    // Subject market value = currentMarketValue or assessed × 10.
    const subjectMarket =
      property.currentMarketValue != null
        ? parseFloat(String(property.currentMarketValue))
        : property.currentAssessmentValue != null
          ? parseFloat(String(property.currentAssessmentValue)) * 10
          : null
    comps = [...comps].sort((a, b) => {
      const priceA = a.salePrice ?? Infinity
      const priceB = b.salePrice ?? Infinity
      if (subjectMarket != null && subjectMarket > 0) {
        const aSupportive = priceA <= subjectMarket * 1.15
        const bSupportive = priceB <= subjectMarket * 1.15
        if (aSupportive !== bSupportive) return aSupportive ? -1 : 1
      }
      return priceA - priceB
    })

    return NextResponse.json({
      success: true,
      comps,
      source: result.source,
    })
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f164df'},body:JSON.stringify({sessionId:'f164df',location:'comps/route.ts:GET:catch',message:'Caught exception',data:{errorMsg:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,hypothesisId:'E'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Error fetching comps:", error)
    return NextResponse.json(
      { error: "Failed to fetch comparable properties", detail: msg },
      { status: 500 }
    )
  }
}
