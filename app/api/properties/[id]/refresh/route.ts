// POST /api/properties/[id]/refresh - Re-fetch property data from Cook County and update DB
// Helps when assessment value was missing (e.g. condos) or data is stale
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getPropertyByPIN } from "@/lib/cook-county"
import type { AssessmentHistoryRecord } from "@/lib/cook-county/types"

const ASSESSMENT_CHECK_SOURCE = "Cook County Open Data (manual refresh)"

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

    const api = await getPropertyByPIN(property.pin)
    if (!api.success || !api.data) {
      return NextResponse.json(
        { error: api.error ?? "Property not found in Cook County records" },
        { status: 404 }
      )
    }

    const history = (api.data.assessmentHistory ?? []) as AssessmentHistoryRecord[]
    const sorted = [...history].sort((a, b) => b.year - a.year)

    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i]
      const prev = sorted[i + 1]
      const prevVal = prev?.assessedTotalValue ?? null
      const currVal = rec.assessedTotalValue ?? 0
      let changeAmount: number | null = null
      let changePercent: number | null = null
      if (prevVal != null && prevVal > 0) {
        changeAmount = currVal - prevVal
        changePercent = (changeAmount / prevVal) * 100
      }

      await prisma.assessmentHistory.upsert({
        where: { propertyId_taxYear: { propertyId: id, taxYear: rec.year } },
        create: {
          propertyId: id,
          taxYear: rec.year,
          assessmentValue: currVal,
          landValue: rec.assessedLandValue,
          improvementValue: rec.assessedBuildingValue,
          marketValue: rec.marketValue,
          changeAmount,
          changePercent,
          source: ASSESSMENT_CHECK_SOURCE,
        },
        update: {
          assessmentValue: currVal,
          landValue: rec.assessedLandValue,
          improvementValue: rec.assessedBuildingValue,
          marketValue: rec.marketValue,
          changeAmount,
          changePercent,
          source: ASSESSMENT_CHECK_SOURCE,
        },
      })
    }

    const updateData: {
      lastCheckedAt: Date
      currentAssessmentValue?: number | null
      currentLandValue?: number | null
      currentImprovementValue?: number | null
      currentMarketValue?: number | null
      address?: string
      city?: string
      zipCode?: string
      neighborhood?: string | null
    } = {
      lastCheckedAt: new Date(),
    }

    // Set current assessment from latest history year, or fallback to API snapshot (assessedTotalValue)
    const latestFromHistory = sorted.length > 0 ? sorted[0] : null
    const assessmentValue =
      (latestFromHistory?.assessedTotalValue != null && latestFromHistory.assessedTotalValue > 0)
        ? latestFromHistory.assessedTotalValue
        : (api.data.assessedTotalValue != null && api.data.assessedTotalValue > 0)
          ? api.data.assessedTotalValue
          : latestFromHistory?.assessedTotalValue ?? api.data.assessedTotalValue ?? null

    updateData.currentAssessmentValue = assessmentValue ?? null
    if (latestFromHistory) {
      updateData.currentLandValue = latestFromHistory.assessedLandValue ?? null
      updateData.currentImprovementValue = latestFromHistory.assessedBuildingValue ?? null
      updateData.currentMarketValue = latestFromHistory.marketValue ?? null
    } else if (api.data.assessedLandValue != null || api.data.assessedBuildingValue != null || api.data.marketValue != null) {
      updateData.currentLandValue = api.data.assessedLandValue ?? null
      updateData.currentImprovementValue = api.data.assessedBuildingValue ?? null
      updateData.currentMarketValue = api.data.marketValue ?? null
    }

    if (api.data.address) updateData.address = api.data.address
    if (api.data.city) updateData.city = api.data.city
    if (api.data.zipCode) updateData.zipCode = api.data.zipCode
    if (api.data.neighborhood != null) updateData.neighborhood = api.data.neighborhood

    await prisma.property.update({ where: { id }, data: updateData })

    return NextResponse.json({
      success: true,
      message: "Property data refreshed",
      yearsUpdated: sorted.map((r) => r.year),
    })
  } catch (error) {
    console.error("Property refresh error:", error)
    return NextResponse.json(
      { error: "Failed to refresh property data" },
      { status: 500 }
    )
  }
}
