// GET /api/appeals/[id]/map-data - Lat/lng for subject + comps (for map and Street View)
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const appeal = await prisma.appeal.findFirst({
      where: { id, userId: session.user.id },
      select: {
        property: { select: { pin: true, address: true } },
        compsUsed: { orderBy: { createdAt: "asc" }, select: { pin: true, address: true } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    const subjectPin = appeal.property.pin.replace(/\D/g, "") || appeal.property.pin
    const subjectAddr = await getAddressByPIN(subjectPin)
    const subject =
      subjectAddr?.latitude != null && subjectAddr?.longitude != null
        ? {
            lat: subjectAddr.latitude,
            lng: subjectAddr.longitude,
            address: subjectAddr.address || appeal.property.address,
          }
        : null

    const compPins = appeal.compsUsed.map((c) => c.pin.replace(/\D/g, "") || c.pin)
    const comps: Array<{ pin: string; address: string; lat: number; lng: number } | null> = []
    for (let i = 0; i < compPins.length; i += ENRICH_CONCURRENCY) {
      const batch = compPins.slice(i, i + ENRICH_CONCURRENCY)
      const results = await Promise.all(batch.map((pin) => getAddressByPIN(pin)))
      batch.forEach((_pin, j) => {
        const addr = results[j]
        const comp = appeal.compsUsed[i + j]
        if (addr?.latitude != null && addr?.longitude != null && comp) {
          comps.push({
            pin: comp.pin,
            address: addr.address || comp.address,
            lat: addr.latitude,
            lng: addr.longitude,
          })
        } else {
          comps.push(null)
        }
      })
    }

    return NextResponse.json({
      success: true,
      subject,
      comps,
    })
  } catch (error) {
    console.error("Error fetching appeal map data:", error)
    return NextResponse.json(
      { error: "Failed to load map data" },
      { status: 500 }
    )
  }
}
