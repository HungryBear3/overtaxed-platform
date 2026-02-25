// POST /api/admin/create-performance-invoice - Create Performance Fee invoice(s) for a user
// Admin-only. Use when conditions are met (3-year window ended for upfront, or first reduction for installments).
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import {
  shouldCreatePerformanceInvoice,
  createPerformanceFeeInvoice,
} from "@/lib/billing/performance-fee"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET
    const providedSecret = request.headers.get("x-admin-secret")
    const session = await getSession(request)
    const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
    const isAuthorized = (adminSecret && providedSecret === adminSecret) || isAdmin
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const userId = body?.userId as string
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    const check = await shouldCreatePerformanceInvoice(userId)
    if (!check.should) {
      return NextResponse.json(
        { error: "Invoice not eligible", reason: check.reason ?? "unknown" },
        { status: 400 }
      )
    }

    const { invoiceIds } = await createPerformanceFeeInvoice(userId, check.savings, check.paymentOption)
    return NextResponse.json({
      success: true,
      message: `Created ${invoiceIds.length} invoice(s)`,
      invoiceIds,
      totalSavings: check.savings.totalSavings,
      feeAmount: check.savings.feeAmount,
    })
  } catch (error) {
    console.error("[admin] create-performance-invoice error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
