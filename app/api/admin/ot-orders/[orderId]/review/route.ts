import { NextRequest, NextResponse } from "next/server"

import { z } from "zod"

import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getPropertyByPIN, normalizePIN } from "@/lib/cook-county"
import { getFreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window"
import { ASSESSOR_CALENDAR_URL, TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED } from "@/lib/appeals/township-deadlines"

const Body = z.object({
  action: z.enum(["approve", "reject", "revalidate"]),
})

const SAFE_REVIEW_STATUSES = new Set(["NOTICE_REVIEW_REQUIRED", "CHECKOUT_PENDING", "CHECKOUT_FAILED"])

function snapshotForTownship(township: string) {
  const window = getFreeCheckAppealWindowStatus(township)
  return {
    township: window.township,
    status: window.status,
    openDate: window.openDate,
    closeDate: window.closeDate,
    sourceUpdated: TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
    sourceUrl: ASSESSOR_CALENDAR_URL,
    verifiedAt: `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z`,
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const session = await getSession(request)
  const admin = session?.user as { id?: string; role?: string } | undefined
  if (admin?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { orderId } = await context.params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  }

  const order = await prisma.oTOrder.findUnique({ where: { id: orderId } })
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 })
  }
  if (!SAFE_REVIEW_STATUSES.has(String(order.status ?? ""))) {
    return NextResponse.json({ error: "This order is no longer eligible for manual review changes." }, { status: 409 })
  }
  if ((order.status === "CHECKOUT_PENDING" || order.status === "CHECKOUT_FAILED") && order.stripeSessionId) {
    return NextResponse.json({ error: "This order is already provider-bound and cannot be rewritten." }, { status: 409 })
  }

  const reviewCasWhere = {
    id: orderId,
    status: order.status,
    contractKey: order.contractKey ?? null,
    attempt: order.attempt,
    stripeSessionId: order.stripeSessionId ?? null,
    tier: order.tier,
    propertyPin: order.propertyPin ?? null,
    propertyAddress: order.propertyAddress ?? null,
    email: order.email,
    reassessmentNoticeAddress: order.reassessmentNoticeAddress ?? null,
    reassessmentNoticeDate: order.reassessmentNoticeDate ?? null,
    checkoutPriceId: order.checkoutPriceId ?? null,
    checkoutProductId: order.checkoutProductId ?? null,
    checkoutAmountCents: order.checkoutAmountCents ?? null,
    checkoutCurrency: order.checkoutCurrency ?? null,
  } as const

  if (parsed.data.action === "revalidate") {
    const property = order.propertyPin ? await getPropertyByPIN(normalizePIN(order.propertyPin)) : null
    const township = String(property && "data" in property && property.data ? ((property.data as unknown as Record<string, unknown>).township ?? order.township ?? "") : order.township ?? "")
    const snapshot = snapshotForTownship(township)
    const updated = await prisma.oTOrder.updateMany({
      where: reviewCasWhere as any,
      data: {
        township: snapshot.township,
        windowStatus: snapshot.status,
        windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
        windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
        windowSourceUpdated: snapshot.sourceUpdated,
        windowVerifiedAt: new Date(snapshot.verifiedAt),
        eligibilitySnapshot: snapshot,
        noticeReviewStatus: "REVALIDATED",
        noticeReviewActionAt: new Date(),
        noticeReviewActionBy: admin.id ?? "admin",
      } as any,
    })
    if (updated.count !== 1) {
      return NextResponse.json({ error: "Review state changed before this update could be applied." }, { status: 409 })
    }
    const refreshed = await prisma.oTOrder.findUnique({ where: { id: orderId } })
    return NextResponse.json({ order: refreshed })
  }

  const noticeReviewStatus = parsed.data.action === "approve" ? "APPROVED" : "REJECTED"
  const status = parsed.data.action === "approve" ? "CHECKOUT_PENDING" : "NOTICE_REVIEW_REQUIRED"
  const updated = await prisma.oTOrder.updateMany({
    where: reviewCasWhere as any,
    data: {
      status,
      noticeReviewStatus,
      noticeReviewActionAt: new Date(),
      noticeReviewActionBy: admin.id ?? "admin",
    } as any,
  })
  if (updated.count !== 1) {
    return NextResponse.json({ error: "Review state changed before this update could be applied." }, { status: 409 })
  }
  const refreshed = await prisma.oTOrder.findUnique({ where: { id: orderId } })
  return NextResponse.json({ order: refreshed })
}
