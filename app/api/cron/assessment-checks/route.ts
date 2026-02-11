// Cron endpoint for automated assessment checks.
// Schedule-gated: only runs during reassessment season (Jan–Aug) and only for
// properties in townships with active appeal windows. Run weekly via Vercel Cron.
import { NextRequest, NextResponse } from "next/server"
import { runAssessmentChecks } from "@/lib/monitoring/assessment-check"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const run = await runAssessmentChecks()
  const { results, skipped, skipReason, propertiesChecked } = run

  if (skipped) {
    return NextResponse.json({
      success: true,
      skipped: true,
      skipReason,
      propertiesChecked: 0,
    })
  }

  const updated = results.filter((r) => r.updated).length
  const increases = results.filter((r) => r.increaseDetected).length
  const errors = results.filter((r) => r.error).length

  return NextResponse.json({
    success: true,
    skipped: false,
    propertiesChecked,
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
