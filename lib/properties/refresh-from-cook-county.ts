/**
 * Shared logic to refresh a property's data from Cook County Open Data.
 * Used by: POST /api/properties/[id]/refresh and after POST /api/properties (add).
 * Callers are responsible for auth (refresh route checks session; add route owns the new property).
 */
import { prisma } from "@/lib/db"
import { getPropertyByPIN } from "@/lib/cook-county"
import type { AssessmentHistoryRecord } from "@/lib/cook-county/types"

const ASSESSMENT_CHECK_SOURCE = "Cook County Open Data (refresh)"

export interface RefreshResult {
  success: true
  yearsUpdated: number[]
}

export interface RefreshError {
  success: false
  error: string
}

export async function refreshPropertyFromCookCounty(
  propertyId: string
): Promise<RefreshResult | RefreshError> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
  })

  if (!property) {
    return { success: false, error: "Property not found" }
  }

  const api = await getPropertyByPIN(property.pin)
  if (!api.success || !api.data) {
    return {
      success: false,
      error: api.error ?? "Property not found in Cook County records",
    }
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
      where: { propertyId_taxYear: { propertyId, taxYear: rec.year } },
      create: {
        propertyId,
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

  const latestWithValue = sorted.find(
    (r) => r.assessedTotalValue != null && r.assessedTotalValue > 0
  )
  const latestFromHistory = sorted.length > 0 ? sorted[0] : null
  const sourceRecord = latestWithValue ?? latestFromHistory
  const assessmentValue =
    sourceRecord?.assessedTotalValue != null && sourceRecord.assessedTotalValue > 0
      ? sourceRecord.assessedTotalValue
      : api.data.assessedTotalValue != null && api.data.assessedTotalValue > 0
        ? api.data.assessedTotalValue
        : sourceRecord?.assessedTotalValue ?? api.data.assessedTotalValue ?? null

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
    currentAssessmentValue: assessmentValue != null ? assessmentValue : null,
  }

  if (sourceRecord) {
    updateData.currentLandValue = sourceRecord.assessedLandValue ?? null
    updateData.currentImprovementValue = sourceRecord.assessedBuildingValue ?? null
    updateData.currentMarketValue = sourceRecord.marketValue ?? null
  } else if (
    api.data.assessedLandValue != null ||
    api.data.assessedBuildingValue != null ||
    api.data.marketValue != null
  ) {
    updateData.currentLandValue = api.data.assessedLandValue ?? null
    updateData.currentImprovementValue = api.data.assessedBuildingValue ?? null
    updateData.currentMarketValue = api.data.marketValue ?? null
  }

  if (api.data.address) updateData.address = api.data.address
  if (api.data.city) updateData.city = api.data.city
  if (api.data.zipCode) updateData.zipCode = api.data.zipCode
  if (api.data.neighborhood != null) updateData.neighborhood = api.data.neighborhood

  await prisma.property.update({ where: { id: propertyId }, data: updateData })

  return {
    success: true,
    yearsUpdated: sorted.map((r) => r.year),
  }
}
