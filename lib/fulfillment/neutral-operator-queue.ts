/**
 * The operator queue read model: pure derivation and a strict DTO.
 *
 * Design rule (architecture 4.1): do not add a status column that duplicates
 * truth held elsewhere. Every state below is DERIVED on each request from the
 * generation work row, the reservation, the QA review, the manual delivery
 * ledger, and the order/reversal authority. Only the ledgers are durable.
 *
 * Nothing here reads a database or an environment variable; the store supplies
 * a row and receives a decision.
 */

export const NEUTRAL_OPERATOR_STATES = [
  "GENERATION_PENDING",
  "GENERATION_HOLD",
  "SUPERSEDED",
  "AWAITING_QA",
  "QA_IN_REVIEW",
  "QA_REJECTED",
  "QA_REFUND_REQUIRED",
  "QA_HELD",
  "APPROVED_AWAITING_PROMOTION",
  "DELIVERY_READY",
  "DELIVERY_PREPARED",
  "DELIVERY_RECORDED",
  "DELIVERY_CONFIRMED",
  "SETTLEMENT_HOLD",
] as const;

export type NeutralOperatorState = (typeof NEUTRAL_OPERATOR_STATES)[number];

/** Delivery statuses that occupy the single active slot for a reservation. */
export const NEUTRAL_ACTIVE_DELIVERY_STATUSES = [
  "PREPARED",
  "RECORDED",
  "CONFIRMED",
] as const;

export type NeutralOperatorQueueRow = {
  orderId: string;
  reservationId: string;
  orderStatus: string;
  paymentAuthoritative: boolean;
  settlementReversed: boolean;
  generationStatus: string | null;
  reservationStatus: string;
  bundleSha256: string | null;
  manifestSha256: string | null;
  customerZipSha256: string | null;
  qaStatus: string | null;
  qaReasonCode: string | null;
  qaCustomerArtifactSha256: string | null;
  refundStatus: string | null;
  fulfillmentStatus: string | null;
  latestArtifactSha256: string | null;
  deliveryStatus: string | null;
  deliveryStatusRevision: number | null;
  classification: string | null;
  promotedAt: Date | null;
  qaStartedAt: Date | null;
  updatedAt: Date;
};

function activeDelivery(status: string | null): status is "PREPARED" | "RECORDED" | "CONFIRMED" {
  return (NEUTRAL_ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(
    status ?? "",
  );
}

/**
 * True when the three customer-ZIP identities agree and the fulfillment is
 * ready — the precondition a Slice 2 PREPARE will re-evaluate, and the only
 * basis on which Slice 1 will serve customer ZIP bytes to an operator.
 */
export function neutralCustomerArtifactChainIntact(
  row: Pick<
    NeutralOperatorQueueRow,
    | "qaStatus"
    | "qaCustomerArtifactSha256"
    | "customerZipSha256"
    | "latestArtifactSha256"
    | "fulfillmentStatus"
  >,
): boolean {
  const sha = row.qaCustomerArtifactSha256;
  return (
    row.qaStatus === "APPROVED" &&
    typeof sha === "string" &&
    sha.length === 64 &&
    row.customerZipSha256 === sha &&
    row.latestArtifactSha256 === sha &&
    row.fulfillmentStatus === "ARTIFACT_READY"
  );
}

/**
 * Derive the operator-visible state.
 *
 * SETTLEMENT_HOLD is evaluated first and unconditionally: a reversal is
 * permanent and overrides every other state for the purpose of new mutations,
 * so it must never be hidden behind a more encouraging label.
 */
export function deriveNeutralOperatorState(
  row: NeutralOperatorQueueRow,
): NeutralOperatorState {
  if (row.settlementReversed || row.orderStatus === "SETTLEMENT_HOLD")
    return "SETTLEMENT_HOLD";

  if (row.reservationStatus === "SUPERSEDED") return "SUPERSEDED";

  if (
    row.generationStatus === "RECONCILIATION_REQUIRED" ||
    row.generationStatus === "FAILED" ||
    row.reservationStatus === "RECONCILIATION_REQUIRED" ||
    row.reservationStatus === "QUARANTINED" ||
    row.reservationStatus === "COMPROMISED"
  )
    return "GENERATION_HOLD";

  if (row.qaStatus !== null) {
    // PENDING is the column default; `openNeutralQaReview` writes IN_REVIEW
    // directly. Either way a row exists, so the report is in a reviewer's hands.
    if (row.qaStatus === "PENDING" || row.qaStatus === "IN_REVIEW")
      return "QA_IN_REVIEW";
    if (row.qaStatus === "REJECTED") return "QA_REJECTED";
    if (row.qaStatus === "REFUND_REQUIRED") return "QA_REFUND_REQUIRED";
    if (row.qaStatus === "HELD") return "QA_HELD";
    if (row.qaStatus === "APPROVED") {
      if (activeDelivery(row.deliveryStatus))
        return `DELIVERY_${row.deliveryStatus}` as NeutralOperatorState;
      return neutralCustomerArtifactChainIntact(row)
        ? "DELIVERY_READY"
        : "APPROVED_AWAITING_PROMOTION";
    }
  }

  // Keyed on the reservation, not on work.status = COMPLETE: the worker can lose
  // its lease after `promote` succeeded, leaving the reservation PROMOTED while
  // the work row is not COMPLETE. That report is ready for review.
  if (
    row.reservationStatus === "PROMOTED" &&
    row.bundleSha256 !== null &&
    row.manifestSha256 !== null &&
    row.paymentAuthoritative
  )
    return "AWAITING_QA";

  return "GENERATION_PENDING";
}

/**
 * The exact fields an operator response may contain. This is an allowlist, not
 * a redaction list: a column added to the query later cannot leak by default.
 */
export const NEUTRAL_OPERATOR_QUEUE_FIELDS = [
  "orderId",
  "reservationId",
  "state",
  "generationStatus",
  "reservationStatus",
  "qaStatus",
  "qaReasonCode",
  "refundStatus",
  "fulfillmentStatus",
  "deliveryStatus",
  "deliveryStatusRevision",
  "classification",
  "bundleSha256",
  "customerZipSha256",
  "promotedAt",
  "qaStartedAt",
  "updatedAt",
] as const;

export type NeutralOperatorQueueItem = {
  orderId: string;
  reservationId: string;
  state: NeutralOperatorState;
  generationStatus: string | null;
  reservationStatus: string;
  qaStatus: string | null;
  qaReasonCode: string | null;
  refundStatus: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  deliveryStatusRevision: number | null;
  classification: string | null;
  bundleSha256: string | null;
  customerZipSha256: string | null;
  promotedAt: string | null;
  qaStartedAt: string | null;
  updatedAt: string;
};

const instant = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/** Project one row onto the allowlist. Whole database records never leave here. */
export function toNeutralOperatorQueueItem(
  row: NeutralOperatorQueueRow,
): NeutralOperatorQueueItem {
  return {
    orderId: row.orderId,
    reservationId: row.reservationId,
    state: deriveNeutralOperatorState(row),
    generationStatus: row.generationStatus,
    reservationStatus: row.reservationStatus,
    qaStatus: row.qaStatus,
    qaReasonCode: row.qaReasonCode,
    refundStatus: row.refundStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    deliveryStatus: row.deliveryStatus,
    deliveryStatusRevision: row.deliveryStatusRevision,
    classification: row.classification,
    bundleSha256: row.bundleSha256,
    customerZipSha256: row.customerZipSha256,
    promotedAt: instant(row.promotedAt),
    qaStartedAt: instant(row.qaStartedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** ADMIN-only, and bounded: an operator queue is never an export surface. */
export const NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS = 100;
