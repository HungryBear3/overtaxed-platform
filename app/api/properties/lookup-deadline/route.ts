// GET /api/properties/lookup-deadline?pin=... - Look up township and appeal deadlines for a PIN
// Uses Cook County Open Data for township; matches to Assessor calendar for deadlines
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { getPropertyByPIN } from "@/lib/cook-county"
import { getTownshipDeadline, ASSESSOR_CALENDAR_URL } from "@/lib/appeals/township-deadlines"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const pin = request.nextUrl.searchParams.get("pin")
    if (!pin) {
      return NextResponse.json({ error: "PIN required" }, { status: 400 })
    }

    const result = await getPropertyByPIN(pin)
    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error || "Property not found for this PIN", township: null },
        { status: 404 }
      )
    }

    const township = result.data.township || null
    const deadlineInfo = getTownshipDeadline(township)

    return NextResponse.json({
      township,
      calendarUrl: ASSESSOR_CALENDAR_URL,
      noticeDate: deadlineInfo?.noticeDate ?? null,
      lastFileDate: deadlineInfo?.lastFileDate ?? null,
      note: deadlineInfo
        ? `Based on 2025 Assessor calendar for ${township}. Verify at the Assessor website.`
        : "Cook County appeal deadlines vary by township. Check the Assessor calendar for your township's appeal window.",
    })
  } catch (error) {
    console.error("Lookup deadline error:", error)
    return NextResponse.json(
      { error: "Failed to look up property" },
      { status: 500 }
    )
  }
}
