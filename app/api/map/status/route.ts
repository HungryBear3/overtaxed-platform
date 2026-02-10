// GET /api/map/status - Whether map/Street View are available (GOOGLE_MAPS_API_KEY set)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const available = !!process.env.GOOGLE_MAPS_API_KEY
    return NextResponse.json({ available })
  } catch {
    return NextResponse.json({ available: false })
  }
}
