/** @jest-environment node */
import {
  ACCEPTANCE_SCOPES,
  assertPreviewMembershipGraph,
  applyAcceptanceFlags,
  assertPreviewAcceptanceRunId,
  createPreviewAcceptanceRunId,
  proveAcceptanceAbsence,
  readPreviewAcceptanceConfig,
  redactAcceptanceError,
  runTransactionalAcceptance,
  type AcceptanceRuntime,
} from "@/lib/fulfillment/neutral-preview-acceptance";
import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy";
import { computePropertyBindingFingerprint } from "@/lib/fulfillment/artifact-digest";
import {
  createNeutralCustomerZip,
  neutralCustomerZipLocator,
} from "@/lib/fulfillment/neutral-customer-zip";
import { verifyProviderRefund } from "@/lib/fulfillment/neutral-refund-verification";

const ref = "iyaxdrehtxsfkaexgxls",
  marker = "ffb5b95f-878c-4efc-93f9-d5e49dab7763";
const urls = {
  DIRECT_URL: `postgresql://postgres:p%40ss@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
  DATABASE_URL: `postgresql://ot_preview_app.${ref}:app-pass@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  OT_NEUTRAL_DATABASE_URL: `postgresql://ot_preview_neutral_runtime.${ref}:runtime-pass@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  OT_NEUTRAL_DELIVERY_DATABASE_URL: `postgresql://ot_preview_neutral_delivery.${ref}:delivery-pass@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
};
const env = {
  ...urls,
  OT_NEUTRAL_PREVIEW_PROJECT_REF: ref,
  OT_NEUTRAL_PREVIEW_MARKER_INSTANCE_ID: marker,
};

describe("Preview acceptance safety contract", () => {
  const memberships = [
    ["ot_neutral_app_reader","ot_preview_app"],
    ["ot_neutral_runtime","ot_preview_neutral_runtime"],
    ["ot_neutral_delivery_runtime","ot_preview_neutral_delivery"],
  ].map(([role,member]) => ({role,member,grantor:"postgres",admin_option:false,inherit_option:true,set_option:true}));
  test("accepts only the three exact functional membership edges", () => {
    expect(() => assertPreviewMembershipGraph(memberships)).not.toThrow();
  });
  test.each([
    {role:"supabase_admin",member:"ot_preview_app",grantor:"postgres",admin_option:false,inherit_option:true,set_option:true},
    {role:"postgres",member:"ot_preview_neutral_runtime",grantor:"postgres",admin_option:false,inherit_option:true,set_option:true},
    {role:"ot_neutral_runtime",member:"ot_preview_neutral_runtime",grantor:"wrong",admin_option:false,inherit_option:true,set_option:true},
  ])("rejects unexpected or privileged membership %#", edge => {
    expect(() => assertPreviewMembershipGraph([...memberships,edge])).toThrow(/membership graph/);
  });
  test("uses strict UUID v4 run IDs", () => {
    const id = createPreviewAcceptanceRunId();
    expect(assertPreviewAcceptanceRunId(id)).toBe(id);
    for (const bad of [
      "native",
      "ot-accept-00000000-0000-1000-8000-000000000000",
      "ot-accept-00000000-0000-4000-0000-000000000000",
    ])
      expect(() => assertPreviewAcceptanceRunId(bad)).toThrow(/UUID v4/);
  });
  test("pins project, database, port, and ordered roles", () => {
    expect(readPreviewAcceptanceConfig(env).markerInstanceId).toBe(marker);
    expect(() =>
      readPreviewAcceptanceConfig({
        ...env,
        DATABASE_URL: env.DATABASE_URL.replace("ot_preview_app", "wrong"),
      }),
    ).toThrow(/approved Preview identity/);
    expect(() =>
      readPreviewAcceptanceConfig({
        ...env,
        DIRECT_URL: env.DIRECT_URL.replace("/postgres", "/wrong"),
      }),
    ).toThrow(/approved Preview identity/);
  });
  test.each([
    "host=evil",
    "hostaddr=1.2.3.4",
    "port=9999",
    "dbname=evil",
    "database=evil",
    "user=evil",
    "username=evil",
  ])("rejects libpq routing override %s", (query) =>
    expect(() =>
      readPreviewAcceptanceConfig({
        ...env,
        DIRECT_URL: `${env.DIRECT_URL}&${query}`,
      }),
    ).toThrow(/routing overrides/),
  );
  test.each([
    "sslmode=verify-full&sslmode=disable",
    "sslmode=disable&sslmode=verify-full",
    "sslmode=verify-full&SSLMODE=verify-full",
    "%73slmode=verify-full&sslmode=verify-full",
    "foo=1&FOO=2",
  ])("rejects duplicate URL options before parser resolution: %s", (query) =>
    expect(() => readPreviewAcceptanceConfig({
      ...env,
      DIRECT_URL: `${env.DIRECT_URL.split("?")[0]}?${query}`,
    })).toThrow(/Duplicate database URL option/),
  );
  test.each([
    "sslmode=disable",
    "ssl=false",
    "target_session_attrs=read-write",
  ])("rejects TLS downgrade or unknown option %s", (query) =>
    expect(() =>
      readPreviewAcceptanceConfig({
        ...env,
        DIRECT_URL: `${env.DIRECT_URL.split("?")[0]}?${query}`,
      }),
    ).toThrow(/TLS|Unknown/),
  );
  test.each(["require", "verify-ca", "disable"])("rejects non-verify-full TLS mode %s", (mode) =>
    expect(() => readPreviewAcceptanceConfig({ ...env, DIRECT_URL: env.DIRECT_URL.replace("verify-full", mode) })).toThrow(/TLS/),
  );
  test.each([
    "aws-0-us-west-1.pooler.supabase.com",
    "evil.pooler.supabase.com",
    "aws-2-us-east-2.pooler.supabase.com",
  ])("rejects unapproved pooler host %s", (host) =>
    expect(() => readPreviewAcceptanceConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace("aws-0-us-east-2.pooler.supabase.com", host) })).toThrow(/approved Preview identity/),
  );
  test("redacts raw, encoded, and decoded credential fragments", () => {
    const output = redactAcceptanceError(
      new Error(`p@ss p%40ss postgres ${env.DIRECT_URL}`),
      Object.values(urls),
    );
    expect(output).not.toMatch(/p@ss|p%40ss|postgresql:\/\//);
  });
  test("redaction never throws on malformed percent encoding", () => {
    expect(() => redactAcceptanceError(new Error("safe"), ["bad%ZZsecret"])).not.toThrow();
    expect(redactAcceptanceError(new Error("bad%ZZsecret"), ["bad%ZZsecret"])).toBe("[REDACTED]");
  });
  test("recursively renders aggregate errors and causes without leaking credentials", () => {
    const caused = new Error(`rollback failed for ${env.DIRECT_URL}`, {
      cause: new Error("socket closed for p@ss"),
    });
    const output = redactAcceptanceError(
      new AggregateError([new Error("journey assertion failed"), caused], "acceptance failed"),
      Object.values(urls),
    );
    expect(output).toContain("acceptance failed");
    expect(output).toContain("nested: journey assertion failed");
    expect(output).toContain("nested: rollback failed for [REDACTED_DATABASE_URL]");
    expect(output).toContain("cause: socket closed for [REDACTED]");
    expect(output).not.toMatch(/p@ss|p%40ss|postgresql:\/\//);
  });
  test("does not recurse forever through cyclic error causes", () => {
    const error = new Error("cyclic failure");
    Object.defineProperty(error, "cause", { value: error });
    expect(redactAcceptanceError(error, [])).toBe("cyclic failure");
  });
});

/**
 * The journey drives production helpers, so the fake runtime stands in for the
 * runtime modules and a scripted `query` stands in for PostgreSQL. What is
 * being asserted here is the runner's own contract — one caller-owned
 * transaction, helpers driven through it, flags restored, and evidence that
 * names the rows a helper keyed itself.
 */
type Journey = {
  runtime: AcceptanceRuntime;
  calls: string[];
  query: jest.Mock;
  executors: unknown[];
  state: {
    bundleSha256: Map<string, string>;
    zipSha256: string;
    fulfillmentId: string;
    authorizeCalls: number;
  };
};

function journey(runId: string, failAt?: string): Journey {
  const calls: string[] = [];
  const executors: unknown[] = [];
  const state = {
    bundleSha256: new Map<string, string>(),
    zipSha256: "",
    fulfillmentId: "",
    authorizeCalls: 0,
  };
  const reservationId = (orderId: string) => `${orderId}-reservation-row`;
  const seen = new Map<string, number>();
  const nth = (key: string) => {
    const next = (seen.get(key) ?? 0) + 1;
    seen.set(key, next);
    return next;
  };
  const note = (executor: unknown) => {
    executors.push(executor);
    return executor;
  };

  const query = jest.fn(async (sql: string, values?: unknown[]) => {
    calls.push(sql);
    if (failAt && sql.includes(failAt)) throw new Error("partial setup");
    if (sql.startsWith("insert into ot_neutral_report_reservation")) {
      state.bundleSha256.set(String(values?.[1]), String(values?.[12]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("select id from ot_neutral_report_reservation"))
      return { rows: [{ id: reservationId(String(values?.[0])) }], rowCount: 1 };
    if (sql.startsWith("select status::text status,reconciliation_code"))
      return {
        rows: [
          String(values?.[0]).endsWith("-abandon-order")
            ? { status: "ABANDONED", reconciliation_code: "CHECKOUT_NEVER_CREATED" }
            : {
                status: "RECONCILIATION_REQUIRED",
                reconciliation_code: "STRIPE_CHECKOUT_OUTCOME_UNKNOWN",
              },
        ],
        rowCount: 1,
      };
    if (sql.includes('q."id" "qaReviewId"')) {
      state.fulfillmentId = `${values?.[0]}-fulfillment`;
      return {
        rows: [
          {
            qaReviewId: `${values?.[0]}-review`,
            fulfillmentId: state.fulfillmentId,
            customerSha256: state.zipSha256,
            artifactId: `${values?.[0]}-artifact`,
            artifactSha256: state.zipSha256,
            storageLocator: neutralCustomerZipLocator(state.zipSha256),
            byteSize: 512,
            version: 1,
            templateVersion: NEUTRAL_REPORT_COMMERCE_POLICY.version,
            fingerprint: computePropertyBindingFingerprint({
              orderId: String(values?.[0]),
              propertyPin: "10000000000000",
              propertyAddress: "100 Synthetic Acceptance Ave",
            }),
            fulfillmentStatus: "ARTIFACT_READY",
            attemptCount: 0,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("provider_lookup_attempts,last_provider_lookup_result"))
      return {
        rows: [
          {
            status: "RECEIPT_RECORDED_PENDING_VERIFICATION",
            provider_lookup_attempts: 1,
            last_provider_lookup_result: "RETRYABLE_PROVIDER_FAILURE",
          },
        ],
        rowCount: 1,
      };
    if (sql.includes('"settledAmountCents" "settledAmountCents"'))
      return {
        rows: [{ status: "PAID", settledAmountCents: 6900, amountPaid: 69 }],
        rowCount: 1,
      };
    if (sql.includes("fulfillments,(select count(*)::int"))
      return { rows: [{ fulfillments: 0, capabilities: 0 }], rowCount: 1 };
    if (sql.includes('q."status"::text "qaStatus"'))
      return {
        rows: [
          {
            qaStatus: "HELD",
            reasonCode: "PAYMENT_REVERSED",
            revokedReason: "REFUNDED",
            revokedAt: new Date(),
          },
        ],
        rowCount: 1,
      };
    return { rows: [], rowCount: 1 };
  });

  const grant = () => ({
    capabilityId: `${runId}-capability`,
    artifactId: `${runId}-artifact`,
    artifactVersion: 1,
    artifactSha256: state.zipSha256,
    storageLocator: neutralCustomerZipLocator(state.zipSha256),
    byteSize: 512,
    fulfillmentId: state.fulfillmentId,
    orderId: `${runId}-delivery-order`,
    expectedUseCount: 0,
    nextUseCount: 1,
  });

  const packetStore = {
    async authorize() {
      state.authorizeCalls += 1;
      if (state.authorizeCalls === 1) return { ok: true, grant: grant() };
      return {
        ok: false,
        blocker: state.authorizeCalls === 2 ? "CAPABILITY_EXHAUSTED" : "CAPABILITY_REVOKED",
      };
    },
    async reassert() {
      return { ok: true, grant: grant() };
    },
    async issue() {
      return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };
    },
    async revoke() {
      return { ok: true, revoked: 0 };
    },
  };

  const deliveryStore = {
    async claim() {
      return true;
    },
    async release() {
      return true;
    },
    async assertSendable() {
      return { ok: true };
    },
    async persistAttempt() {
      const attempt = nth("persistAttempt");
      if (attempt === 2) return { ok: false, blocker: "UNRESOLVED_SEND" };
      if (attempt === 3) return { ok: false, blocker: "TERMINAL_FAILED" };
      return {
        ok: true,
        attemptId: `${runId}-attempt`,
        attemptNumber: 1,
        artifactVersion: 1,
        artifactSha256: state.zipSha256,
        sourceOrderId: `${runId}-delivery-order`,
        propertyBindingFingerprint: "f".repeat(64),
        idempotencyKey: `${runId}-idempotency`,
        provider: "synthetic-local",
        statusRevision: 1,
      };
    },
    async recordOutcome(input: { outcome: { kind: string } }) {
      return input.outcome.kind === "UNKNOWN"
        ? { ok: true, recorded: false, unresolved: true, status: "DELIVERY_PENDING" }
        : { ok: true, recorded: true, unresolved: false, status: "FAILED" };
    },
  };

  const runtime = {
    repository: {
      async reserveNeutralCheckoutOrder(
        input: { orderId: string; propertyPin: string },
        options: { db?: unknown },
      ) {
        note(options.db);
        if (input.propertyPin !== "10000000000000")
          return { ok: false, blocker: "NEUTRAL_RESERVATION_CONFLICT" };
        return nth(`reserve:${input.orderId}`) === 3
          ? { ok: false, blocker: "NEUTRAL_RESERVATION_CONFLICT" }
          : { ok: true };
      },
      async markNeutralCheckoutOutcomeUnknown(orderId: string, options: { db?: unknown }) {
        note(options.db);
        return nth(`unknown:${orderId}`) === 1;
      },
      async abandonNeutralCheckoutReservation(orderId: string, options: { db?: unknown }) {
        note(options.db);
        return nth(`abandon:${orderId}`) === 1;
      },
    },
    qa: {
      async openNeutralQaReview(
        input: { orderId: string },
        options: { db?: unknown },
      ) {
        note(options.db);
        return { ok: true, reviewId: `${input.orderId}-review`, targetMinutes: 12, hardStopMinutes: 20 };
      },
      async decideNeutralQaReview(
        input: { orderId: string; decision: string },
        options: { db?: unknown },
      ) {
        note(options.db);
        if (input.decision === "unavailable")
          return {
            ok: true,
            status: "REFUND_REQUIRED",
            refundInitiated: false,
            customerArtifactPending: false,
          };
        return nth(`decide:${input.orderId}`) === 1
          ? {
              ok: true,
              status: "APPROVED",
              refundInitiated: false,
              customerArtifactPending: true,
            }
          : { ok: false, blocker: "QA_ALREADY_DECIDED" };
      },
    },
    promotion: {
      async promoteApprovedNeutralCustomerZip(
        orderId: string,
        options: {
          db?: unknown;
          readBundle: (locator: string, sha: string) => Promise<{ pdf: Buffer; csv: Buffer }>;
          writeCustomerZip: (bytes: Buffer) => Promise<{ sha256: string }>;
        },
      ) {
        note(options.db);
        const attempt = nth(`promote:${orderId}`);
        if (state.authorizeCalls >= 3)
          return { ok: false, blocker: "AUTHORITY_NOT_CURRENT" };
        if (attempt > 1) return { ok: true, sha256: state.zipSha256, created: false };
        const bundleSha256 = state.bundleSha256.get(orderId)!;
        const bundle = await options.readBundle(
          `ot-neutral-reports/sha256/${bundleSha256}.json`,
          bundleSha256,
        );
        const stored = await options.writeCustomerZip(
          createNeutralCustomerZip({ pdf: bundle.pdf, csv: bundle.csv }),
        );
        state.zipSha256 = stored.sha256;
        return { ok: true, sha256: stored.sha256, created: true };
      },
    },
    refund: {
      verifyProviderRefund,
      async listNeutralRefundWork(options: { db?: unknown }) {
        note(options.db);
        return {
          ok: true,
          items: [
            {
              id: `${runId}-refund-work`,
              orderId: `${runId}-refund-order`,
              status: "REFUND_REQUIRED",
              reasonCode: "REPORT_INCOMPLETE",
              claimedAt: null,
              confirmedAt: null,
            },
          ],
        };
      },
      async claimNeutralRefund(input: { actor: string }, options: { db?: unknown }) {
        note(options.db);
        if (input.actor.endsWith("-second")) return { ok: false, blocker: "CLAIM_CONFLICT" };
        return {
          ok: true,
          status: "REFUND_CLAIMED",
          refundInitiated: false,
          attemptKey: `${runId}-attempt-key`,
        };
      },
      async recordNeutralRefundReceipt(
        input: { providerReceiptId: string },
        options: { db?: unknown },
      ) {
        note(options.db);
        if (!/^re_[A-Za-z0-9]{8,64}$/.test(input.providerReceiptId))
          return { ok: false, blocker: "INVALID_INPUT" };
        return nth("receipt") === 1
          ? { ok: false, blocker: "RECEIPT_CONFLICT" }
          : {
              ok: true,
              status: "RECEIPT_RECORDED_PENDING_VERIFICATION",
              refundInitiated: false,
              receiptSha256: "a".repeat(64),
            };
      },
      async verifyNeutralRefundReceipt(
        input: { retrieve: (id: string) => Promise<unknown> },
        options: { db?: unknown },
      ) {
        note(options.db);
        try {
          await input.retrieve(`re_${"b".repeat(32)}`);
        } catch {
          return {
            ok: false,
            blocker: "PROVIDER_LOOKUP_UNKNOWN",
            status: "RECEIPT_RECORDED_PENDING_VERIFICATION",
            retryable: true,
            refundInitiated: false,
          };
        }
        return { ok: true, status: "REFUND_CONFIRMED", refundInitiated: false };
      },
    },
    packet: {
      neutralPacketDownloadStore: (executor: unknown) => {
        note(executor);
        return packetStore;
      },
    },
    delivery: {
      createPrismaT2DeliveryStore: (executor: unknown) => {
        note(executor);
        return deliveryStore;
      },
    },
    deliveryDb: {
      async isNeutralDeliveryFulfillment(id: string, executor: unknown) {
        note(executor);
        return id === state.fulfillmentId;
      },
    },
    issuance: {
      async issueT2PacketCapability(
        input: { maxUses?: number },
        deps: { randomValue: () => string },
      ) {
        if (input.maxUses !== 1) return { ok: false, blocker: "INVALID_CAPABILITY" };
        return nth("issue") === 1
          ? {
              ok: true,
              issuance: {
                value: deps.randomValue(),
                capabilityId: `${runId}-capability`,
                artifactSha256: state.zipSha256,
                expiresAt: new Date().toISOString(),
                maxUses: 1,
              },
            }
          : { ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" };
      },
    },
  } as unknown as AcceptanceRuntime;

  return { runtime, calls, query, executors, state };
}

describe("Preview acceptance transactional journey", () => {
  test("drives production helpers on one caller-owned transaction and rolls it back", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, calls, query, executors } = journey(runId);
    await runTransactionalAcceptance({ query } as never, runId, { runtime });

    expect(calls[0]).toBe("BEGIN");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    // Every helper received the SAME caller-owned executor, and none of them was
    // handed the raw connection, which is what would let a helper commit.
    expect(executors.length).toBeGreaterThan(20);
    expect(new Set(executors).size).toBe(1);
    expect(executors[0]).not.toBe(query);
    // Every savepoint the journey opened was released or rolled back.
    const opened = calls.filter((sql) => sql.startsWith("SAVEPOINT")).length;
    const closed = calls.filter((sql) => sql.startsWith("RELEASE SAVEPOINT")).length;
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
  });

  test("returns evidence naming the rows production helpers keyed themselves", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, query } = journey(runId);
    const evidence = await runTransactionalAcceptance({ query } as never, runId, {
      runtime,
    });
    expect(evidence.runId).toBe(runId);
    const probed = new Map(
      evidence.probes.map((probe) => [`${probe.table}.${probe.column}`, probe.values]),
    );
    expect(probed.get("ot_fulfillment.id")).toEqual([`${runId}-delivery-order-fulfillment`]);
    expect(probed.get("ot_packet_download_capability.id")).toEqual([`${runId}-capability`]);
    expect(probed.get("ot_neutral_refund_work.id")).toEqual([`${runId}-refund-work`]);
    expect(probed.get("ot_delivery_attempt.fulfillment_id")).toEqual([
      `${runId}-delivery-order-fulfillment`,
    ]);
    expect(probed.get("ot_neutral_report_reservation.id")).toEqual(
      expect.arrayContaining([
        `${runId}-checkout-order-reservation-row`,
        `${runId}-delivery-reservation`,
      ]),
    );
  });

  test("restores every flag it set and never leaves an outward-facing one enabled", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, query } = journey(runId);
    process.env.OT_NEUTRAL_QA_ENABLED = "previous";
    process.env.OT_T2_DELIVERY_ADAPTER_ENABLED = "true";
    try {
      await runTransactionalAcceptance({ query } as never, runId, { runtime });
      expect(process.env.OT_NEUTRAL_QA_ENABLED).toBe("previous");
      expect(process.env.OT_T2_DELIVERY_ADAPTER_ENABLED).toBe("true");
      expect(process.env.OT_T2_PACKET_DOWNLOAD_ENABLED).toBeUndefined();
    } finally {
      delete process.env.OT_NEUTRAL_QA_ENABLED;
      delete process.env.OT_T2_DELIVERY_ADAPTER_ENABLED;
    }
  });

  test("withdraws the outward-facing adapters for the duration of the run", () => {
    const env: Record<string, string | undefined> = {
      OT_T2_DELIVERY_ADAPTER_ENABLED: "true",
      OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED: "true",
      OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED: "true",
      OT_T2_DELIVERY_CALLBACK_ENABLED: "true",
    };
    const restore = applyAcceptanceFlags(env);
    expect(env.OT_T2_DELIVERY_ADAPTER_ENABLED).toBeUndefined();
    expect(env.OT_NEUTRAL_CUSTOMER_ZIP_STORAGE_ENABLED).toBeUndefined();
    expect(env.OT_NEUTRAL_REPORT_PRIVATE_STORAGE_ENABLED).toBeUndefined();
    expect(env.OT_T2_DELIVERY_CALLBACK_ENABLED).toBeUndefined();
    expect(env.OT_NEUTRAL_QA_ENABLED).toBe("true");
    restore();
    expect(env.OT_T2_DELIVERY_ADAPTER_ENABLED).toBe("true");
    expect(env.OT_NEUTRAL_QA_ENABLED).toBeUndefined();
  });

  test("always rolls back after a partial setup failure", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, calls, query } = journey(runId, "insert into ot_payment_binding");
    await expect(
      runTransactionalAcceptance({ query } as never, runId, { runtime }),
    ).rejects.toThrow("partial setup");
    expect(calls[0]).toBe("BEGIN");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });
  test("restores flags and does not roll back when BEGIN itself fails", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime } = journey(runId);
    const calls: string[] = [];
    const query = jest.fn(async (sql: string) => { calls.push(sql); throw new Error("begin refused"); });
    process.env.OT_NEUTRAL_QA_ENABLED = "prior";
    await expect(runTransactionalAcceptance({ query } as never, runId, { runtime })).rejects.toThrow("begin refused");
    expect(calls).toEqual(["BEGIN"]);
    expect(process.env.OT_NEUTRAL_QA_ENABLED).toBe("prior");
    delete process.env.OT_NEUTRAL_QA_ENABLED;
  });

  test("reports both journey and rollback failures and preserves cleanup evidence", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, query: base } = journey(runId, "insert into ot_payment_binding");
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql === "ROLLBACK") throw new Error("rollback refused");
      return base(sql, values);
    });
    const error = await runTransactionalAcceptance({ query } as never, runId, { runtime }).catch(e => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.acceptanceEvidence?.runId).toBe(runId);
  });

  test("fails loudly when a production helper refuses a step the journey requires", async () => {
    const runId = createPreviewAcceptanceRunId();
    const { runtime, calls, query } = journey(runId);
    runtime.qa.openNeutralQaReview = (async () => ({
      ok: false,
      blocker: "ARTIFACT_NOT_PROMOTED",
    })) as never;
    await expect(
      runTransactionalAcceptance({ query } as never, runId, { runtime }),
    ).rejects.toThrow(/ARTIFACT_NOT_PROMOTED/);
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});

describe("Preview acceptance absence proof", () => {
  const runId = createPreviewAcceptanceRunId();
  const empty = { rows: [{ count: 0 }], rowCount: 1 };

  test("sweeps run-scoped keys and probes helper-generated identities", async () => {
    const query = jest.fn(async (_sql: string, _values?: unknown[]) => empty);
    await proveAcceptanceAbsence({ query } as never, runId, {
      runId,
      probes: [
        { table: "ot_fulfillment", column: "id", values: ["a"] },
        { table: "ot_packet_download_capability", column: "id", values: ["b"] },
      ],
    });
    const statements = query.mock.calls.map((call) => String(call[0]));
    expect(statements.filter((sql) => sql.includes("like $1")).length).toBe(
      ACCEPTANCE_SCOPES.length,
    );
    expect(statements).toContain(
      "select count(*)::int count from ot_fulfillment where id = any($1::text[])",
    );
  });

  test("fails when a swept row survived the rollback", async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes("ot_neutral_qa_review") ? { rows: [{ count: 1 }], rowCount: 1 } : empty,
    );
    await expect(
      proveAcceptanceAbsence({ query } as never, runId),
    ).rejects.toThrow(/ot_neutral_qa_review/);
  });

  test("fails when a helper-generated row survived the rollback", async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes("any($1::text[])") ? { rows: [{ count: 1 }], rowCount: 1 } : empty,
    );
    await expect(
      proveAcceptanceAbsence({ query } as never, runId, {
        runId,
        probes: [{ table: "ot_delivery_event", column: "fulfillment_id", values: ["x"] }],
      }),
    ).rejects.toThrow(/ot_delivery_event\.fulfillment_id/);
  });

  test("refuses evidence from another run or naming an unwritten relation", async () => {
    const query = jest.fn(async (_sql: string, _values?: unknown[]) => empty);
    await expect(
      proveAcceptanceAbsence({ query } as never, runId, {
        runId: createPreviewAcceptanceRunId(),
        probes: [],
      }),
    ).rejects.toThrow(/different acceptance run/);
    await expect(
      proveAcceptanceAbsence({ query } as never, runId, {
        runId,
        probes: [{ table: "ot_order", column: "email", values: ["x"] }],
      }),
    ).rejects.toThrow(/never writes/);
  });
});
