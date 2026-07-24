import { getFreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window"
import {
  ASSESSOR_CALENDAR_URL,
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
} from "@/lib/appeals/township-deadlines"
import { dateKey, isWindowSnapshotFresh } from "@/lib/checkout/ot-contract"

export type OtSettlementOrder = {
  id: string
  status: string
  tier: string
  email: string
  name: string | null
  stripeSessionId: string | null
  checkoutKey: string | null
  propertyAddress: string | null
  propertyPin: string | null
  township: string | null
  windowStatus: string | null
  windowOpenDate: Date | null
  windowCloseDate: Date | null
  windowSourceUpdated: string | null
  windowVerifiedAt: Date | null
  eligibilitySnapshot: unknown
  analysisAcknowledgedAt: Date | null
  acknowledgmentVersion: string | null
  acknowledgmentEvidence: unknown
  reassessmentNoticeDate: Date | null
  reassessmentNoticeAddress: string | null
  noticeEvidence: unknown
  noticeReviewStatus: string | null
  noticeReviewActionAt: Date | null
  noticeReviewActionBy: string | null
  checkoutSessionExpiresAt: Date | null
  checkoutPriceId: string | null
  checkoutProductId: string | null
  checkoutAmountCents: number | null
  checkoutCurrency: string | null
  contractKey: string | null
  attempt: number
}

export function validateApprovedNoticeSettlement(order: OtSettlementOrder, sessionId: string, now: Date = new Date()) {
  if (order.stripeSessionId !== sessionId) return "Approved OT notice override lost its bound Checkout Session"
  if (order.noticeReviewStatus !== "APPROVED") return "Settled OT checkout lacked durable APPROVED notice review"
  if (!(order.noticeReviewActionAt instanceof Date) || !order.noticeReviewActionBy) {
    return "Settled OT checkout lacked durable admin notice-review action evidence"
  }
  const noticeEvidence = (order.noticeEvidence ?? null) as Record<string, unknown> | null
  const noticeDate = dateKey(order.reassessmentNoticeDate)
  const noticeAddress = String(order.reassessmentNoticeAddress ?? "").trim() || null
  if (
    !noticeEvidence ||
    String(noticeEvidence.type ?? "") !== "reassessment_notice" ||
    String(noticeEvidence.date ?? "") !== String(noticeDate ?? "") ||
    String(noticeEvidence.address ?? "") !== String(noticeAddress ?? "")
  ) return "Settled OT checkout lacked exact immutable reassessment-notice evidence"
  if (!order.checkoutPriceId || !order.checkoutProductId || !Number.isSafeInteger(order.checkoutAmountCents) || !order.checkoutCurrency) {
    return "Settled OT checkout lacked durable provider contract terms for approved notice settlement"
  }
  if (order.checkoutSessionExpiresAt instanceof Date && order.checkoutSessionExpiresAt.getTime() <= now.getTime()) {
    return "Bound OT Checkout Session expired before approved-notice settlement review"
  }
  return null
}

function currentAuthoritativeOtWindow(order: Pick<OtSettlementOrder, "township" | "propertyPin">, now: Date) {
  const township = String(order.township ?? "").trim() || "Unknown"
  const window = getFreeCheckAppealWindowStatus(township, now)
  const verifiedAt = `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z`
  const status = window.status === "open" && !isWindowSnapshotFresh({ verifiedAt }, now) ? "unknown" : window.status
  return {
    pin: String(order.propertyPin ?? "").trim() || null,
    township: window.township,
    status,
    openDate: status === "unknown" ? null : window.openDate,
    closeDate: status === "unknown" ? null : window.closeDate,
    sourceUrl: ASSESSOR_CALENDAR_URL,
    sourceUpdated: TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
    verifiedAt,
  }
}

export function validateCurrentT3Settlement(order: OtSettlementOrder, now: Date = new Date()) {
  const snapshot = (order.eligibilitySnapshot ?? null) as Record<string, unknown> | null
  const verifiedAt = order.windowVerifiedAt instanceof Date
    ? order.windowVerifiedAt.toISOString()
    : typeof snapshot?.verifiedAt === "string" ? snapshot.verifiedAt : null
  if (!verifiedAt || !isWindowSnapshotFresh({ verifiedAt }, now)) return "Persisted OT filing-window evidence was stale at settlement"
  if (order.checkoutSessionExpiresAt instanceof Date && order.checkoutSessionExpiresAt.getTime() <= now.getTime()) {
    return "Bound OT Checkout Session expired before settlement review"
  }
  if (order.windowCloseDate instanceof Date && order.windowCloseDate.getTime() <= now.getTime()) {
    return "OT filing window had already closed at settlement"
  }

  const current = currentAuthoritativeOtWindow(order, now)
  if (current.status !== "open") return `Current OT filing-window status is ${current.status}`

  const matches = order.windowStatus === "open" &&
    order.township === current.township &&
    dateKey(order.windowOpenDate) === current.openDate &&
    dateKey(order.windowCloseDate) === current.closeDate &&
    order.windowSourceUpdated === current.sourceUpdated &&
    String(snapshot?.pin ?? order.propertyPin ?? "") === String(current.pin ?? "") &&
    String(snapshot?.township ?? order.township ?? "") === current.township &&
    String(snapshot?.status ?? order.windowStatus ?? "") === current.status &&
    String(snapshot?.sourceUrl ?? "") === current.sourceUrl &&
    String(snapshot?.sourceUpdated ?? "") === current.sourceUpdated &&
    String(snapshot?.verifiedAt ?? verifiedAt) === verifiedAt &&
    String(snapshot?.openDate ?? dateKey(order.windowOpenDate) ?? "") === String(current.openDate ?? "") &&
    String(snapshot?.closeDate ?? dateKey(order.windowCloseDate) ?? "") === String(current.closeDate ?? "")
  return matches ? null : "Current authoritative OT filing-window evidence no longer matches the paid contract"
}

export function validateT2Acknowledgment(order: OtSettlementOrder) {
  const evidence = (order.acknowledgmentEvidence ?? null) as Record<string, unknown> | null
  if (!(order.analysisAcknowledgedAt instanceof Date)) return "Settled T2 checkout lacked acknowledgment timestamp"
  if (order.acknowledgmentVersion !== "analysis_ack_v1") return "Settled T2 checkout lacked the expected acknowledgment version"
  if (!evidence || evidence.acknowledged !== true || evidence.version !== "analysis_ack_v1") {
    return "Settled T2 checkout lacked exact acknowledgment evidence"
  }
  return null
}
