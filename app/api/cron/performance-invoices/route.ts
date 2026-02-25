// Cron: create Performance Fee invoices for eligible users.
// GET /api/cron/performance-invoices - requires CRON_SECRET
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  shouldCreatePerformanceInvoice,
  createPerformanceFeeInvoice,
} from "@/lib/billing/performance-fee"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const performanceUsers = await prisma.user.findMany({
    where: { subscriptionTier: "PERFORMANCE" },
    select: { id: true },
  })

  const created: string[] = []
  const skipped: { userId: string; reason: string }[] = []
  const errors: { userId: string; error: string }[] = []

  for (const u of performanceUsers) {
    try {
      const check = await shouldCreatePerformanceInvoice(u.id)
      if (!check.should) {
        skipped.push({ userId: u.id, reason: check.reason ?? "unknown" })
        continue
      }
      const { invoiceIds } = await createPerformanceFeeInvoice(
        u.id,
        check.savings,
        check.paymentOption
      )
      created.push(...invoiceIds)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ userId: u.id, error: msg })
    }
  }

  return NextResponse.json({
    success: true,
    performanceUsersChecked: performanceUsers.length,
    invoicesCreated: created.length,
    invoiceIds: created,
    skipped: skipped.length,
    skippedDetails: skipped,
    errors: errors.length,
    errorDetails: errors,
  })
}
