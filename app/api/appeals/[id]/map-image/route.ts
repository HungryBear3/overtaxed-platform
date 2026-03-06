// GET /api/appeals/[id]/map-image - Static map image (subject + comp markers), proxies Google Static Maps
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getAddressByPIN } from "@/lib/cook-county"

const ENRICH_CONCURRENCY = 5

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(_request)
    if (!session?.user) {
      return new NextResponse(null, { status: 401 })
    }

    const key = process.env.GOOGLE_MAPS_API_KEY
    if (!key) {
      return new NextResponse(null, { status: 503 })
    }

    const { id } = await params
    const appeal = await prisma.appeal.findFirst({
      where: { id, userId: session.user.id },
      select: {
        property: { select: { pin: true } },
        compsUsed: { orderBy: { createdAt: "asc" }, select: { pin: true } },
      },
    })

    if (!appeal) {
      return new NextResponse(null, { status: 404 })
    }

    const subjectPin = appeal.property.pin.replace(/\D/g, "") || appeal.property.pin
    const subjectAddr = await getAddressByPIN(subjectPin)
    const compPins = appeal.compsUsed.map((c) => c.pin.replace(/\D/g, "") || c.pin)
    const compAddrs: Array<{ latitude: number; longitude: number } | null> = []
    for (let i = 0; i < compPins.length; i += ENRICH_CONCURRENCY) {
      const batch = compPins.slice(i, i + ENRICH_CONCURRENCY)
      const results = await Promise.all(batch.map((pin) => getAddressByPIN(pin)))
      compAddrs.push(
        ...results.map((r) =>
          r?.latitude != null && r?.longitude != null
            ? { latitude: r.latitude, longitude: r.longitude }
            : null
        )
      )
    }

    // Collect all points (subject + comps) to compute center and zoom that fit all markers
    const points: Array<{ lat: number; lng: number }> = []
    if (subjectAddr?.latitude != null && subjectAddr?.longitude != null) {
      points.push({ lat: subjectAddr.latitude, lng: subjectAddr.longitude })
    }
    compAddrs.forEach((c) => {
      if (c) points.push({ lat: c.latitude, lng: c.longitude })
    })

    const WORLD_DIM = 256
    const MAP_WIDTH = 600
    const MAP_HEIGHT = 400
    let centerLat = 41.8781
    let centerLng = -87.6298
    let zoom = 14

    if (points.length > 0) {
      const lats = points.map((p) => p.lat)
      const lngs = points.map((p) => p.lng)
      const minLat = Math.min(...lats)
      const maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs)
      const maxLng = Math.max(...lngs)
      centerLat = (minLat + maxLat) / 2
      centerLng = (minLng + maxLng) / 2
      const latSpan = Math.max(maxLat - minLat, 0.002)
      const lngSpan = Math.max(maxLng - minLng, 0.002)
      // Zoom so bounds fit in MAP_WIDTH x MAP_HEIGHT with padding (zoom out 1 level so no markers clipped)
      const zLng = Math.log2((MAP_WIDTH * 360) / (WORLD_DIM * lngSpan))
      const zLat = Math.log2((MAP_HEIGHT * 180) / (WORLD_DIM * latSpan))
      zoom = Math.max(0, Math.min(21, Math.floor(Math.min(zLng, zLat)) - 1))
    }

    const paramsList = new URLSearchParams({
      center: `${centerLat},${centerLng}`,
      zoom: String(zoom),
      size: `${MAP_WIDTH}x${MAP_HEIGHT}`,
      maptype: "roadmap",
      key,
    })
    if (
      subjectAddr?.latitude != null &&
      subjectAddr?.longitude != null
    ) {
      paramsList.append(
        "markers",
        `color:red|label:S|${subjectAddr.latitude},${subjectAddr.longitude}`
      )
    }
    compAddrs.forEach((c, i) => {
      if (c) {
        paramsList.append(
          "markers",
          `color:blue|label:${i + 1}|${c.latitude},${c.longitude}`
        )
      }
    })

    const url = `https://maps.googleapis.com/maps/api/staticmap?${paramsList.toString()}`
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      return new NextResponse(null, { status: 502 })
    }
    const blob = await res.blob()
    return new NextResponse(blob, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating map image:", error)
    return new NextResponse(null, { status: 500 })
  }
}
