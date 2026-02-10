// GET /api/map/streetview?lat=&lng=&size=200x150 - Proxy Google Street View Static API
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return new NextResponse(null, { status: 401 })
    }

    const key = process.env.GOOGLE_MAPS_API_KEY
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

    const params = new URLSearchParams({
      size,
      location: `${latNum},${lngNum}`,
      key,
    })
    const url = `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`
    const res = await fetch(url, { next: { revalidate: 0 } })
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
