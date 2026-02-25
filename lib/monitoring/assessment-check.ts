/**
 * Automated assessment check: fetch Cook County data for monitored properties,
 * upsert AssessmentHistory, update lastCheckedAt. Optionally email on increase.
 */
import { prisma } from "@/lib/db"
import { getPropertyByPIN, formatPIN } from "@/lib/cook-county"
import { sendEmail } from "@/lib/email"
import { isEmailConfigured } from "@/lib/email/config"
import { assessmentIncreaseTemplate } from "@/lib/email/templates"
import type { AssessmentHistoryRecord } from "@/lib/cook-county/types"

const ASSESSMENT_CHECK_SOURCE = "Cook County Open Data (automated check)"

export interface AssessmentCheckResult {
  propertyId: string
  pin: string
  updated: boolean
  newYears: number[]
  increaseDetected: boolean
  error?: string
}

export async function runAssessmentChecks(): Promise<AssessmentCheckResult[]> {
  const properties = await prisma.property.findMany({
    where: { monitoringEnabled: true },
    include: { user: { select: { id: true, email: true, name: true } } },
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
        await prisma.property.update({
          where: { id: prop.id },
          data: { lastCheckedAt: new Date() },
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

      // Reduction detection: auto-update appeals when Cook County shows a lower assessment
      const valueByYear = new Map<number, number>()
      for (const rec of sorted) {
        const val = rec.assessedTotalValue ?? 0
        if (val > 0) valueByYear.set(rec.year, val)
      }
      const now = new Date()
      const appealsToCheck = await prisma.appeal.findMany({
        where: {
          propertyId: prop.id,
          status: { in: ["FILED", "UNDER_REVIEW", "HEARING_SCHEDULED", "DECISION_PENDING"] },
          outcome: null,
          filingDeadline: { lt: now },
        },
        select: {
          id: true,
          taxYear: true,
          originalAssessmentValue: true,
          requestedAssessmentValue: true,
        },
      })
      for (const appeal of appealsToCheck) {
        const cookCountyVal = valueByYear.get(appeal.taxYear)
        const originalVal = Number(appeal.originalAssessmentValue)
        if (
          cookCountyVal != null &&
          cookCountyVal > 0 &&
          cookCountyVal < originalVal
        ) {
          const reductionAmount = originalVal - cookCountyVal
          const property = await prisma.property.findUnique({
            where: { id: prop.id },
            select: { taxRate: true, stateEqualizer: true },
          })
          const taxRate = Number(property?.taxRate ?? 0.0756)
          const equalizer = Number(property?.stateEqualizer ?? 3.0355)
          const taxSavings = reductionAmount * taxRate * equalizer
          const requestedVal = appeal.requestedAssessmentValue
            ? Number(appeal.requestedAssessmentValue)
            : null
          const outcome =
            requestedVal != null && cookCountyVal > requestedVal
              ? ("PARTIALLY_WON" as const)
              : ("WON" as const)
          const reductionPercent =
            originalVal > 0 ? (reductionAmount / originalVal) * 100 : null
          await prisma.appeal.update({
            where: { id: appeal.id },
            data: {
              outcome,
              finalAssessmentValue: cookCountyVal,
              reductionAmount,
              reductionPercent,
              taxSavings,
              taxRate: property?.taxRate ?? undefined,
              equalizationFactor: property?.stateEqualizer ?? undefined,
              decisionDate: now,
            },
          })
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
      } = {
        lastCheckedAt: new Date(),
        currentAssessmentValue: currLatestVal,
        currentLandValue: newLatest.assessedLandValue ?? null,
        currentImprovementValue: newLatest.assessedBuildingValue ?? null,
      }
      if (newLatest.marketValue != null) updateData.currentMarketValue = newLatest.marketValue
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

  return results
}
