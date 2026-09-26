/**
 * Pure decisions for the operator artifact read, and the QA approval
 * precondition it exists to make true.
 *
 * G-7 in the architecture: before this slice, "approved for hash X" was a claim
 * about a row the reviewer typed, not about bytes they saw. An approval is now
 * admissible only when the same reviewer was SERVED the current bundle after
 * opening the review, and the serving path writes an audit row only after a
 * digest-verifying storage helper returned the bytes.
 *
 * Nothing here performs IO. The store reads every fact fresh in one transaction
 * and passes it in; this module decides.
 */

import { neutralCustomerArtifactChainIntact } from "./neutral-operator-queue";

export const NEUTRAL_OPERATOR_ARTIFACT_KINDS = [
  "INTERNAL_PDF",
  "INTERNAL_CSV",
  "CUSTOMER_ZIP",
] as const;

export type NeutralOperatorArtifactKind =
  (typeof NEUTRAL_OPERATOR_ARTIFACT_KINDS)[number];

export const NEUTRAL_OPERATOR_READ_PURPOSES = [
  "QA_REVIEW",
  "DELIVERY_PREPARE",
] as const;

export type NeutralOperatorReadPurpose =
  (typeof NEUTRAL_OPERATOR_READ_PURPOSES)[number];

const ACTOR_KEY = /^admin:[A-Za-z0-9_-]{1,128}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Purpose is DERIVED from the kind, never accepted from the caller. The SQL
 * state-shape CHECK enforces the same pairing, so a route that tried to audit a
 * customer-ZIP read as QA evidence would be refused by the database too.
 */
export function purposeForArtifactKind(
  kind: string,
): NeutralOperatorReadPurpose | null {
  if (kind === "INTERNAL_PDF" || kind === "INTERNAL_CSV") return "QA_REVIEW";
  if (kind === "CUSTOMER_ZIP") return "DELIVERY_PREPARE";
  return null;
}

export type NeutralOperatorReadBlocker =
  | "INVALID_ACTOR"
  | "INVALID_ARTIFACT_KIND"
  | "INVALID_DIGEST"
  | "ARTIFACT_NOT_PROMOTED"
  | "PAYMENT_NOT_AUTHORITATIVE"
  | "QA_NOT_OPEN_FOR_ACTOR"
  | "QA_BINDING_DRIFT"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "DELIVERY_NOT_READY";

export type NeutralOperatorReadContext = {
  actorKey: string;
  artifactKind: string;
  expectedSha256: string;
  orderStatus: string;
  paymentAuthoritative: boolean;
  settlementReversed: boolean;
  reservationStatus: string;
  bundleSha256: string | null;
  manifestSha256: string | null;
  pdfSha256: string | null;
  csvSha256: string | null;
  customerZipSha256: string | null;
  qaStatus: string | null;
  qaReviewerKey: string | null;
  qaArtifactSha256: string | null;
  qaCustomerArtifactSha256: string | null;
  latestArtifactSha256: string | null;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
};

export type NeutralOperatorReadDecision =
  | {
      ok: true;
      purpose: NeutralOperatorReadPurpose;
      artifactKind: NeutralOperatorArtifactKind;
      /** The digest the served bytes MUST hash to. */
      expectedSha256: string;
      /** The reservation identity to pin on the audit row. */
      bundleSha256: string;
    }
  | { ok: false; blocker: NeutralOperatorReadBlocker };

export function decideNeutralOperatorRead(
  input: NeutralOperatorReadContext,
): NeutralOperatorReadDecision {
  const purpose = purposeForArtifactKind(input.artifactKind);
  if (purpose === null) return { ok: false, blocker: "INVALID_ARTIFACT_KIND" };
  if (!ACTOR_KEY.test(input.actorKey))
    return { ok: false, blocker: "INVALID_ACTOR" };
  if (!SHA256_HEX.test(input.expectedSha256))
    return { ok: false, blocker: "INVALID_DIGEST" };

  // An operator may not read the bytes of an order whose payment is not
  // authoritative, in either direction: never settled, or reversed since.
  if (
    !input.paymentAuthoritative ||
    input.settlementReversed ||
    input.orderStatus === "SETTLEMENT_HOLD"
  )
    return { ok: false, blocker: "PAYMENT_NOT_AUTHORITATIVE" };

  if (
    input.reservationStatus !== "PROMOTED" ||
    input.bundleSha256 === null ||
    input.manifestSha256 === null
  )
    return { ok: false, blocker: "ARTIFACT_NOT_PROMOTED" };

  const bundleSha256 = input.bundleSha256;

  if (purpose === "QA_REVIEW") {
    // The reviewer must hold the open review themselves. Another reviewer's
    // open QA authorizes nothing.
    if (
      input.qaStatus !== "IN_REVIEW" ||
      input.qaReviewerKey !== input.actorKey
    )
      return { ok: false, blocker: "QA_NOT_OPEN_FOR_ACTOR" };
    // The open review must still name the reservation's current bundle.
    if (input.qaArtifactSha256 !== bundleSha256)
      return { ok: false, blocker: "QA_BINDING_DRIFT" };

    const current =
      input.artifactKind === "INTERNAL_PDF" ? input.pdfSha256 : input.csvSha256;
    if (current === null || current !== input.expectedSha256)
      return { ok: false, blocker: "ARTIFACT_DIGEST_MISMATCH" };

    return {
      ok: true,
      purpose,
      artifactKind: input.artifactKind as NeutralOperatorArtifactKind,
      expectedSha256: current,
      bundleSha256,
    };
  }

  // CUSTOMER_ZIP. Slice 1 has no manual-delivery store, so the only eligibility
  // is DELIVERY_READY: the whole chain agrees and no delivery row is active. An
  // active row would be Slice 2's to serve against, and this slice refuses
  // rather than inventing that state.
  if (
    !neutralCustomerArtifactChainIntact(input) ||
    input.deliveryStatus !== null
  )
    return { ok: false, blocker: "DELIVERY_NOT_READY" };
  if (input.qaCustomerArtifactSha256 !== input.expectedSha256)
    return { ok: false, blocker: "ARTIFACT_DIGEST_MISMATCH" };

  return {
    ok: true,
    purpose,
    artifactKind: "CUSTOMER_ZIP",
    expectedSha256: input.expectedSha256,
    bundleSha256,
  };
}

export type NeutralOperatorReadAudit = {
  actorKey: string;
  purpose: string;
  artifactKind: string;
  reservationBundleSha256: string;
  servedAt: Date;
};

/**
 * The QA approval precondition (architecture 4.4, invariant I-3).
 *
 * Admissible only when at least one audit row satisfies ALL of: same reviewer,
 * purpose QA_REVIEW, an internal artifact kind, the reservation bundle identity
 * that is current NOW, and served at or after the review was opened.
 *
 * A read of stale bytes, another reviewer's read, a pre-open read, and a read
 * taken for delivery all fail to authorize an approval.
 */
export function neutralQaApprovalReadSatisfied(input: {
  reads: readonly NeutralOperatorReadAudit[];
  reviewerKey: string;
  bundleSha256: string | null;
  startedAt: Date | null;
}): boolean {
  const { bundleSha256, startedAt } = input;
  if (bundleSha256 === null || !SHA256_HEX.test(bundleSha256)) return false;
  if (startedAt === null || !Number.isFinite(startedAt.getTime())) return false;

  return input.reads.some(
    (audit) =>
      audit.actorKey === input.reviewerKey &&
      audit.purpose === "QA_REVIEW" &&
      (audit.artifactKind === "INTERNAL_PDF" ||
        audit.artifactKind === "INTERNAL_CSV") &&
      audit.reservationBundleSha256 === bundleSha256 &&
      Number.isFinite(audit.servedAt.getTime()) &&
      audit.servedAt.getTime() >= startedAt.getTime(),
  );
}
