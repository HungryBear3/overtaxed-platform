import { NextRequest, NextResponse } from "next/server"

import { z } from "zod"

import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { getPropertyByPIN, normalizePIN } from "@/lib/cook-county"
import deadlineSnapshot from "@/data/deadlines/cook-county.json"
import {
  evaluateOfficialDeadlineState,
  type OfficialDeadlineSnapshot,
} from "@/lib/deadlines/official-source-state"
import {
  RESOLUTION_SOURCE,
  townshipKeyFromName,
  type TownshipResolution,
} from "@/lib/deadlines/township-resolution"

const Body = z.object({
  action: z.enum(["approve", "reject", "revalidate"]),
})

const SAFE_REVIEW_STATUSES = new Set(["NOTICE_REVIEW_REQUIRED", "CHECKOUT_PENDING", "CHECKOUT_FAILED"])

function snapshotForTownship(input: { township: string; pin: string; evaluatedAt: string }) {
  const identity: TownshipResolution = {
    inputKind: "pin",
    normalizedPin: normalizePIN(input.pin),
    normalizedAddress: null,
    townshipKey: townshipKeyFromName(input.township),
    townshipName: input.township,
    resolutionSource: RESOLUTION_SOURCE,
    resolvedAt: input.evaluatedAt,
  }
  const state = evaluateOfficialDeadlineState({
    snapshot: deadlineSnapshot as unknown as OfficialDeadlineSnapshot,
    township: identity,
    stage: "assessor",
    evaluatedAt: input.evaluatedAt,
  })
  if (state.kind === "pending") {
    return {
      township: input.township,
      status: "unknown" as const,
      openDate: null,
      closeDate: null,
      sourceUpdated: null,
      sourceUrl: state.provenance?.sourceUrl ?? null,
      verifiedAt: null,
      pendingReason: state.reason,
    }
  }
  return {
    township: state.township.townshipName,
    status: state.status,
    openDate: state.openDate,
    closeDate: state.lastFileDate,
    sourceUpdated: state.provenance.sourceUpdatedAt,
    sourceUrl: state.provenance.sourceUrl,
    verifiedAt: state.evaluatedAt,
    pendingReason: null,
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
    const evaluatedAt = new Date().toISOString()
    const snapshot = order.propertyPin && township
      ? snapshotForTownship({ township, pin: order.propertyPin, evaluatedAt })
      : {
          township,
          status: "unknown" as const,
          openDate: null,
          closeDate: null,
          sourceUpdated: null,
          sourceUrl: null,
          verifiedAt: null,
          pendingReason: "township_unresolved" as const,
        }
    const updated = await prisma.oTOrder.updateMany({
      where: reviewCasWhere as any,
      data: {
        township: snapshot.township,
        windowStatus: snapshot.status,
        windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
        windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
        windowSourceUpdated: snapshot.sourceUpdated,
        windowVerifiedAt: snapshot.verifiedAt ? new Date(snapshot.verifiedAt) : null,
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
