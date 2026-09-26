/**
 * T-17: the operator queue read model derives each state from durable relations
 * and exposes an explicit non-PII DTO allowlist rather than whole records.
 */
import {
  NEUTRAL_OPERATOR_QUEUE_FIELDS,
  NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS,
  deriveNeutralOperatorState,
  toNeutralOperatorQueueItem,
} from "@/lib/fulfillment/neutral-operator-queue";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);

const row = (overrides: Record<string, unknown> = {}) => ({
  orderId: "ord_1",
  reservationId: "res_1",
  orderStatus: "PAID",
  paymentAuthoritative: true,
  settlementReversed: false,
  generationStatus: "COMPLETE" as string | null,
  reservationStatus: "PROMOTED",
  bundleSha256: SHA as string | null,
  manifestSha256: SHA as string | null,
  customerZipSha256: null as string | null,
  qaStatus: null as string | null,
  qaReasonCode: null as string | null,
  qaCustomerArtifactSha256: null as string | null,
  refundStatus: null as string | null,
  fulfillmentStatus: null as string | null,
  latestArtifactSha256: null as string | null,
  deliveryStatus: null as string | null,
  deliveryStatusRevision: null as number | null,
  classification: null as string | null,
  promotedAt: null as Date | null,
  qaStartedAt: null as Date | null,
  updatedAt: new Date("2026-09-22T00:00:00.000Z"),
  ...overrides,
});

const state = (overrides: Record<string, unknown> = {}) =>
  deriveNeutralOperatorState(row(overrides));

describe("deriveNeutralOperatorState (4.2)", () => {
  test("derives generation pending from live work status", () => {
    for (const generationStatus of ["PENDING", "CLAIMED", "PRODUCING", "RETRY_REQUIRED"])
      expect(state({ generationStatus, reservationStatus: "STAGED" })).toBe(
        "GENERATION_PENDING",
      );
  });

  test("derives generation hold from either a work or a reservation hold", () => {
    for (const generationStatus of ["RECONCILIATION_REQUIRED", "FAILED"])
      expect(state({ generationStatus, reservationStatus: "STAGED" })).toBe(
        "GENERATION_HOLD",
      );
    for (const reservationStatus of [
      "RECONCILIATION_REQUIRED",
      "QUARANTINED",
      "COMPROMISED",
    ])
      expect(state({ reservationStatus })).toBe("GENERATION_HOLD");
  });

  test("derives SUPERSEDED from the reservation", () => {
    expect(state({ reservationStatus: "SUPERSEDED" })).toBe("SUPERSEDED");
  });

  test("derives awaiting QA from the reservation, not from work COMPLETE", () => {
    expect(state()).toBe("AWAITING_QA");
    // The worker can lose its lease after promote succeeded: the reservation is
    // PROMOTED while the work row is not COMPLETE. That is still awaiting QA.
    expect(state({ generationStatus: "PRODUCING" })).toBe("AWAITING_QA");
    expect(state({ generationStatus: null })).toBe("AWAITING_QA");
    // Missing artifact identity is not awaiting QA.
    expect(state({ bundleSha256: null })).not.toBe("AWAITING_QA");
    expect(state({ manifestSha256: null })).not.toBe("AWAITING_QA");
  });

  test("derives each QA disposition", () => {
    expect(state({ qaStatus: "IN_REVIEW" })).toBe("QA_IN_REVIEW");
    expect(state({ qaStatus: "PENDING" })).toBe("QA_IN_REVIEW");
    expect(state({ qaStatus: "REJECTED", qaReasonCode: "ARTIFACT_DEFECT" })).toBe(
      "QA_REJECTED",
    );
    expect(state({ qaStatus: "REFUND_REQUIRED" })).toBe("QA_REFUND_REQUIRED");
    expect(state({ qaStatus: "HELD", qaReasonCode: "OPERATOR_HOLD" })).toBe(
      "QA_HELD",
    );
  });

  test("distinguishes approved-awaiting-promotion from delivery-ready", () => {
    expect(state({ qaStatus: "APPROVED" })).toBe("APPROVED_AWAITING_PROMOTION");
    // Promoted, but the three customer-zip identities must all agree.
    const promoted = {
      qaStatus: "APPROVED",
      qaCustomerArtifactSha256: SHA,
      customerZipSha256: SHA,
      latestArtifactSha256: SHA,
      fulfillmentStatus: "ARTIFACT_READY",
    };
    expect(state(promoted)).toBe("DELIVERY_READY");
    expect(state({ ...promoted, latestArtifactSha256: OTHER })).toBe(
      "APPROVED_AWAITING_PROMOTION",
    );
    expect(state({ ...promoted, customerZipSha256: OTHER })).toBe(
      "APPROVED_AWAITING_PROMOTION",
    );
    expect(state({ ...promoted, fulfillmentStatus: "NOT_STARTED" })).toBe(
      "APPROVED_AWAITING_PROMOTION",
    );
  });

  test("an existing delivery row suppresses delivery-ready", () => {
    const promoted = {
      qaStatus: "APPROVED",
      qaCustomerArtifactSha256: SHA,
      customerZipSha256: SHA,
      latestArtifactSha256: SHA,
      fulfillmentStatus: "ARTIFACT_READY",
    };
    for (const deliveryStatus of ["PREPARED", "RECORDED", "CONFIRMED"])
      expect(state({ ...promoted, deliveryStatus })).toBe(
        `DELIVERY_${deliveryStatus}`,
      );
    // A voided row is not active, so the order is deliverable again.
    expect(state({ ...promoted, deliveryStatus: "VOIDED" })).toBe("DELIVERY_READY");
  });

  test("settlement hold overrides every other derived state", () => {
    for (const overrides of [
      { qaStatus: "APPROVED" },
      { qaStatus: "IN_REVIEW" },
      { reservationStatus: "SUPERSEDED" },
      { generationStatus: "PENDING" },
    ]) {
      expect(state({ ...overrides, settlementReversed: true })).toBe(
        "SETTLEMENT_HOLD",
      );
      expect(state({ ...overrides, orderStatus: "SETTLEMENT_HOLD" })).toBe(
        "SETTLEMENT_HOLD",
      );
    }
  });
});

describe("queue DTO is a strict non-PII allowlist (I-7)", () => {
  test("bounds the result count", () => {
    expect(NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS).toBeLessThanOrEqual(100);
    expect(NEUTRAL_OPERATOR_QUEUE_MAX_ITEMS).toBeGreaterThan(0);
  });

  test("returns exactly the allowlisted fields and nothing else", () => {
    const item = toNeutralOperatorQueueItem(row());
    expect(Object.keys(item).sort()).toEqual(
      [...NEUTRAL_OPERATOR_QUEUE_FIELDS].sort(),
    );
  });

  test("drops any extra column a future query might select", () => {
    const item = toNeutralOperatorQueueItem(
      row({
        email: "someone@example.com",
        propertyPin: "12345678901234",
        propertyAddress: "1 Main St",
        reviewerKey: "admin:u1",
        privateReferences: { locator: "ot-neutral-reports/sha256/x.json" },
      }) as never,
    );
    const serialized = JSON.stringify(item);
    expect(serialized).not.toMatch(/@|example\.com|Main St|12345678901234/);
    for (const forbidden of [
      "email",
      "propertyPin",
      "propertyAddress",
      "reviewerKey",
      "privateReferences",
    ])
      expect(Object.keys(item)).not.toContain(forbidden);
  });

  test("names no PII-bearing field in the allowlist itself", () => {
    for (const field of NEUTRAL_OPERATOR_QUEUE_FIELDS)
      expect(field).not.toMatch(
        /email|address|\bpin\b|recipient|locator|reference|payload|capability/i,
      );
  });

  test("carries the derived state and the CAS revision an operator needs", () => {
    const item = toNeutralOperatorQueueItem(row()) as Record<string, unknown>;
    expect(item.state).toBe("AWAITING_QA");
    expect(item.orderId).toBe("ord_1");
    expect(NEUTRAL_OPERATOR_QUEUE_FIELDS).toContain("deliveryStatusRevision");
  });
});
