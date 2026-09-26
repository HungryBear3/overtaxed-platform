/**
 * T-07 / T-08 (pure half): the operator artifact-read gate, and the QA approval
 * precondition that binds an approval to bytes the reviewer was actually served.
 */
import {
  NEUTRAL_OPERATOR_ARTIFACT_KINDS,
  decideNeutralOperatorRead,
  neutralQaApprovalReadSatisfied,
  purposeForArtifactKind,
} from "@/lib/fulfillment/neutral-operator-read";

const BUNDLE = "a".repeat(64);
const PDF = "b".repeat(64);
const CSV = "c".repeat(64);
const ZIP = "d".repeat(64);
const OTHER = "e".repeat(64);

const context = (overrides: Record<string, unknown> = {}) => ({
  actorKey: "admin:u1",
  artifactKind: "INTERNAL_PDF",
  expectedSha256: PDF,
  orderStatus: "PAID",
  paymentAuthoritative: true,
  settlementReversed: false,
  reservationStatus: "PROMOTED",
  bundleSha256: BUNDLE as string | null,
  manifestSha256: BUNDLE as string | null,
  pdfSha256: PDF as string | null,
  csvSha256: CSV as string | null,
  customerZipSha256: null as string | null,
  qaStatus: "IN_REVIEW" as string | null,
  qaReviewerKey: "admin:u1" as string | null,
  qaArtifactSha256: BUNDLE as string | null,
  qaCustomerArtifactSha256: null as string | null,
  latestArtifactSha256: null as string | null,
  fulfillmentStatus: null as string | null,
  deliveryStatus: null as string | null,
  ...overrides,
});

const decide = (overrides: Record<string, unknown> = {}) =>
  decideNeutralOperatorRead(context(overrides) as never);

describe("decideNeutralOperatorRead", () => {
  test("maps each artifact kind to exactly one purpose", () => {
    expect(purposeForArtifactKind("INTERNAL_PDF")).toBe("QA_REVIEW");
    expect(purposeForArtifactKind("INTERNAL_CSV")).toBe("QA_REVIEW");
    expect(purposeForArtifactKind("CUSTOMER_ZIP")).toBe("DELIVERY_PREPARE");
    expect(purposeForArtifactKind("SOMETHING")).toBeNull();
    expect(NEUTRAL_OPERATOR_ARTIFACT_KINDS).toHaveLength(3);
  });

  test("serves the internal PDF and CSV to the reviewer who owns the open QA", () => {
    expect(decide()).toEqual({
      ok: true,
      purpose: "QA_REVIEW",
      artifactKind: "INTERNAL_PDF",
      expectedSha256: PDF,
      bundleSha256: BUNDLE,
    });
    expect(decide({ artifactKind: "INTERNAL_CSV", expectedSha256: CSV })).toMatchObject(
      { ok: true, purpose: "QA_REVIEW", expectedSha256: CSV },
    );
  });

  test("refuses an unknown kind, a malformed actor, and a malformed digest", () => {
    expect(decide({ artifactKind: "SOURCE_HTML" })).toEqual({
      ok: false,
      blocker: "INVALID_ARTIFACT_KIND",
    });
    expect(decide({ actorKey: "user:u1" })).toEqual({
      ok: false,
      blocker: "INVALID_ACTOR",
    });
    for (const expectedSha256 of ["", "NOTHEX", PDF.toUpperCase(), `${PDF}a`])
      expect(decide({ expectedSha256 })).toEqual({
        ok: false,
        blocker: "INVALID_DIGEST",
      });
  });

  test("refuses the wrong actor: another reviewer's open QA does not authorize a read", () => {
    expect(decide({ qaReviewerKey: "admin:u2" })).toEqual({
      ok: false,
      blocker: "QA_NOT_OPEN_FOR_ACTOR",
    });
  });

  test("refuses a missing or inactive QA for internal artifacts", () => {
    expect(decide({ qaStatus: null, qaReviewerKey: null })).toEqual({
      ok: false,
      blocker: "QA_NOT_OPEN_FOR_ACTOR",
    });
    for (const qaStatus of ["PENDING", "APPROVED", "REJECTED", "HELD", "REFUND_REQUIRED"])
      expect(decide({ qaStatus })).toEqual({
        ok: false,
        blocker: "QA_NOT_OPEN_FOR_ACTOR",
      });
  });

  test("refuses a stale expected digest (I-3)", () => {
    expect(decide({ expectedSha256: OTHER })).toEqual({
      ok: false,
      blocker: "ARTIFACT_DIGEST_MISMATCH",
    });
    // A digest that was current before the bundle was regenerated is stale now.
    expect(decide({ pdfSha256: OTHER })).toEqual({
      ok: false,
      blocker: "ARTIFACT_DIGEST_MISMATCH",
    });
  });

  test("refuses a stale reservation and a QA bound to a superseded bundle", () => {
    for (const reservationStatus of [
      "RESERVED",
      "STAGED",
      "SUPERSEDED",
      "QUARANTINED",
      "COMPROMISED",
      "RECONCILIATION_REQUIRED",
    ])
      expect(decide({ reservationStatus })).toEqual({
        ok: false,
        blocker: "ARTIFACT_NOT_PROMOTED",
      });
    expect(decide({ bundleSha256: null })).toEqual({
      ok: false,
      blocker: "ARTIFACT_NOT_PROMOTED",
    });
    // The open QA names a bundle the reservation no longer carries.
    expect(decide({ qaArtifactSha256: OTHER })).toEqual({
      ok: false,
      blocker: "QA_BINDING_DRIFT",
    });
  });

  test("refuses when payment is not authoritative or a reversal exists", () => {
    expect(decide({ paymentAuthoritative: false })).toEqual({
      ok: false,
      blocker: "PAYMENT_NOT_AUTHORITATIVE",
    });
    expect(decide({ settlementReversed: true })).toEqual({
      ok: false,
      blocker: "PAYMENT_NOT_AUTHORITATIVE",
    });
    expect(decide({ orderStatus: "SETTLEMENT_HOLD" })).toEqual({
      ok: false,
      blocker: "PAYMENT_NOT_AUTHORITATIVE",
    });
  });

  test("serves the customer ZIP only when the whole artifact chain is delivery-ready", () => {
    const ready = {
      artifactKind: "CUSTOMER_ZIP",
      expectedSha256: ZIP,
      qaStatus: "APPROVED",
      qaCustomerArtifactSha256: ZIP,
      customerZipSha256: ZIP,
      latestArtifactSha256: ZIP,
      fulfillmentStatus: "ARTIFACT_READY",
    };
    expect(decide(ready)).toMatchObject({
      ok: true,
      purpose: "DELIVERY_PREPARE",
      artifactKind: "CUSTOMER_ZIP",
      expectedSha256: ZIP,
    });
    for (const drift of [
      { latestArtifactSha256: OTHER },
      { customerZipSha256: OTHER },
      { fulfillmentStatus: "NOT_STARTED" },
      { qaStatus: "IN_REVIEW" },
    ])
      expect(decide({ ...ready, ...drift })).toEqual({
        ok: false,
        blocker: "DELIVERY_NOT_READY",
      });
    // Slice 2 is absent, so no delivery row can exist; if one did, the operator
    // read would still refuse rather than invent a state.
    expect(decide({ ...ready, deliveryStatus: "CONFIRMED" })).toEqual({
      ok: false,
      blocker: "DELIVERY_NOT_READY",
    });
  });

  test("an internal read never requires a delivery row and a ZIP read never requires an open QA", () => {
    expect(decide({ deliveryStatus: null })).toMatchObject({ ok: true });
    expect(
      decide({
        artifactKind: "CUSTOMER_ZIP",
        expectedSha256: ZIP,
        qaStatus: "APPROVED",
        qaReviewerKey: "admin:u2",
        qaCustomerArtifactSha256: ZIP,
        customerZipSha256: ZIP,
        latestArtifactSha256: ZIP,
        fulfillmentStatus: "ARTIFACT_READY",
      }),
    ).toMatchObject({ ok: true });
  });

  test("every blocker is a closed non-PII code", () => {
    const blockers = [
      decide({ artifactKind: "X" }),
      decide({ actorKey: "x" }),
      decide({ expectedSha256: "x" }),
      decide({ reservationStatus: "STAGED" }),
      decide({ paymentAuthoritative: false }),
      decide({ qaStatus: "APPROVED" }),
      decide({ qaArtifactSha256: OTHER }),
    ];
    for (const result of blockers) {
      expect(result.ok).toBe(false);
      expect("blocker" in result && result.blocker).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("neutralQaApprovalReadSatisfied (I-3, T-08)", () => {
  const startedAt = new Date("2026-09-22T10:00:00.000Z");
  const read = (overrides: Record<string, unknown> = {}) => ({
    actorKey: "admin:u1",
    purpose: "QA_REVIEW",
    artifactKind: "INTERNAL_PDF",
    reservationBundleSha256: BUNDLE,
    servedAt: new Date("2026-09-22T10:05:00.000Z"),
    ...overrides,
  });

  const satisfied = (reads: ReturnType<typeof read>[]) =>
    neutralQaApprovalReadSatisfied({
      reads: reads as never,
      reviewerKey: "admin:u1",
      bundleSha256: BUNDLE,
      startedAt,
    });

  test("refuses approval with no read at all", () => {
    expect(satisfied([])).toBe(false);
  });

  test("accepts one exact same-reviewer read of the current bundle after opening", () => {
    expect(satisfied([read()])).toBe(true);
    expect(satisfied([read({ artifactKind: "INTERNAL_CSV" })])).toBe(true);
    // Exactly at started_at counts: served_at >= qa.started_at.
    expect(satisfied([read({ servedAt: startedAt })])).toBe(true);
  });

  test("refuses a read of stale bytes", () => {
    expect(satisfied([read({ reservationBundleSha256: OTHER })])).toBe(false);
  });

  test("refuses another reviewer's read", () => {
    expect(satisfied([read({ actorKey: "admin:u2" })])).toBe(false);
  });

  test("refuses a pre-open read", () => {
    expect(
      satisfied([read({ servedAt: new Date("2026-09-22T09:59:59.999Z") })]),
    ).toBe(false);
  });

  test("refuses a read taken for another purpose or of the customer ZIP", () => {
    expect(satisfied([read({ purpose: "DELIVERY_PREPARE" })])).toBe(false);
    expect(
      satisfied([
        read({ purpose: "DELIVERY_PREPARE", artifactKind: "CUSTOMER_ZIP" }),
      ]),
    ).toBe(false);
    expect(satisfied([read({ artifactKind: "CUSTOMER_ZIP" })])).toBe(false);
  });

  test("accepts when one qualifying read sits among disqualified ones", () => {
    expect(
      satisfied([
        read({ actorKey: "admin:u2" }),
        read({ reservationBundleSha256: OTHER }),
        read({ servedAt: new Date("2026-09-22T09:00:00.000Z") }),
        read(),
      ]),
    ).toBe(true);
  });

  test("refuses when the current bundle digest is absent", () => {
    expect(
      neutralQaApprovalReadSatisfied({
        reads: [read()] as never,
        reviewerKey: "admin:u1",
        bundleSha256: null,
        startedAt,
      }),
    ).toBe(false);
  });
});
