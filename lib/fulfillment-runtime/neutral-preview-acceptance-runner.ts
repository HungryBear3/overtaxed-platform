import "server-only";

import { createHash } from "node:crypto";
import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy";
import { computePropertyBindingFingerprint } from "@/lib/fulfillment/artifact-digest";
import {
  createNeutralCustomerZip,
  neutralCustomerZipLocator,
  neutralCustomerZipSha256,
  NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE,
} from "@/lib/fulfillment/neutral-customer-zip";
import type { NeutralReportWrite } from "@/lib/fulfillment/neutral-report-content";
import { hashPacketDownloadCapability } from "@/lib/fulfillment/packet-download";
import {
  assertPreviewAcceptanceRunId,
  PROBE_TARGETS,
  type AcceptanceIdKind,
  type AcceptanceRowProbe,
  type PreviewAcceptanceEvidence,
  type Queryable,
} from "@/lib/fulfillment/neutral-preview-acceptance";
import {
  createNeutralTransactionExecutor,
  type NeutralDbExecutor,
} from "@/lib/fulfillment-runtime/neutral-db-executor";

/**
 * ---------------------------------------------------------------------------
 * Synthetic behavioural acceptance
 * ---------------------------------------------------------------------------
 *
 * Everything below drives the REAL production helpers against one transaction
 * the caller owns, then discards it. Raw SQL appears only where a row has no
 * public helper that could create it inside a transaction: the commerce order,
 * its immutable payment binding, the promoted reservation (whose production
 * path writes an immutable blob object that a ROLLBACK could not take back),
 * and the settlement-reversal webhook evidence.
 *
 * Nothing here constructs a provider adapter, a Stripe client, or a blob store.
 * Object storage is a local in-memory map injected into the production
 * promotion helper, and the refund provider lookup is an injected function.
 */

const POLICY_VERSION = NEUTRAL_REPORT_COMMERCE_POLICY.version;
const SYNTHETIC_PROVIDER = "synthetic-local";
const SYNTHETIC_EMAIL = "synthetic@example.invalid";
const SYNTHETIC_PIN = "10000000000000";
const SYNTHETIC_DRIFTED_PIN = "10000000000001";
const SYNTHETIC_ADDRESS = "100 Synthetic Acceptance Ave";
const SYNTHETIC_PRICE_ID = "price_neutral_69";
const SYNTHETIC_PRODUCT_ID = "prod_neutral";

/**
 * Flags the journey needs, and flags it must withdraw.
 *
 * The helpers read `process.env` at call time, so the runner sets them for the
 * duration of the run and restores the prior values in `finally`. Every flag
 * set to `"true"` gates DATABASE behaviour only. The three set to `undefined`
 * are the ones that could reach the outside world — the real mail adapter, the
 * signed provider callback, and the two blob stores — so the run cannot
 * construct them even if a helper tried.
 */
const ACCEPTANCE_FLAGS: Readonly<Record<string, string | undefined>> = {
  OT_NEUTRAL_REPORT_CHECKOUT_ENABLED: "true",
  OT_NEUTRAL_QA_ENABLED: "true",
  OT_NEUTRAL_CUSTOMER_ZIP_PROMOTION_ENABLED: "true",
  OT_NEUTRAL_REFUND_QUEUE_ENABLED: "true",
  OT_NEUTRAL_REFUND_VERIFICATION_ENABLED: "true",
  OT_NEUTRAL_DELIVERY_ENABLED: "true",
  OT_T2_DELIVERY_ENABLED: "true",
  OT_T2_PACKET_DOWNLOAD_ENABLED: "true",
  OT_T2_DELIVERY_ADAPTER_ENABLED: undefined,
  OT_T2_DELIVERY_CALLBACK_ENABLED: undefined,
  OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED: undefined,
  OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED: undefined,
};

export function applyAcceptanceFlags(
  env: Record<string, string | undefined> = process.env,
): () => void {
  const prior = Object.keys(ACCEPTANCE_FLAGS).map(
    (key) => [key, env[key]] as const,
  );
  for (const [key, value] of Object.entries(ACCEPTANCE_FLAGS)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return () => {
    for (const [key, value] of prior) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };
}

/** The production modules the journey drives, injectable so a test can fake them. */
export type AcceptanceRuntime = {
  repository: typeof import("@/lib/fulfillment-runtime/neutral-report-repository");
  qa: typeof import("@/lib/fulfillment-runtime/neutral-qa-store");
  refund: typeof import("@/lib/fulfillment-runtime/neutral-refund-store");
  promotion: typeof import("@/lib/fulfillment-runtime/neutral-customer-promotion");
  packet: typeof import("@/lib/fulfillment-runtime/packet-download-store");
  issuance: typeof import("@/lib/fulfillment-runtime/t2-packet-issuance");
  delivery: typeof import("@/lib/fulfillment-runtime/delivery-store");
  deliveryDb: typeof import("@/lib/fulfillment-runtime/neutral-delivery-db");
};

/**
 * Loaded on demand, never at module scope: importing these pulls in
 * `server-only` and a Prisma client, and the configuration/redaction helpers
 * above must stay importable without either.
 */
export async function loadAcceptanceRuntime(): Promise<AcceptanceRuntime> {
  const [repository, qa, refund, promotion, packet, issuance, delivery, deliveryDb] =
    await Promise.all([
      import("@/lib/fulfillment-runtime/neutral-report-repository"),
      import("@/lib/fulfillment-runtime/neutral-qa-store"),
      import("@/lib/fulfillment-runtime/neutral-refund-store"),
      import("@/lib/fulfillment-runtime/neutral-customer-promotion"),
      import("@/lib/fulfillment-runtime/packet-download-store"),
      import("@/lib/fulfillment-runtime/t2-packet-issuance"),
      import("@/lib/fulfillment-runtime/delivery-store"),
      import("@/lib/fulfillment-runtime/neutral-delivery-db"),
    ]);
  return { repository, qa, refund, promotion, packet, issuance, delivery, deliveryDb };
}

class AcceptanceLedger {
  private readonly recorded = new Map<AcceptanceIdKind, Set<string>>();
  record(kind: AcceptanceIdKind, value: unknown): void {
    if (typeof value !== "string" || value === "") return;
    const set = this.recorded.get(kind) ?? new Set<string>();
    set.add(value);
    this.recorded.set(kind, set);
  }
  probes(): AcceptanceRowProbe[] {
    const merged = new Map<string, Set<string>>();
    for (const [kind, values] of this.recorded)
      for (const [table, column] of PROBE_TARGETS[kind]) {
        const key = `${table}.${column}`;
        const set = merged.get(key) ?? new Set<string>();
        for (const value of values) set.add(value);
        merged.set(key, set);
      }
    return [...merged].map(([key, values]) => {
      const [table, column] = key.split(".") as [string, string];
      return { table, column, values: [...values].sort() };
    });
  }
}

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function assertAcceptance(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition)
    throw new Error(`Synthetic acceptance proof failed: ${message}`);
}

/** Bounded, non-PII description of a refusal, for an assertion message only. */
function outcome(value: unknown): string {
  const result = value as { ok?: unknown; blocker?: unknown; status?: unknown };
  if (result && typeof result.blocker === "string") return result.blocker;
  if (result && typeof result.status === "string") return result.status;
  return String(result && typeof result.ok === "boolean" ? result.ok : value);
}

/** `Buffer.from(Uint8Array)` copies, which is what the production adapters return. */
const copyBytes = (bytes: Uint8Array): Buffer<ArrayBuffer> =>
  Buffer.from(new Uint8Array(bytes));

type SyntheticZipStorage = {
  objects: Map<string, Buffer<ArrayBuffer>>;
  adapters: {
    readBundle: (locator: string, expectedSha256: string) => Promise<NeutralReportWrite>;
    readCustomerZip: (locator: string) => Promise<Buffer<ArrayBuffer>>;
    writeCustomerZip: (bytes: Buffer) => Promise<{
      sha256: string;
      locator: string;
      byteSize: number;
      mediaType: typeof NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE;
    }>;
  };
};

/**
 * The internal evidence bundle a promoted reservation points at.
 *
 * Deterministic in its content address so the customer ZIP this run promotes is
 * byte-identical on every run of the same run ID, which is what makes the
 * promotion digest an assertion rather than an observation.
 */
function syntheticBundle(orderId: string, bundleSha256: string): NeutralReportWrite {
  return {
    key: `bundle-${orderId}`,
    pdf: Buffer.from(`%PDF-1.4\n% synthetic ${bundleSha256}\n%%EOF\n`),
    csv: Buffer.from(`field,value\nsubject,${bundleSha256}\n`),
    manifestJson: JSON.stringify({ orderId, policyVersion: POLICY_VERSION }),
    dataPages: [],
    calendarBytes: Buffer.from("BEGIN:VCALENDAR\nEND:VCALENDAR\n"),
    deadline: { closeDate: "2026-12-01", status: "SYNTHETIC" },
  };
}

function syntheticZipStorage(
  orderId: string,
  bundleSha256: string,
): SyntheticZipStorage {
  const bundle = syntheticBundle(orderId, bundleSha256);
  const objects = new Map<string, Buffer<ArrayBuffer>>();
  return {
    objects,
    adapters: {
      async readBundle(locator, expectedSha256) {
        assertAcceptance(
          expectedSha256 === bundleSha256 &&
            locator === `ot-neutral-reports/sha256/${bundleSha256}.json`,
          "promotion read an internal bundle it was not bound to",
        );
        return bundle;
      },
      async writeCustomerZip(bytes) {
        const sha256 = neutralCustomerZipSha256(bytes);
        const locator = neutralCustomerZipLocator(sha256);
        assertAcceptance(
          !objects.has(locator),
          "promotion attempted to overwrite an immutable customer object",
        );
        objects.set(locator, copyBytes(bytes));
        return {
          sha256,
          locator,
          byteSize: bytes.length,
          mediaType: NEUTRAL_CUSTOMER_ZIP_MEDIA_TYPE,
        };
      },
      async readCustomerZip(locator) {
        const bytes = objects.get(locator);
        if (!bytes) throw new Error("synthetic customer object absent");
        return copyBytes(bytes);
      },
    },
  };
}

type PromotedFixture = {
  orderId: string;
  sessionId: string;
  paymentIntent: string;
  reservationId: string;
  propertyFingerprint: string;
  bundleSha256: string;
  reviewerKey: string;
};

type PromotedArtifact = PromotedFixture & {
  qaReviewId: string;
  fulfillmentId: string;
  artifactId: string;
  zipSha256: string;
  zipLocator: string;
  storage: SyntheticZipStorage;
};

async function seedCheckoutOrder(
  db: Queryable,
  orderId: string,
  status: "CHECKOUT_PENDING" | "CHECKOUT_FAILED",
): Promise<void> {
  await db.query(
    `insert into ot_order(id,tier,email,"propertyPin","propertyAddress","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency","amountPaid",status,"eligibilitySnapshot","createdAt","updatedAt") values($1,'T2',$2,$3,$4,$5,$6,6900,'usd',0,$7,$8::jsonb,clock_timestamp(),clock_timestamp())`,
    [
      orderId,
      SYNTHETIC_EMAIL,
      SYNTHETIC_PIN,
      SYNTHETIC_ADDRESS,
      SYNTHETIC_PRICE_ID,
      SYNTHETIC_PRODUCT_ID,
      status,
      JSON.stringify({ policyVersion: POLICY_VERSION }),
    ],
  );
}

/**
 * A settled order whose reservation is already PROMOTED.
 *
 * Raw SQL on purpose: the production path from RESERVED to PROMOTED writes an
 * immutable blob object, and an object write is exactly the thing a ROLLBACK
 * cannot undo. The columns mirror what `stage`/`promote` persist, including the
 * delivery-grade property binding fingerprint, so every helper downstream reads
 * the same shape it would read in production.
 */
async function seedPromotedFixture(
  db: Queryable,
  runId: string,
  suffix: string,
  ledger: AcceptanceLedger,
): Promise<PromotedFixture> {
  const orderId = `${runId}-${suffix}-order`;
  const sessionId = `cs_${digest(`${runId}/${suffix}/session`).slice(0, 32)}`;
  const paymentIntent = `pi_${digest(`${runId}/${suffix}/intent`).slice(0, 32)}`;
  const reservationId = `${runId}-${suffix}-reservation`;
  const bundleSha256 = digest(`${runId}/${suffix}/bundle`);
  const propertyFingerprint = computePropertyBindingFingerprint({
    orderId,
    propertyPin: SYNTHETIC_PIN,
    propertyAddress: SYNTHETIC_ADDRESS,
  });
  await db.query(
    `insert into ot_order(id,"stripeSessionId",tier,email,"propertyPin","propertyAddress","checkoutPriceId","checkoutProductId","checkoutAmountCents","checkoutCurrency","settledAmountCents","settledCurrency","amountPaid",status,"eligibilitySnapshot","createdAt","updatedAt") values($1,$2,'T2',$3,$4,$5,$6,$7,6900,'usd',6900,'usd',69,'PAID',$8::jsonb,clock_timestamp(),clock_timestamp())`,
    [
      orderId,
      sessionId,
      SYNTHETIC_EMAIL,
      SYNTHETIC_PIN,
      SYNTHETIC_ADDRESS,
      SYNTHETIC_PRICE_ID,
      SYNTHETIC_PRODUCT_ID,
      JSON.stringify({ policyVersion: POLICY_VERSION }),
    ],
  );
  await db.query(
    `insert into ot_payment_binding(order_id,session_id,payment_intent) values($1,$2,$3)`,
    [orderId, sessionId, paymentIntent],
  );
  await db.query(
    `insert into ot_neutral_report_reservation(id,order_id,policy_version,property_fingerprint,reservation_key,checkout_price_id,checkout_product_id,admission_sha256,data_evidence_sha256,deadline_evidence_sha256,source_content_sha256,deadline_identity_sha256,official_retrieved_at,official_oldest_retrieved_at,official_max_age_seconds,deadline_retrieved_at,cohort_position,precheckout_lease_expires_at,reviewer_key,reviewer_week_start,status,bundle_sha256,manifest_sha256,pdf_sha256,csv_sha256,private_references,staged_at,promoted_at,created_at,updated_at)
     select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '3 minutes',180,clock_timestamp()-interval '2 minutes',
       (select slot from generate_series(1,10) slot where not exists(select 1 from ot_neutral_report_reservation r where r.cohort_position=slot and r.status<>'ABANDONED') order by slot limit 1),
       clock_timestamp()+interval '30 minutes','pilot-primary',
       (clock_timestamp() at time zone 'America/Chicago')::date-(extract(isodow from clock_timestamp() at time zone 'America/Chicago')::int-1),
       'PROMOTED',$13,$14,$15,$16,$17::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp()`,
    [
      reservationId,
      orderId,
      POLICY_VERSION,
      propertyFingerprint,
      `${runId}-${suffix}-reservation-key`,
      SYNTHETIC_PRICE_ID,
      SYNTHETIC_PRODUCT_ID,
      digest(`${runId}/${suffix}/admission`),
      digest(`${runId}/${suffix}/data-evidence`),
      digest(`${runId}/${suffix}/deadline-evidence`),
      digest(`${runId}/${suffix}/source-content`),
      digest(`${runId}/${suffix}/deadline-identity`),
      bundleSha256,
      digest(`${runId}/${suffix}/manifest`),
      digest(`${runId}/${suffix}/pdf`),
      digest(`${runId}/${suffix}/csv`),
      JSON.stringify({
        locator: `ot-neutral-reports/sha256/${bundleSha256}.json`,
        receipt: { key: `bundle-${orderId}` },
      }),
    ],
  );
  ledger.record("reservation", reservationId);
  return {
    orderId,
    sessionId,
    paymentIntent,
    reservationId,
    propertyFingerprint,
    bundleSha256,
    reviewerKey: `${suffix}-${runId}`,
  };
}

/**
 * Checkout admission inputs derived from the run ID.
 *
 * Deterministic per run — the same run ID always produces the same digests — and
 * freshly timestamped, because `reserveNeutralCheckoutOrder` refuses stale
 * official-records admission evidence.
 */
function checkoutAdmission(runId: string) {
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  return {
    dataEvidenceSha256: digest(`${runId}/checkout/data-evidence`),
    sourceContentSha256: digest(`${runId}/checkout/source-content`),
    deadlineEvidenceSha256: digest(`${runId}/checkout/deadline-evidence`),
    deadlineIdentitySha256: digest(`${runId}/checkout/deadline-identity`),
    admissionSha256: digest(`${runId}/checkout/admission`),
    officialRetrievedAt: at(120_000),
    officialOldestRetrievedAt: at(180_000),
    deadlineRetrievedAt: at(120_000),
  };
}

/**
 * Checkout reservation: duplicate admission is idempotent, drifted property
 * binding is refused, and each terminal outcome is a one-shot compare-and-set.
 */
async function proveCheckoutBinding(
  db: Queryable,
  tx: NeutralDbExecutor,
  step: <T>(work: () => Promise<T>) => Promise<T>,
  runId: string,
  runtime: AcceptanceRuntime,
  ledger: AcceptanceLedger,
): Promise<void> {
  const { reserveNeutralCheckoutOrder, markNeutralCheckoutOutcomeUnknown, abandonNeutralCheckoutReservation } =
    runtime.repository;
  const admission = checkoutAdmission(runId);
  const reservedOrder = `${runId}-checkout-order`;
  const abandonedOrder = `${runId}-abandon-order`;
  await seedCheckoutOrder(db, reservedOrder, "CHECKOUT_PENDING");
  await seedCheckoutOrder(db, abandonedOrder, "CHECKOUT_FAILED");

  const reserve = (orderId: string, propertyPin: string) =>
    step(() =>
      reserveNeutralCheckoutOrder({ ...admission, orderId, propertyPin }, { db: tx }),
    );

  const first = await reserve(reservedOrder, SYNTHETIC_PIN);
  assertAcceptance(
    first.ok,
    `checkout reservation refused (${outcome(first)}); the pilot cohort or weekly reviewer capacity may already be full`,
  );
  const duplicate = await reserve(reservedOrder, SYNTHETIC_PIN);
  assertAcceptance(
    duplicate.ok,
    `duplicate checkout admission was not idempotent (${outcome(duplicate)})`,
  );
  const rows = await db.query(
    `select id from ot_neutral_report_reservation where order_id=$1`,
    [reservedOrder],
  );
  assertAcceptance(
    rows.rowCount === 1,
    "duplicate checkout admission created a second reservation",
  );
  ledger.record("reservation", rows.rows[0]?.id);

  const drifted = await reserve(reservedOrder, SYNTHETIC_DRIFTED_PIN);
  assertAcceptance(
    !drifted.ok && drifted.blocker === "NEUTRAL_RESERVATION_CONFLICT",
    `a drifted property binding was not refused (${outcome(drifted)})`,
  );

  assertAcceptance(
    (await step(() => markNeutralCheckoutOutcomeUnknown(reservedOrder, { db: tx }))) === true,
    "an unknown Stripe checkout outcome was not recorded",
  );
  assertAcceptance(
    (await step(() => markNeutralCheckoutOutcomeUnknown(reservedOrder, { db: tx }))) === false,
    "recording an unknown checkout outcome twice was not a one-shot compare-and-set",
  );
  const unresolved = await db.query(
    `select status::text status,reconciliation_code from ot_neutral_report_reservation where order_id=$1`,
    [reservedOrder],
  );
  assertAcceptance(
    unresolved.rows[0]?.status === "RECONCILIATION_REQUIRED" &&
      unresolved.rows[0]?.reconciliation_code === "STRIPE_CHECKOUT_OUTCOME_UNKNOWN",
    "an unknown checkout outcome did not leave the reservation held for reconciliation",
  );
  const afterUnknown = await reserve(reservedOrder, SYNTHETIC_PIN);
  assertAcceptance(
    !afterUnknown.ok && afterUnknown.blocker === "NEUTRAL_RESERVATION_CONFLICT",
    `a reservation held for reconciliation was silently re-admitted (${outcome(afterUnknown)})`,
  );

  const abandonable = await reserve(abandonedOrder, SYNTHETIC_PIN);
  assertAcceptance(
    abandonable.ok,
    `checkout reservation for the abandonment proof was refused (${outcome(abandonable)})`,
  );
  const abandonedRows = await db.query(
    `select id from ot_neutral_report_reservation where order_id=$1`,
    [abandonedOrder],
  );
  ledger.record("reservation", abandonedRows.rows[0]?.id);
  assertAcceptance(
    (await step(() => abandonNeutralCheckoutReservation(abandonedOrder, { db: tx }))) === true,
    "a never-created checkout did not release its reservation",
  );
  assertAcceptance(
    (await step(() => abandonNeutralCheckoutReservation(abandonedOrder, { db: tx }))) === false,
    "releasing a reservation twice was not a one-shot compare-and-set",
  );
  const abandoned = await db.query(
    `select status::text status,reconciliation_code from ot_neutral_report_reservation where order_id=$1`,
    [abandonedOrder],
  );
  assertAcceptance(
    abandoned.rows[0]?.status === "ABANDONED" &&
      abandoned.rows[0]?.reconciliation_code === "CHECKOUT_NEVER_CREATED",
    "a released reservation did not record why it was released",
  );
}

/** Human QA opens once, decides once, and only then may a customer ZIP exist. */
async function proveQaAndPromotion(
  db: Queryable,
  tx: NeutralDbExecutor,
  step: <T>(work: () => Promise<T>) => Promise<T>,
  runtime: AcceptanceRuntime,
  ledger: AcceptanceLedger,
  fixture: PromotedFixture,
): Promise<PromotedArtifact> {
  const { openNeutralQaReview, decideNeutralQaReview } = runtime.qa;
  const { promoteApprovedNeutralCustomerZip } = runtime.promotion;
  const { orderId, reviewerKey } = fixture;

  const opened = await step(() => openNeutralQaReview({ orderId, reviewerKey }, { db: tx }));
  assertAcceptance(opened.ok, `QA review could not be opened (${outcome(opened)})`);
  ledger.record("qaReview", opened.reviewId);
  const reopened = await step(() => openNeutralQaReview({ orderId, reviewerKey }, { db: tx }));
  assertAcceptance(
    reopened.ok && reopened.reviewId === opened.reviewId,
    `re-opening a QA review did not return the same durable ledger entry (${outcome(reopened)})`,
  );

  const decided = await step(() =>
    decideNeutralQaReview(
      { orderId, reviewerKey, decision: "approve", minutesSpent: 1, reasonCode: "QA_PASSED" },
      { db: tx },
    ),
  );
  assertAcceptance(
    decided.ok && decided.status === "APPROVED" && decided.customerArtifactPending === true,
    `QA approval was refused or claimed a customer artifact it had not produced (${outcome(decided)})`,
  );
  const redecided = await step(() =>
    decideNeutralQaReview(
      { orderId, reviewerKey, decision: "approve", minutesSpent: 1, reasonCode: "QA_PASSED" },
      { db: tx },
    ),
  );
  assertAcceptance(
    !redecided.ok && redecided.blocker === "QA_ALREADY_DECIDED",
    `a decided QA review was decided a second time (${outcome(redecided)})`,
  );

  const storage = syntheticZipStorage(orderId, fixture.bundleSha256);
  const bundle = syntheticBundle(orderId, fixture.bundleSha256);
  const expectedZipSha256 = neutralCustomerZipSha256(
    createNeutralCustomerZip({ pdf: bundle.pdf, csv: bundle.csv }),
  );
  const expectedZipLocator = neutralCustomerZipLocator(expectedZipSha256);

  const promoted = await step(() =>
    promoteApprovedNeutralCustomerZip(orderId, { db: tx, ...storage.adapters }),
  );
  assertAcceptance(
    promoted.ok && promoted.created === true && promoted.sha256 === expectedZipSha256,
    `customer ZIP promotion refused or produced a non-deterministic digest (${outcome(promoted)})`,
  );
  assertAcceptance(
    storage.objects.size === 1 && storage.objects.has(expectedZipLocator),
    "promotion did not write exactly one content-addressed customer object",
  );
  const repeated = await step(() =>
    promoteApprovedNeutralCustomerZip(orderId, { db: tx, ...storage.adapters }),
  );
  assertAcceptance(
    repeated.ok && repeated.created === false && repeated.sha256 === expectedZipSha256,
    `re-promotion was not idempotent (${outcome(repeated)})`,
  );
  assertAcceptance(
    storage.objects.size === 1,
    "re-promotion wrote a second customer object",
  );

  const bound = await db.query(
    `select q."id" "qaReviewId",q."fulfillment_id" "fulfillmentId",q."customer_artifact_sha256" "customerSha256",a."id" "artifactId",a."artifact_sha256" "artifactSha256",a."storage_locator" "storageLocator",a."byte_size" "byteSize",a."version",a."template_version" "templateVersion",a."property_binding_fingerprint" "fingerprint",f."status"::text "fulfillmentStatus",f."attempt_count" "attemptCount" from ot_neutral_qa_review q join ot_fulfillment f on f."id"=q."fulfillment_id" join ot_fulfillment_artifact a on a."fulfillment_id"=f."id" where q."order_id"=$1`,
    [orderId],
  );
  const row = bound.rows[0];
  assertAcceptance(
    bound.rowCount === 1 && row,
    "promotion did not bind exactly one fulfillment artifact to the approved review",
  );
  ledger.record("fulfillment", row.fulfillmentId);
  ledger.record("artifact", row.artifactId);
  assertAcceptance(
    row.customerSha256 === expectedZipSha256 &&
      row.artifactSha256 === expectedZipSha256 &&
      row.storageLocator === expectedZipLocator &&
      row.version === 1 &&
      row.templateVersion === POLICY_VERSION &&
      row.fingerprint === fixture.propertyFingerprint &&
      row.fulfillmentStatus === "ARTIFACT_READY" &&
      row.attemptCount === 0,
    "the promoted artifact is not bound to the reviewed evidence and property binding",
  );
  return {
    ...fixture,
    qaReviewId: String(row.qaReviewId),
    fulfillmentId: String(row.fulfillmentId),
    artifactId: String(row.artifactId),
    zipSha256: expectedZipSha256,
    zipLocator: expectedZipLocator,
    storage,
  };
}

/**
 * Delivery gating, single-use capability issuance, and the deterministic
 * failure/retry contract: an ambiguous send is never re-sent, and a terminal
 * failure is never resurrected.
 */
async function proveDeliveryAndCapability(
  db: Queryable,
  tx: NeutralDbExecutor,
  step: <T>(work: () => Promise<T>) => Promise<T>,
  runId: string,
  runtime: AcceptanceRuntime,
  ledger: AcceptanceLedger,
  promoted: PromotedArtifact,
): Promise<{ capabilityHash: string }> {
  const { orderId, fulfillmentId, zipSha256, zipLocator } = promoted;
  assertAcceptance(
    (await runtime.deliveryDb.isNeutralDeliveryFulfillment(fulfillmentId, tx)) === true,
    "the promoted fulfillment is not recognised as neutral delivery work",
  );
  assertAcceptance(
    (await runtime.deliveryDb.isNeutralDeliveryFulfillment(`${runId}-absent`, tx)) === false,
    "an unknown fulfillment was recognised as neutral delivery work",
  );

  const deliveryStore = runtime.delivery.createPrismaT2DeliveryStore(
    tx as unknown as import("@/lib/fulfillment-runtime/delivery-store").T2DeliveryClient,
  );
  const owner = `acceptance-${runId}`;
  const token = digest(`${runId}/lease-token`);
  assertAcceptance(
    (await step(() =>
      deliveryStore.claim({ orderId, fulfillmentId, owner, token, leaseMs: 60_000 }),
    )) === true,
    "a QA-approved neutral fulfillment could not be leased for delivery",
  );
  const attempt = await step(() =>
    deliveryStore.persistAttempt({ orderId, fulfillmentId, provider: SYNTHETIC_PROVIDER, owner, token }),
  );
  assertAcceptance(
    attempt.ok && attempt.attemptNumber === 1 && attempt.artifactSha256 === zipSha256,
    `the durable delivery attempt was refused or bound to the wrong artifact (${outcome(attempt)})`,
  );
  const sendable = await step(() =>
    deliveryStore.assertSendable({
      orderId,
      fulfillmentId,
      owner,
      token,
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      idempotencyKey: attempt.idempotencyKey,
      provider: attempt.provider,
      artifactVersion: attempt.artifactVersion,
      artifactSha256: attempt.artifactSha256,
      propertyBindingFingerprint: attempt.propertyBindingFingerprint,
      statusRevision: attempt.statusRevision,
    }),
  );
  assertAcceptance(sendable.ok, `the pre-send gate refused a valid attempt (${outcome(sendable)})`);
  const concurrent = await step(() =>
    deliveryStore.persistAttempt({ orderId, fulfillmentId, provider: SYNTHETIC_PROVIDER, owner, token }),
  );
  assertAcceptance(
    !concurrent.ok && concurrent.blocker === "UNRESOLVED_SEND",
    `an in-flight send was allowed to start a second attempt (${outcome(concurrent)})`,
  );

  const store = runtime.packet.neutralPacketDownloadStore(
    tx as unknown as import("@/lib/fulfillment-runtime/packet-download-store").PacketDownloadClient,
  );
  const value = createHash("sha256").update(`${runId}/capability`).digest("base64url");
  const overBudget = await step(() =>
    runtime.issuance.issueT2PacketCapability(
      { fulfillmentId, attemptNumber: 1, provider: SYNTHETIC_PROVIDER, maxUses: 5 },
      { store, randomValue: () => value },
    ),
  );
  assertAcceptance(
    !overBudget.ok && overBudget.blocker === "INVALID_CAPABILITY",
    `a multi-use neutral capability was not refused (${outcome(overBudget)})`,
  );
  const issued = await step(() =>
    runtime.issuance.issueT2PacketCapability(
      { fulfillmentId, attemptNumber: 1, provider: SYNTHETIC_PROVIDER, maxUses: 1 },
      { store, randomValue: () => value },
    ),
  );
  assertAcceptance(
    issued.ok && issued.issuance.artifactSha256 === zipSha256 && issued.issuance.maxUses === 1,
    `single-use capability issuance was refused (${outcome(issued)})`,
  );
  ledger.record("capability", issued.issuance.capabilityId);
  const reminted = await step(() =>
    runtime.issuance.issueT2PacketCapability(
      { fulfillmentId, attemptNumber: 1, provider: SYNTHETIC_PROVIDER, maxUses: 1 },
      { store, randomValue: () => digest(`${runId}/capability-remint`).slice(0, 43) },
    ),
  );
  assertAcceptance(
    !reminted.ok && reminted.blocker === "CAPABILITY_BINDING_MISMATCH",
    `an attempt that already issued a credential minted a second one (${outcome(reminted)})`,
  );

  const capabilityHash = hashPacketDownloadCapability(issued.issuance.value);
  assertAcceptance(
    typeof capabilityHash === "string",
    "the issued capability value is not a well-formed credential",
  );
  const authorized = await step(() => store.authorize({ capabilityHash }));
  assertAcceptance(
    authorized.ok &&
      authorized.grant.artifactSha256 === zipSha256 &&
      authorized.grant.storageLocator === zipLocator &&
      authorized.grant.orderId === orderId,
    `the single use could not be claimed against the promoted artifact (${outcome(authorized)})`,
  );
  const reasserted = await step(() =>
    store.reassert({ capabilityHash, grant: authorized.grant }),
  );
  assertAcceptance(
    reasserted.ok,
    `re-verifying authority before handing over bytes refused a live grant (${outcome(reasserted)})`,
  );
  const exhausted = await step(() => store.authorize({ capabilityHash }));
  assertAcceptance(
    !exhausted.ok && exhausted.blocker === "CAPABILITY_EXHAUSTED",
    `a single-use capability authorized a second use (${outcome(exhausted)})`,
  );

  const ambiguous = await step(() =>
    deliveryStore.recordOutcome({
      orderId,
      fulfillmentId,
      attemptNumber: attempt.attemptNumber,
      outcome: { kind: "UNKNOWN", provider: SYNTHETIC_PROVIDER },
    }),
  );
  assertAcceptance(
    ambiguous.ok &&
      ambiguous.recorded === false &&
      ambiguous.unresolved === true &&
      ambiguous.status === "DELIVERY_PENDING",
    `an ambiguous send was written down as a resolved outcome (${outcome(ambiguous)})`,
  );
  const failed = await step(() =>
    deliveryStore.recordOutcome({
      orderId,
      fulfillmentId,
      attemptNumber: attempt.attemptNumber,
      outcome: { kind: "REJECTED", provider: SYNTHETIC_PROVIDER, reasonCode: "PROVIDER_ERROR" },
    }),
  );
  assertAcceptance(
    failed.ok && failed.recorded === true && failed.status === "FAILED",
    `a rejected send did not fold to a terminal failure (${outcome(failed)})`,
  );
  const resurrect = await step(() =>
    deliveryStore.persistAttempt({ orderId, fulfillmentId, provider: SYNTHETIC_PROVIDER, owner, token }),
  );
  assertAcceptance(
    !resurrect.ok && resurrect.blocker === "TERMINAL_FAILED",
    `a terminal delivery failure was retried (${outcome(resurrect)})`,
  );
  assertAcceptance(
    (await step(() => deliveryStore.release({ fulfillmentId, owner, token }))) === true,
    "the delivery lease could not be released",
  );
  return { capabilityHash };
}

/**
 * The refund-required branch: a durable claim, a recorded receipt, a provider
 * outage that stays retryable, then verification. Nothing here moves money and
 * nothing rewrites the settled order.
 */
async function proveRefundJourney(
  db: Queryable,
  tx: NeutralDbExecutor,
  step: <T>(work: () => Promise<T>) => Promise<T>,
  runId: string,
  runtime: AcceptanceRuntime,
  ledger: AcceptanceLedger,
  fixture: PromotedFixture,
): Promise<void> {
  const { openNeutralQaReview, decideNeutralQaReview } = runtime.qa;
  const {
    listNeutralRefundWork,
    claimNeutralRefund,
    recordNeutralRefundReceipt,
    verifyNeutralRefundReceipt,
    verifyProviderRefund,
  } = runtime.refund;
  const { orderId, reviewerKey, paymentIntent } = fixture;
  const actor = `admin:${runId}`;
  const otherActor = `admin:${runId}-second`;
  const providerReceiptId = `re_${digest(`${runId}/receipt`).slice(0, 32)}`;

  const opened = await step(() => openNeutralQaReview({ orderId, reviewerKey }, { db: tx }));
  assertAcceptance(opened.ok, `refund-branch QA review could not be opened (${outcome(opened)})`);
  ledger.record("qaReview", opened.reviewId);
  const decided = await step(() =>
    decideNeutralQaReview(
      { orderId, reviewerKey, decision: "unavailable", minutesSpent: 1, reasonCode: "REPORT_INCOMPLETE" },
      { db: tx },
    ),
  );
  assertAcceptance(
    decided.ok &&
      decided.status === "REFUND_REQUIRED" &&
      decided.refundInitiated === false &&
      decided.customerArtifactPending === false,
    `an unavailable report did not queue a refund without initiating one (${outcome(decided)})`,
  );

  const queue = await step(() => listNeutralRefundWork({ db: tx }));
  assertAcceptance(queue.ok, `the refund queue could not be read (${outcome(queue)})`);
  const item = queue.items.find((entry) => entry.orderId === orderId);
  assertAcceptance(
    item && item.status === "REFUND_REQUIRED",
    "the queued refund is absent from the first hundred unconfirmed refund rows",
  );
  const id = item!.id;
  ledger.record("refundWork", id);

  const early = await step(() =>
    recordNeutralRefundReceipt({ id, actor, providerReceiptId }, { db: tx }),
  );
  assertAcceptance(
    !early.ok && early.blocker === "RECEIPT_CONFLICT",
    `a receipt was recorded against an unclaimed refund (${outcome(early)})`,
  );
  const claimed = await step(() => claimNeutralRefund({ id, actor }, { db: tx }));
  assertAcceptance(
    claimed.ok && claimed.status === "REFUND_CLAIMED" && claimed.refundInitiated === false,
    `the refund could not be claimed (${outcome(claimed)})`,
  );
  const reclaimed = await step(() => claimNeutralRefund({ id, actor }, { db: tx }));
  assertAcceptance(
    reclaimed.ok && reclaimed.attemptKey === claimed.attemptKey,
    `re-claiming issued a second provider attempt key (${outcome(reclaimed)})`,
  );
  const stolen = await step(() => claimNeutralRefund({ id, actor: otherActor }, { db: tx }));
  assertAcceptance(
    !stolen.ok && stolen.blocker === "CLAIM_CONFLICT",
    `a second actor took over a live refund claim (${outcome(stolen)})`,
  );
  const malformed = await step(() =>
    recordNeutralRefundReceipt({ id, actor, providerReceiptId: "not-a-receipt" }, { db: tx }),
  );
  assertAcceptance(
    !malformed.ok && malformed.blocker === "INVALID_INPUT",
    `a malformed provider receipt was accepted (${outcome(malformed)})`,
  );
  const recorded = await step(() =>
    recordNeutralRefundReceipt({ id, actor, providerReceiptId }, { db: tx }),
  );
  assertAcceptance(
    recorded.ok && recorded.status === "RECEIPT_RECORDED_PENDING_VERIFICATION",
    `the provider receipt could not be recorded (${outcome(recorded)})`,
  );

  const outage = await step(() =>
    verifyNeutralRefundReceipt(
      {
        id,
        actor,
        retrieve: async () => {
          throw new Error("synthetic provider outage");
        },
      },
      { db: tx },
    ),
  );
  // The retryable branch is one arm of a wide union; read it through its shape
  // rather than narrowing on a `string` blocker that cannot discriminate it.
  const outageShape = outage as {
    ok: boolean;
    blocker?: string;
    retryable?: boolean;
    status?: string;
  };
  assertAcceptance(
    outageShape.ok === false &&
      outageShape.blocker === "PROVIDER_LOOKUP_UNKNOWN" &&
      outageShape.retryable === true &&
      outageShape.status === "RECEIPT_RECORDED_PENDING_VERIFICATION",
    `a provider outage was treated as evidence about the receipt (${outcome(outage)})`,
  );
  const audit = await db.query(
    `select status::text status,provider_lookup_attempts,last_provider_lookup_result from ot_neutral_refund_work where id=$1`,
    [id],
  );
  assertAcceptance(
    audit.rows[0]?.status === "RECEIPT_RECORDED_PENDING_VERIFICATION" &&
      audit.rows[0]?.provider_lookup_attempts === 1 &&
      audit.rows[0]?.last_provider_lookup_result === "RETRYABLE_PROVIDER_FAILURE",
    "a retryable provider outage was not audited as retryable",
  );

  const mismatched = verifyProviderRefund(
    {
      id: providerReceiptId,
      payment_intent: `${paymentIntent}x`,
      amount: 6900,
      currency: "usd",
      status: "succeeded",
    },
    { receiptId: providerReceiptId, paymentIntent },
  );
  assertAcceptance(
    !mismatched.ok && mismatched.reason === "PAYMENT_INTENT_MISMATCH",
    "a refund bound to a different PaymentIntent would have verified",
  );

  const verified = await step(() =>
    verifyNeutralRefundReceipt(
      {
        id,
        actor,
        retrieve: async (receiptId) => ({
          id: receiptId,
          payment_intent: paymentIntent,
          amount: 6900,
          currency: "usd",
          status: "succeeded",
        }),
      },
      { db: tx },
    ),
  );
  assertAcceptance(
    verified.ok && verified.status === "REFUND_CONFIRMED" && verified.refundInitiated === false,
    `a matching provider receipt did not confirm the refund (${outcome(verified)})`,
  );

  const settled = await db.query(
    `select status,"settledAmountCents" "settledAmountCents","amountPaid" "amountPaid" from ot_order where id=$1`,
    [orderId],
  );
  assertAcceptance(
    settled.rows[0]?.status === "PAID" &&
      settled.rows[0]?.settledAmountCents === 6900 &&
      Number(settled.rows[0]?.amountPaid) === 69,
    "the refund branch rewrote the settled commerce ledger",
  );
  const acquired = await db.query(
    `select (select count(*)::int from ot_fulfillment where order_id=$1) fulfillments,(select count(*)::int from ot_packet_download_capability where source_order_id=$1) capabilities`,
    [orderId],
  );
  assertAcceptance(
    acquired.rows[0]?.fulfillments === 0 && acquired.rows[0]?.capabilities === 0,
    "the refund branch acquired a fulfillment or a downloadable capability",
  );
}

/**
 * A settlement reversal ends access. QA converges to HELD, every live
 * capability is revoked, and no further customer artifact can be promoted.
 */
async function proveReversalSemantics(
  db: Queryable,
  tx: NeutralDbExecutor,
  step: <T>(work: () => Promise<T>) => Promise<T>,
  runId: string,
  runtime: AcceptanceRuntime,
  promoted: PromotedArtifact,
  capabilityHash: string,
): Promise<void> {
  await db.query(
    `insert into ot_settlement_reversal(event_id,event_type,payment_intent) values($1,'refund.updated',$2)`,
    [`${runId}-reversal`, promoted.paymentIntent],
  );
  const converged = await db.query(
    `select q."status"::text "qaStatus",q."reason_code" "reasonCode",c."revoked_reason_code" "revokedReason",c."revoked_at" "revokedAt" from ot_neutral_qa_review q join ot_packet_download_capability c on c."fulfillment_id"=q."fulfillment_id" where q."order_id"=$1`,
    [promoted.orderId],
  );
  assertAcceptance(
    converged.rows[0]?.qaStatus === "HELD" &&
      converged.rows[0]?.reasonCode === "PAYMENT_REVERSED" &&
      converged.rows[0]?.revokedReason === "REFUNDED" &&
      converged.rows[0]?.revokedAt !== null,
    "a settlement reversal did not hold the review and revoke the live capability",
  );
  const store = runtime.packet.neutralPacketDownloadStore(
    tx as unknown as import("@/lib/fulfillment-runtime/packet-download-store").PacketDownloadClient,
  );
  const refused = await step(() => store.authorize({ capabilityHash }));
  assertAcceptance(
    !refused.ok && refused.blocker === "CAPABILITY_REVOKED",
    `a revoked capability was not reported as revoked (${outcome(refused)})`,
  );
  const blocked = await step(() =>
    runtime.promotion.promoteApprovedNeutralCustomerZip(promoted.orderId, {
      db: tx,
      ...promoted.storage.adapters,
    }),
  );
  assertAcceptance(
    !blocked.ok && blocked.blocker === "AUTHORITY_NOT_CURRENT",
    `a reversed order could still promote a customer artifact (${outcome(blocked)})`,
  );
}

/**
 * Drive the whole journey on ONE transaction the caller owns, then roll it back.
 *
 * The caller opens nothing and the runner commits nothing: `BEGIN` here,
 * `ROLLBACK` in `finally`, never `COMMIT`. Every production helper receives the
 * caller-owned executor (see [[createNeutralTransactionExecutor]]) so its own
 * transaction becomes a savepoint inside this one.
 *
 * Returns the identities of every row whose primary key a helper generated, so
 * [[proveAcceptanceAbsence]] can prove those exact rows are gone rather than
 * only sweeping a naming pattern.
 */
export async function runTransactionalAcceptance(
  db: Queryable,
  runId: string,
  deps: { runtime?: AcceptanceRuntime } = {},
): Promise<PreviewAcceptanceEvidence> {
  assertPreviewAcceptanceRunId(runId);
  const runtime = deps.runtime ?? (await loadAcceptanceRuntime());
  const ledger = new AcceptanceLedger();
  const restoreFlags = applyAcceptanceFlags();
  let began = false;
  let failure: unknown;
  let result: PreviewAcceptanceEvidence | undefined;
  try {
    await db.query("BEGIN");
    began = true;
    const tx = createNeutralTransactionExecutor(db);
    // Each production call runs inside its own savepoint, so a statement that
    // PostgreSQL refuses is contained and reported instead of poisoning the
    // transaction the remaining proofs and the rollback still depend on.
    const step = <T>(work: () => Promise<T>): Promise<T> => tx.$transaction(work);

    await proveCheckoutBinding(db, tx, step, runId, runtime, ledger);
    const delivered = await proveQaAndPromotion(
      db,
      tx,
      step,
      runtime,
      ledger,
      await seedPromotedFixture(db, runId, "delivery", ledger),
    );
    const { capabilityHash } = await proveDeliveryAndCapability(
      db,
      tx,
      step,
      runId,
      runtime,
      ledger,
      delivered,
    );
    await proveRefundJourney(
      db,
      tx,
      step,
      runId,
      runtime,
      ledger,
      await seedPromotedFixture(db, runId, "refund", ledger),
    );
    await proveReversalSemantics(db, tx, step, runId, runtime, delivered, capabilityHash);
    result = { runId, probes: ledger.probes() };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (began) await db.query("ROLLBACK");
    } catch (rollbackError) {
      failure = failure
        ? new AggregateError([failure, rollbackError], "Acceptance journey and rollback both failed")
        : rollbackError;
    } finally {
      restoreFlags();
    }
  }
  if (failure) {
    if (failure && typeof failure === "object")
      Object.defineProperty(failure, "acceptanceEvidence", { value: { runId, probes: ledger.probes() } });
    throw failure;
  }
  return result!;
}
