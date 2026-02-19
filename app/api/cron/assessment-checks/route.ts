// Cron endpoint for automated assessment checks.
// Run periodically (e.g. monthly) via Vercel Cron or external scheduler: GET /api/cron/assessment-checks
import { NextRequest, NextResponse } from "next/server"
import { runAssessmentChecks } from "@/lib/monitoring/assessment-check"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = await runAssessmentChecks()
  const updated = results.filter((r) => r.updated).length
  const increases = results.filter((r) => r.increaseDetected).length
  const errors = results.filter((r) => r.error).length

  return NextResponse.json({
    success: true,
    propertiesChecked: results.length,
    updated,
    increasesDetected: increases,
    errors,
    results: results.map((r) => ({
      propertyId: r.propertyId,
      pin: r.pin,
      updated: r.updated,
      newYears: r.newYears,
      increaseDetected: r.increaseDetected,
      error: r.error,
    })),
  })
}
