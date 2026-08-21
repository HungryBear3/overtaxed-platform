import { projectTownshipDeadline } from "@/lib/appeals/township-deadlines"
import {
  RESOLUTION_SOURCE,
  normalizePin,
  townshipKeyFromName,
} from "@/lib/deadlines/township-resolution"
import {
  checkoutSnapshotFromProjection,
  type CheckoutWindowSnapshot,
} from "@/lib/checkout/window-gate-token"
import {
  dateKey,
  isWindowSnapshotFresh,
  signedPolicyVersion,
} from "@/lib/checkout/ot-contract"

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

/**
 * Re-evaluate the canonical state for a settling order, now.
 *
 * Same two corrections as the checkout route. The township is taken from the
 * order's confirmed PIN rather than from its stored township *name*, so this is
 * the eligibility tier; and there is no minted `verifiedAt` — freshness is
 * whatever the canonical evaluator says it is at this instant. The old
 * `` `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z` `` made every
 * settlement look freshly verified for as long as nobody edited that constant.
 */
function currentAuthoritativeOtWindow(
  order: Pick<OtSettlementOrder, "township" | "propertyPin">,
  now: Date,
): CheckoutWindowSnapshot {
  const townshipName = String(order.township ?? "").trim()
  const pin = normalizePin(String(order.propertyPin ?? "")) ?? ""
  const at = now.toISOString()

  const projection = projectTownshipDeadline({
    township: townshipName && pin
      ? {
          inputKind: "pin",
          normalizedPin: pin,
          normalizedAddress: null,
          townshipKey: townshipKeyFromName(townshipName),
          townshipName,
          resolutionSource: RESOLUTION_SOURCE,
          resolvedAt: at,
        }
      : null,
    stage: "assessor",
    at,
  })

  return checkoutSnapshotFromProjection({
    pin,
    fallbackTownshipName: townshipName || "Unknown",
    projection,
    policyVersion: signedPolicyVersion(),
  })
}

export function validateCurrentT3Settlement(order: OtSettlementOrder, now: Date = new Date()) {
  const snapshot = (order.eligibilitySnapshot ?? null) as Record<string, unknown> | null

  // The persisted evidence proves what we recorded when the buyer paid. It is
  // checked for its own freshness first, but it is never the thing that decides
  // whether settlement may proceed — that is the live re-evaluation below.
  const retrievedAt = order.windowVerifiedAt instanceof Date
    ? order.windowVerifiedAt.toISOString()
    : typeof snapshot?.retrievedAt === "string" ? snapshot.retrievedAt : null
  const freshnessExpiresAt = typeof snapshot?.freshnessExpiresAt === "string"
    ? snapshot.freshnessExpiresAt
    : null
  if (!isWindowSnapshotFresh({ retrievedAt, freshnessExpiresAt }, now)) {
    return "Persisted OT filing-window evidence was stale at settlement"
  }
  if (order.checkoutSessionExpiresAt instanceof Date && order.checkoutSessionExpiresAt.getTime() <= now.getTime()) {
    return "Bound OT Checkout Session expired before settlement review"
  }
  if (order.windowCloseDate instanceof Date && order.windowCloseDate.getTime() <= now.getTime()) {
    return "OT filing window had already closed at settlement"
  }

  const current = currentAuthoritativeOtWindow(order, now)
  // `allowCheckout`, not `status === "open"`. A window can be open while the
  // eligibility policy is unsigned, and settling in that state would charge for
  // something no owner decision authorizes selling.
  if (!current.allowCheckout) {
    return current.status === "open"
      ? "Current OT eligibility policy does not authorize settlement"
      : `Current OT filing-window status is ${current.status}`
  }

  const matches = order.windowStatus === "open" &&
    order.township === current.township &&
    dateKey(order.windowOpenDate) === current.openDate &&
    dateKey(order.windowCloseDate) === current.closeDate &&
    dateKey(order.windowSourceUpdated) === dateKey(current.retrievedAt) &&
    String(snapshot?.pin ?? order.propertyPin ?? "") === String(current.pin ?? "") &&
    String(snapshot?.township ?? order.township ?? "") === current.township &&
    String(snapshot?.status ?? order.windowStatus ?? "") === current.status &&
    String(snapshot?.sourceUrl ?? "") === String(current.sourceUrl ?? "") &&
    String(snapshot?.policyVersion ?? "") === String(current.policyVersion ?? "") &&
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
