/**
 * Automated assessment check: fetch Cook County data for monitored properties,
 * upsert AssessmentHistory, update lastCheckedAt. Optionally email on increase.
 *
 * Schedule-gated: only runs during reassessment season (Jan–Aug) and only for
 * properties in townships with an active appeal window (aligns with gov't data releases).
 */
import { prisma } from "@/lib/db"
import { getPropertyByPIN, formatPIN } from "@/lib/cook-county"
import { sendEmail } from "@/lib/email"
import { isEmailConfigured } from "@/lib/email/config"
import { assessmentIncreaseTemplate } from "@/lib/email/templates"
import type { AssessmentHistoryRecord } from "@/lib/cook-county/types"
import {
  isInReassessmentSeason,
  getActiveTownshipNamesForChecks,
  normalizeTownshipForMatch,
} from "@/lib/monitoring/schedule"

const ASSESSMENT_CHECK_SOURCE = "Cook County Open Data (automated check)"

export interface AssessmentCheckResult {
  propertyId: string
  pin: string
  updated: boolean
  newYears: number[]
  increaseDetected: boolean
  error?: string
}

export interface AssessmentCheckRunResult {
  results: AssessmentCheckResult[]
  skipped: boolean
  skipReason?: string
  propertiesChecked: number
}

export async function runAssessmentChecks(): Promise<AssessmentCheckRunResult> {
  const now = new Date()

  if (!isInReassessmentSeason(now)) {
    return {
      results: [],
      skipped: true,
      skipReason: "Outside reassessment season (Sep–Dec); no checks to reduce API usage.",
      propertiesChecked: 0,
    }
  }

  const activeTownshipNames = getActiveTownshipNamesForChecks(now)
  const allMonitored = await prisma.property.findMany({
    where: { monitoringEnabled: true },
    include: { user: { select: { id: true, email: true, name: true } } },
  })

  // Only check properties in active townships, or properties without township (one-time backfill)
  const properties = allMonitored.filter((p) => {
    const townshipNorm = normalizeTownshipForMatch(p.township)
    if (!townshipNorm) return true // No township yet: check once to backfill
    return activeTownshipNames.has(townshipNorm)
  })

  const results: AssessmentCheckResult[] = []

  for (const prop of properties) {
    const r: AssessmentCheckResult = {
      propertyId: prop.id,
      pin: prop.pin,
      updated: false,
      newYears: [],
      increaseDetected: false,
    }

    try {
      const api = await getPropertyByPIN(prop.pin)
      if (!api.success || !api.data) {
        r.error = api.error ?? "Property not found in Cook County"
        results.push(r)
        continue
      }

      const history = (api.data.assessmentHistory ?? []) as AssessmentHistoryRecord[]
      const sorted = [...history].sort((a, b) => b.year - a.year)
      if (sorted.length === 0) {
        const noHistoryUpdate: { lastCheckedAt: Date; township?: string } = { lastCheckedAt: new Date() }
        if (api.data.township != null && !prop.township) noHistoryUpdate.township = api.data.township
        await prisma.property.update({
          where: { id: prop.id },
          data: noHistoryUpdate,
        })
        r.updated = true
        results.push(r)
        continue
      }

      const existingYears = new Set(
        (
          await prisma.assessmentHistory.findMany({
            where: { propertyId: prop.id },
            select: { taxYear: true },
          })
        ).map((x) => x.taxYear)
      )
      const prevStored = await prisma.assessmentHistory.findFirst({
        where: { propertyId: prop.id },
        orderBy: { taxYear: "desc" },
      })

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
          where: {
            propertyId_taxYear: { propertyId: prop.id, taxYear: rec.year },
          },
          create: {
            propertyId: prop.id,
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

        if (!existingYears.has(rec.year)) {
          r.newYears.push(rec.year)
          r.updated = true
        }
      }

      const newLatest = sorted[0]
      const latestYear = newLatest.year
      const prevLatestVal = prevStored ? Number(prevStored.assessmentValue) : null
      const currLatestVal = newLatest.assessedTotalValue ?? 0
      if (prevLatestVal != null && currLatestVal > prevLatestVal) {
        r.increaseDetected = true
      }

      const updateData: {
        lastCheckedAt: Date
        currentAssessmentValue: number
        currentLandValue?: number | null
        currentImprovementValue?: number | null
        currentMarketValue?: number | null
        township?: string | null
      } = {
        lastCheckedAt: new Date(),
        currentAssessmentValue: currLatestVal,
        currentLandValue: newLatest.assessedLandValue ?? null,
        currentImprovementValue: newLatest.assessedBuildingValue ?? null,
      }
      if (newLatest.marketValue != null) updateData.currentMarketValue = newLatest.marketValue
      // Cache township for future schedule filtering (reduces need to look up)
      if (api.data.township != null && !prop.township)
        updateData.township = api.data.township
      await prisma.property.update({ where: { id: prop.id }, data: updateData })

      if (r.increaseDetected && isEmailConfigured() && prop.user?.email) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        const link = `${appUrl}/properties/${prop.id}`
        const t = assessmentIncreaseTemplate({
          userEmail: prop.user.email,
          userName: prop.user.name,
          propertyAddress: prop.address,
          pin: formatPIN(prop.pin),
          taxYear: latestYear,
          previousValue: prevLatestVal ?? 0,
          newValue: currLatestVal,
          propertyLink: link,
        })
        await sendEmail({ to: prop.user.email, subject: t.subject, text: t.text, html: t.html })
      }
    } catch (e) {
      r.error = e instanceof Error ? e.message : "Unknown error"
    }

    results.push(r)
  }

  return {
    results,
    skipped: false,
    propertiesChecked: properties.length,
  }
}
