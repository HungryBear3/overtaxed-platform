// GET /api/properties/lookup-deadline?pin=... - Look up township and appeal deadlines for a PIN
// Uses Cook County Open Data for township; matches to Assessor calendar for deadlines
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { getPropertyByPIN } from "@/lib/cook-county"
import { ASSESSOR_CALENDAR_URL, projectTownshipDeadline } from "@/lib/appeals/township-deadlines"
import {
  RESOLUTION_SOURCE,
  normalizePin,
  townshipKeyFromName,
} from "@/lib/deadlines/township-resolution"

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
    const normalizedPin = normalizePin(pin)

    // The PIN resolved to an official property record, so this is the
    // eligibility tier rather than a page describing a calendar. The record is
    // what establishes the township; the canonical state decides whether any
    // date may be named for it.
    const evaluatedAt = new Date().toISOString()
    const projection = township && normalizedPin
      ? projectTownshipDeadline({
          township: {
            inputKind: "pin",
            normalizedPin,
            normalizedAddress: null,
            townshipKey: townshipKeyFromName(township),
            townshipName: township,
            resolutionSource: RESOLUTION_SOURCE,
            resolvedAt: evaluatedAt,
          },
          at: evaluatedAt,
        })
      : null

    return NextResponse.json({
      township,
      calendarUrl: ASSESSOR_CALENDAR_URL,
      noticeDate: projection?.available ? projection.noticeDate : null,
      lastFileDate: projection?.available ? projection.lastFileDate : null,
      note: projection?.available
        ? `Official Cook County Assessor calendar for ${projection.townshipName}, retrieved ${projection.retrievedAt}. Verify at the Assessor website before filing.`
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
