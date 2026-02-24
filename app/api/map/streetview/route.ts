// GET /api/map/streetview?lat=&lng=&size=200x150 - Proxy Google Street View Static API
// Uses metadata to compute heading so the camera faces the building (front-facing view).
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { getHeadingTowardBuilding } from "@/lib/map/streetview"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return new NextResponse(null, { status: 401 })
    }

    const key = process.env.GOOGLE_MAPS_API_KEY
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'streetview/route.ts:key',message:'streetview key check',data:{hasKey:!!key,lat:request.nextUrl.searchParams.get('lat'),lng:request.nextUrl.searchParams.get('lng')},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!key) {
      return new NextResponse(null, { status: 503 })
    }

    const lat = request.nextUrl.searchParams.get("lat")
    const lng = request.nextUrl.searchParams.get("lng")
    const size = request.nextUrl.searchParams.get("size") ?? "200x150"

    if (lat == null || lng == null) {
      return new NextResponse(null, { status: 400 })
    }
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return new NextResponse(null, { status: 400 })
    }

    // Get heading so camera faces the building (front of property)
    const heading = await getHeadingTowardBuilding(latNum, lngNum, key)

    const params = new URLSearchParams({
      size,
      location: `${latNum},${lngNum}`,
      source: "outdoor",
      key,
    })
    if (heading != null) {
      params.set("heading", String(Math.round(heading)))
    }
    const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
    const res = await fetch(url, { next: { revalidate: 0 } })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'streetview/route.ts:google',message:'streetview Google response',data:{ok:res.ok,status:res.status},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!res.ok) {
      return new NextResponse(null, { status: 502 })
    }
    const blob = await res.blob()
    return new NextResponse(blob, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    })
  } catch (error) {
    console.error("Error fetching Street View:", error)
    return new NextResponse(null, { status: 500 })
  }
}
