// POST /api/properties/[id]/refresh - Re-fetch property data from Cook County and update DB
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { refreshPropertyFromCookCounty } from "@/lib/properties/refresh-from-cook-county"

export async function POST(
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

    const result = await refreshPropertyFromCookCounty(id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Property data refreshed",
      yearsUpdated: result.yearsUpdated,
    })
  } catch (error) {
    console.error("Property refresh error:", error)
    return NextResponse.json(
      { error: "Failed to refresh property data" },
      { status: 500 }
    )
  }
}
