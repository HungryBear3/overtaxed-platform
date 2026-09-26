/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

const sources = [
  "lib/fulfillment-runtime/neutral-generation-worker.ts",
  "lib/fulfillment-runtime/neutral-generation-store.ts",
  "lib/fulfillment-runtime/neutral-generation-scheduling.ts",
  "lib/fulfillment-runtime/neutral-generation-recovery.ts",
  "app/api/cron/neutral-report-production/route.ts",
]
  .map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"))
  .join("\n");

test("production slice has no QA, delivery, send, promotion, capability, or fulfillment mutation edge", () => {
  expect(sources).not.toMatch(
    /sendEmail|sendOrder|Resend|OTDeliveryAttempt|OTDeliveryEvent|OTFulfillmentArtifact|issueT2PacketCapability|neutral-customer-promotion|neutral-qa-store/,
  );
  expect(sources).not.toMatch(
    /INSERT INTO "ot_fulfillment"|UPDATE "ot_order"|INSERT INTO "ot_delivery_/,
  );
});

test("sweep reclaims pre-start work, holds expired producing work, and excludes active producing work", () => {
  const store = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/fulfillment-runtime/neutral-generation-store.ts",
    ),
    "utf8",
  );
  expect(store).toContain("w.\"status\" IN ('PENDING','RETRY_REQUIRED')");
  expect(store).toContain(
    'w."status"=\'CLAIMED\' AND w."lease_expires_at"<=CURRENT_TIMESTAMP',
  );
  expect(store).toContain(
    'w."status"=\'PRODUCING\' AND w."lease_expires_at"<=CURRENT_TIMESTAMP',
  );
  expect(store).toContain("'PRODUCTION_OUTCOME_UNKNOWN'");
  expect(store).not.toContain(
    'w."status"=\'PRODUCING\' AND w."lease_expires_at">CURRENT_TIMESTAMP',
  );
  expect(store).not.toContain('s."status"=\'RECONCILIATION_REQUIRED\'');
});

test("production begins atomically under authority and finalizes only from exact producing fence", () => {
  const store = fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/fulfillment-runtime/neutral-generation-store.ts",
    ),
    "utf8",
  );
  expect(store).toContain("async beginProduction(input)");
  expect(store).toMatch(
    /beginProduction[\s\S]*SET "status"='PRODUCING'[\s\S]*AND \$\{authority\(\)\}/,
  );
  expect(store).toMatch(
    /transition[\s\S]*WHERE "id"=\$\{input\.workId\} AND "status"='PRODUCING'[\s\S]*"status_revision"=\$\{input\.revision\}[\s\S]*"lease_owner"=\$\{input\.owner\}[\s\S]*"lease_token"=\$\{input\.token\}/,
  );
});

/**
 * T-10: the Slice 1 operator-ledger surface. Same boundary discipline as the
 * production slice, applied to the modules and routes added for manual QA.
 */
const operatorSourceFiles = [
  "lib/fulfillment/neutral-order-classification.ts",
  "lib/fulfillment/neutral-operator-read.ts",
  "lib/fulfillment/neutral-operator-queue.ts",
  "lib/fulfillment-runtime/neutral-order-classification-store.ts",
  "lib/fulfillment-runtime/neutral-operator-read-store.ts",
  "lib/fulfillment-runtime/neutral-operator-queue.ts",
  "lib/fulfillment-runtime/neutral-operator-route-headers.ts",
  "app/api/admin/neutral-reports/queue/route.ts",
  "app/api/admin/neutral-reports/[orderId]/classification/route.ts",
  "app/api/admin/neutral-reports/[orderId]/artifact/route.ts",
];

const operatorSources = operatorSourceFiles
  .map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8"))
  .join("\n");

test("operator ledger slice has no send, provider, capability, or delivery-attempt edge", () => {
  expect(operatorSources).not.toMatch(
    /sendEmail|sendOrder|Resend|resend|nodemailer|OTDeliveryAttempt|OTDeliveryEvent|issueT2PacketCapability|packet-download|t2-resend-adapter|neutral-customer-promotion|neutral-delivery-authority/,
  );
  expect(operatorSources).not.toMatch(/\bstripe\b|\bStripe\b/);
});

test("operator ledger slice mutates no order, fulfillment, delivery, or capability state", () => {
  expect(operatorSources).not.toMatch(
    /UPDATE "ot_order"|UPDATE "ot_fulfillment"|INSERT INTO "ot_fulfillment"|INSERT INTO "ot_delivery_|UPDATE "ot_delivery_|INSERT INTO "ot_packet_download_capability"|INSERT INTO "ot_neutral_report_reservation"|UPDATE "ot_neutral_report_reservation"/,
  );
  // Slice 1 defines the manual delivery table but drives no transition on it.
  expect(operatorSources).not.toMatch(
    /INSERT INTO "ot_neutral_manual_delivery"|UPDATE "ot_neutral_manual_delivery"/,
  );
  // The only two writes the whole slice performs.
  expect(operatorSources).toContain('INSERT INTO "ot_neutral_order_classification"');
  expect(operatorSources).toContain('INSERT INTO "ot_neutral_operator_artifact_read"');
});

test("operator reads go through the digest-verifying storage helpers only", () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), "lib/fulfillment-runtime/neutral-operator-read-store.ts"),
    "utf8",
  );
  // The allowed read-only exception: helpers that refuse on digest mismatch.
  expect(store).toContain("readNeutralBundle");
  expect(store).toContain("readNeutralCustomerZip");
  // Never the storage primitives directly, and never a public URL.
  expect(store).not.toMatch(/@vercel\/blob|\bput\(|downloadUrl|publicUrl|https?:\/\//);
});

test("no operator module reads a commerce table directly", () => {
  // The neutral runtime role has no direct grant on these; every commerce fact
  // arrives through the security-barrier views.
  expect(operatorSources).not.toMatch(
    /FROM "ot_order"|FROM "ot_payment_binding"|FROM "ot_settlement_reversal"/,
  );
  expect(operatorSources).toContain('"ot_neutral_runtime_order"');
});

test("the QA approval precondition is enforced in the QA store, not merely available", () => {
  const qa = fs.readFileSync(
    path.join(process.cwd(), "lib/fulfillment-runtime/neutral-qa-store.ts"),
    "utf8",
  );
  expect(qa).toContain("neutralQaApprovalReadSatisfied");
  expect(qa).toContain('blocker:"QA_READ_AUDIT_REQUIRED"');
  expect(qa).toContain('"ot_neutral_operator_artifact_read"');
  // It must guard the APPROVED branch specifically.
  expect(qa).toMatch(
    /decision\.status==="APPROVED"[\s\S]{0,900}QA_READ_AUDIT_REQUIRED/,
  );
});
