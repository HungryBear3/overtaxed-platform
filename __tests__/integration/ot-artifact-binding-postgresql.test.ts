/** @jest-environment node */

/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — durable proof on real PostgreSQL.
 *
 * These prove the invariants that only a real row-locking engine can prove:
 * uniqueness, concurrent convergence, and immutability of bound evidence.
 * SQLite is deliberately not used — it cannot demonstrate `FOR UPDATE`
 * behaviour or the unique-index races this slice depends on.
 *
 * Requires TEST_DATABASE_URL pointing at a DISPOSABLE local database. It must
 * never be aimed at Production or a shared Preview database.
 */
const readBackMock = jest.fn();

jest.mock("@/lib/fulfillment-runtime/t2-artifact-storage", () => ({
  readT2ArtifactBytes: (...args: unknown[]) => readBackMock(...args),
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { createPrismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store";
import { deriveAdminEvidenceView } from "@/lib/fulfillment/admin-read-model";
import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest";
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = testDatabaseUrl ? describe : describe.skip;

const PIN = "09000000000000";
const ADDRESS = "123 Main St";
const GENERATED_AT = "2026-08-09T12:00:00.000Z";
const BYTES = Buffer.from("%PDF-1.7 slice-2 exact bytes\n");
const OTHER_BYTES = Buffer.from("%PDF-1.7 DIFFERENT bytes\n");

describeIfDb("OT T2 artifact provenance binding — PostgreSQL proof", () => {
  jest.setTimeout(60_000);

  let pool: Pool;
  let prisma: PrismaClient;
  let store: ReturnType<typeof createPrismaArtifactBindingStore>;
  let prefix: string;
  let priorBindingFlag: string | undefined;

  beforeAll(() => {
    priorBindingFlag = process.env.OT_T2_ARTIFACT_BINDING_ENABLED;
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true";
    pool = new Pool({ connectionString: testDatabaseUrl, max: 10, ssl: false });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const client = prisma as unknown as Parameters<
      typeof createPrismaArtifactBindingStore
    >[0];
    store = createPrismaArtifactBindingStore(client);
  });

  beforeEach(() => {
    prefix = `ot_bind_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    readBackMock.mockReset();
    readBackMock.mockImplementation(async ({ locator }: { locator: string }) => {
      if (locator.includes(computeArtifactSha256(BYTES))) return BYTES;
      if (locator.includes(computeArtifactSha256(OTHER_BYTES))) return OTHER_BYTES;
      throw new Error("unrecognized disposable content address");
    });
  });

  afterEach(async () => {
    await prisma.oTOrder.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
    if (priorBindingFlag === undefined) delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED;
    else process.env.OT_T2_ARTIFACT_BINDING_ENABLED = priorBindingFlag;
  });

  async function seed(
    overrides: {
      status?: string;
      tier?: string;
      pin?: string | null;
      address?: string | null;
      fulfillmentStatus?: OTFulfillmentStatus;
      withFulfillment?: boolean;
      analysisAcknowledgedAt?: Date | null;
      acknowledgmentVersion?: string | null;
      acknowledgmentEvidence?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
      checkoutKey?: string | null;
      contractKey?: string | null;
      stripeSessionId?: string | null;
      checkoutPriceId?: string | null;
      checkoutProductId?: string | null;
      checkoutAmountCents?: number | null;
      checkoutCurrency?: string | null;
      settledAmountCents?: number | null;
      settledCurrency?: string | null;
      amountPaid?: number;
      attempt?: number;
      recoveryReason?: string | null;
    } = {},
  ) {
    const order = await prisma.oTOrder.create({
      data: {
        id: `${prefix}_order`,
        checkoutKey: overrides.checkoutKey === undefined ? `${prefix}:checkout` : overrides.checkoutKey,
        contractKey: overrides.contractKey === undefined ? `${prefix}:contract` : overrides.contractKey,
        tier: overrides.tier ?? "T2",
        email: `${prefix}@example.com`,
        propertyAddress:
          overrides.address === undefined ? ADDRESS : overrides.address,
        propertyPin: overrides.pin === undefined ? PIN : overrides.pin,
        township: "Northfield",
        windowStatus: "OPEN",
        analysisAcknowledgedAt: overrides.analysisAcknowledgedAt === undefined ? new Date("2026-08-09T11:00:00.000Z") : overrides.analysisAcknowledgedAt,
        acknowledgmentVersion: overrides.acknowledgmentVersion === undefined ? "analysis_ack_v1" : overrides.acknowledgmentVersion,
        acknowledgmentEvidence: overrides.acknowledgmentEvidence === undefined ? { acknowledged: true, version: "analysis_ack_v1" } : overrides.acknowledgmentEvidence,
        checkoutPriceId: overrides.checkoutPriceId === undefined ? `${prefix}_price` : overrides.checkoutPriceId,
        checkoutProductId: overrides.checkoutProductId === undefined ? `${prefix}_product` : overrides.checkoutProductId,
        checkoutAmountCents: overrides.checkoutAmountCents === undefined ? 6900 : overrides.checkoutAmountCents,
        checkoutCurrency: overrides.checkoutCurrency === undefined ? "usd" : overrides.checkoutCurrency,
        settledAmountCents: overrides.settledAmountCents === undefined ? 6900 : overrides.settledAmountCents,
        settledCurrency: overrides.settledCurrency === undefined ? "usd" : overrides.settledCurrency,
        amountPaid: overrides.amountPaid === undefined ? 69 : overrides.amountPaid,
        stripeSessionId: overrides.stripeSessionId === undefined ? `${prefix}_session` : overrides.stripeSessionId,
        recoveryReason: overrides.recoveryReason === undefined ? null : overrides.recoveryReason,
        status: overrides.status ?? "PAID",
        attempt: overrides.attempt ?? 0,
      },
    });

    const fulfillment =
      overrides.withFulfillment === false
        ? null
        : await prisma.oTFulfillment.create({
            data: {
              orderId: order.id,
              kind: "T2_APPEAL_EVIDENCE",
              status: overrides.fulfillmentStatus ?? "ARTIFACT_PENDING",
            },
          });

    return { order, fulfillment };
  }

  function command(
    order: { id: string },
    fulfillment: { id: string },
    overrides: Record<string, unknown> = {},
  ) {
    return {
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      bytes: BYTES,
      provenance: {
        sourceOrderId: order.id,
        propertyPin: PIN,
        propertyAddress: ADDRESS,
        generatorVersion: "gen_v1",
        templateVersion: "tpl_v1",
        generatedAt: GENERATED_AT,
      },
      ...overrides,
    } as Parameters<typeof store.bind>[0];
  }

  it("binds an eligible paid-T2 fulfillment and advances the summary", async () => {
    const { order, fulfillment } = await seed();
    const result = await store.bind(command(order, fulfillment!));

    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) throw new Error("expected success");
    expect(result.artifactSha256).toBe(computeArtifactSha256(BYTES));

    const rows = await prisma.oTFulfillmentArtifact.findMany({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      byteSize: BYTES.byteLength,
      sourceOrderId: order.id,
      generatorVersion: "gen_v1",
    });
    expect(rows[0]!.generatedAt?.toISOString()).toBe(GENERATED_AT);
    expect(rows[0]!.propertyBindingFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary).toMatchObject({
      status: "ARTIFACT_READY",
      statusRevision: 1,
    });
  });

  it("is idempotent on an exact retry and creates no duplicate", async () => {
    const { order, fulfillment } = await seed();
    const first = await store.bind(command(order, fulfillment!));
    const second = await store.bind(command(order, fulfillment!));

    expect(first).toMatchObject({ ok: true, created: true });
    // Second pass converges on the same row rather than creating a new one.
    expect(second).toMatchObject({ ok: true, created: false });
    if (first.ok && second.ok) expect(second.artifactId).toBe(first.artifactId);

    const count = await prisma.oTFulfillmentArtifact.count({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(count).toBe(1);

    // The summary must not be advanced twice by a replay.
    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary?.statusRevision).toBe(1);
  });

  it("creates at most one binding under concurrent identical attempts", async () => {
    const { order, fulfillment } = await seed();

    const results = await Promise.all([
      store.bind(command(order, fulfillment!)),
      store.bind(command(order, fulfillment!)),
      store.bind(command(order, fulfillment!)),
      store.bind(command(order, fulfillment!)),
    ]);

    const succeeded = results.filter((r) => r.ok);
    expect(succeeded).toHaveLength(4);
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);

    const count = await prisma.oTFulfillmentArtifact.count({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(count).toBe(1);

    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary?.statusRevision).toBe(1);
  });

  it("fails closed when different bytes are offered for an existing binding", async () => {
    const { order, fulfillment } = await seed();
    await store.bind(command(order, fulfillment!));

    const conflict = await store.bind(
      command(order, fulfillment!, { bytes: OTHER_BYTES }),
    );
    expect(conflict).toEqual({
      ok: false,
      blocker: "ARTIFACT_BINDING_CONFLICT",
    });

    // Prior evidence is intact and unmodified.
    const rows = await prisma.oTFulfillmentArtifact.findMany({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.artifactSha256).toBe(computeArtifactSha256(BYTES));
  });

  it("fails closed when provenance changes for an existing binding", async () => {
    const { order, fulfillment } = await seed();
    await store.bind(command(order, fulfillment!));

    const conflict = await store.bind(
      command(order, fulfillment!, {
        provenance: {
          sourceOrderId: order.id,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v2",
          templateVersion: "tpl_v1",
          generatedAt: GENERATED_AT,
        },
      }),
    );
    expect(conflict).toEqual({
      ok: false,
      blocker: "ARTIFACT_BINDING_CONFLICT",
    });

    const rows = await prisma.oTFulfillmentArtifact.findMany({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.generatorVersion).toBe("gen_v1");
  });

  it("writes nothing when the feature flag is absent/default-off", async () => {
    const { order, fulfillment } = await seed();
    delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED;
    const result = await store.bind(command(order, fulfillment!));
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true";

    expect(result).toEqual({ ok: false, blocker: "FLAG_DISABLED" });
    const count = await prisma.oTFulfillmentArtifact.count({
      where: { fulfillmentId: fulfillment!.id },
    });
    expect(count).toBe(0);

    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary).toMatchObject({
      status: "ARTIFACT_PENDING",
      statusRevision: 0,
    });
  });

  it("refuses a stored-byte mismatch before opening a binding transaction", async () => {
    const { order, fulfillment } = await seed();
    readBackMock.mockResolvedValue(OTHER_BYTES);

    await expect(store.bind(command(order, fulfillment!))).resolves.toEqual({
      ok: false,
      blocker: "STORED_BYTES_MISMATCH",
    });
    expect(await prisma.oTFulfillmentArtifact.count({
      where: { fulfillmentId: fulfillment!.id },
    })).toBe(0);
    expect(await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    })).toMatchObject({ status: "ARTIFACT_PENDING", statusRevision: 0 });
  });

  it("fails closed when activation is withdrawn while the locked transaction waits", async () => {
    const { order, fulfillment } = await seed();
    const locker = await pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof store.bind>>> | undefined;
    try {
      await locker.query("BEGIN");
      await locker.query('SELECT "id" FROM "ot_order" WHERE "id" = $1 FOR UPDATE', [order.id]);
      pending = store.bind(command(order, fulfillment!));

      let observedLockWait = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const waits = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE '%FROM "ot_order"%'`,
        );
        if (Number(waits.rows[0]?.count ?? 0) > 0) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(observedLockWait).toBe(true);

      delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED;
      await locker.query("COMMIT");
      await expect(pending).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" });
    } finally {
      process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true";
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
      if (pending) await pending.catch(() => undefined);
    }

    expect(await prisma.oTFulfillmentArtifact.count({
      where: { fulfillmentId: fulfillment!.id },
    })).toBe(0);
    expect(await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    })).toMatchObject({ status: "ARTIFACT_PENDING", statusRevision: 0 });
  });

  it.each(["REFUNDED", "CANCELLED"])(
    "fails closed when %s wins after stored-byte proof but before the locked bind",
    async (terminalStatus) => {
      const { order, fulfillment } = await seed();
      const locker = await pool.connect();
      let pending: Promise<Awaited<ReturnType<typeof store.bind>>> | undefined;
      try {
        await locker.query("BEGIN");
        await locker.query('SELECT "id" FROM "ot_order" WHERE "id" = $1 FOR UPDATE', [order.id]);
        pending = store.bind(command(order, fulfillment!));

        let observedLockWait = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const waits = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND query LIKE '%FROM "ot_order"%'`,
          );
          if (Number(waits.rows[0]?.count ?? 0) > 0) {
            observedLockWait = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(observedLockWait).toBe(true);

        await locker.query('UPDATE "ot_order" SET "status" = $1 WHERE "id" = $2', [terminalStatus, order.id]);
        await locker.query("COMMIT");
        await expect(pending).resolves.toEqual({
          ok: false,
          blocker: "INELIGIBLE_SETTLEMENT",
        });
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        locker.release();
        if (pending) await pending.catch(() => undefined);
      }

      expect(await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      })).toBe(0);
      expect(await prisma.oTFulfillment.findUnique({
        where: { id: fulfillment!.id },
      })).toMatchObject({ status: "ARTIFACT_PENDING", statusRevision: 0 });
    },
  );

  it.each([
    ["CHECKOUT_CREATED"],
    ["PAID_RECOVERY_REQUIRED"],
    ["REFUNDED"],
    ["CANCELLED"],
  ])("writes nothing for ineligible settlement status %s", async (status) => {
    const { order, fulfillment } = await seed({ status });
    const result = await store.bind(command(order, fulfillment!));

    expect(result).toEqual({
      ok: false,
      blocker: "INELIGIBLE_SETTLEMENT",
    });
    expect(
      await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      }),
    ).toBe(0);
  });

  it("writes nothing for a non-T2 tier", async () => {
    const { order, fulfillment } = await seed({ tier: "T3" });
    const result = await store.bind(command(order, fulfillment!));
    expect(result).toEqual({ ok: false, blocker: "INELIGIBLE_TIER" });
    expect(
      await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      }),
    ).toBe(0);
  });

  it("writes nothing when property binding is incomplete", async () => {
    const { order, fulfillment } = await seed({ pin: null });
    const result = await store.bind(command(order, fulfillment!));
    expect(result).toEqual({
      ok: false,
      blocker: "INCOMPLETE_PROPERTY_BINDING",
    });
    expect(
      await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      }),
    ).toBe(0);
  });

  it.each([
    ["analysis acknowledgment timestamp", { analysisAcknowledgedAt: null }, "MISSING_ANALYSIS_ACKNOWLEDGMENT"],
    ["analysis acknowledgment version", { acknowledgmentVersion: null }, "MISSING_ANALYSIS_ACKNOWLEDGMENT"],
    ["analysis acknowledgment evidence", { acknowledgmentEvidence: Prisma.JsonNull }, "MISSING_ANALYSIS_ACKNOWLEDGMENT"],
    ["checkout key", { checkoutKey: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["contract key", { contractKey: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["Stripe session", { stripeSessionId: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["checkout price", { checkoutPriceId: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["checkout product", { checkoutProductId: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["checkout amount", { checkoutAmountCents: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["checkout currency", { checkoutCurrency: null }, "INCOMPLETE_CHECKOUT_CONTRACT"],
    ["positive settled amount", { settledAmountCents: 0 }, "INVALID_SETTLEMENT"],
    ["settled currency", { settledCurrency: null }, "INVALID_SETTLEMENT"],
    ["positive amountPaid", { amountPaid: 0 }, "INVALID_SETTLEMENT"],
    ["matching amount", { settledAmountCents: 6800 }, "CHECKOUT_SETTLEMENT_MISMATCH"],
    ["matching currency", { settledCurrency: "cad" }, "CHECKOUT_SETTLEMENT_MISMATCH"],
    ["nonnegative modern attempt marker", { attempt: -1 }, "LEGACY_ORDER_EXCLUDED"],
    ["absence of recovery marker", { recoveryReason: "MANUAL_RECOVERY" }, "LEGACY_ORDER_EXCLUDED"],
  ] as const)("fails closed with zero mutation when %s is invalid", async (_label, overrides, blocker) => {
    const { order, fulfillment } = await seed(overrides as Parameters<typeof seed>[0]);
    const result = await store.bind(command(order, fulfillment!));
    expect(result).toEqual({ ok: false, blocker });
    expect(await prisma.oTFulfillmentArtifact.count({ where: { fulfillmentId: fulfillment!.id } })).toBe(0);
    expect(await prisma.oTFulfillment.findUnique({ where: { id: fulfillment!.id } })).toMatchObject({
      status: "ARTIFACT_PENDING",
      statusRevision: 0,
    });
  });

  it("explicitly refuses a synthetic ARTIFACT_PENDING legacy-shaped paid row", async () => {
    const { order, fulfillment } = await seed({
      attempt: 0,
      analysisAcknowledgedAt: null,
      acknowledgmentVersion: null,
      acknowledgmentEvidence: Prisma.JsonNull,
      checkoutKey: null,
      contractKey: null,
      stripeSessionId: null,
      checkoutPriceId: null,
      checkoutProductId: null,
      checkoutAmountCents: null,
      checkoutCurrency: null,
      settledAmountCents: null,
      settledCurrency: null,
      amountPaid: 0,
    });
    await expect(store.bind(command(order, fulfillment!))).resolves.toEqual({
      ok: false,
      blocker: "MISSING_ANALYSIS_ACKNOWLEDGMENT",
    });
    expect(await prisma.oTFulfillmentArtifact.count({ where: { fulfillmentId: fulfillment!.id } })).toBe(0);
  });

  it("refuses a fulfillment belonging to a different order and mutates nothing", async () => {
    const { order, fulfillment } = await seed();
    const otherOrder = await prisma.oTOrder.create({
      data: {
        id: `${prefix}_order_other`,
        checkoutKey: `${prefix}:checkout2`,
        contractKey: `${prefix}:contract2`,
        tier: "T2",
        email: `${prefix}b@example.com`,
        propertyAddress: ADDRESS,
        propertyPin: PIN,
        township: "Northfield",
        windowStatus: "OPEN",
        checkoutAmountCents: 6900,
        checkoutCurrency: "usd",
        stripeSessionId: `${prefix}_session2`,
        status: "PAID",
        attempt: 1,
      },
    });

    const result = await store.bind(
      command(otherOrder, fulfillment!, {
        provenance: {
          sourceOrderId: otherOrder.id,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: GENERATED_AT,
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      blocker: "FULFILLMENT_ORDER_MISMATCH",
    });
    expect(
      await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      }),
    ).toBe(0);

    await prisma.oTOrder.delete({ where: { id: otherOrder.id } });
    void order;
  });

  // --- Replay lifecycle allowlist, proven against real rows ---------------
  //
  // The reviewed version bypassed the status gate whenever a row already
  // existed, so an exact replay resurrected ARTIFACT_READY from CANCELLED.
  // These prove the refusal on the engine, and — the load-bearing part — that
  // the refusal leaves the artifact row and the summary status untouched.
  it.each([
    ["CANCELLED"],
    ["MANUAL_REVIEW"],
    ["FAILED"],
    ["BOUNCED"],
    ["COMPLAINED"],
    ["DELIVERED"],
  ])(
    "refuses an exact replay from %s and mutates nothing",
    async (terminal) => {
      const { order, fulfillment } = await seed();

      // First bind succeeds normally and advances to ARTIFACT_READY / rev 1.
      const first = await store.bind(command(order, fulfillment!));
      expect(first).toMatchObject({ ok: true, created: true });

      // The fulfillment then moves on, exactly as a real lifecycle would.
      await prisma.oTFulfillment.update({
        where: { id: fulfillment!.id },
        data: { status: terminal as OTFulfillmentStatus, statusRevision: 2 },
      });
      const before = await prisma.oTFulfillmentArtifact.findMany({
        where: { fulfillmentId: fulfillment!.id },
      });

      const replay = await store.bind(command(order, fulfillment!));
      expect(replay).toEqual({
        ok: false,
        blocker: "INELIGIBLE_FULFILLMENT_STATUS",
      });

      // No resurrection: status and revision are exactly as we left them.
      const summary = await prisma.oTFulfillment.findUnique({
        where: { id: fulfillment!.id },
      });
      expect(summary).toMatchObject({ status: terminal, statusRevision: 2 });

      // And the bound evidence itself is byte-for-byte unchanged.
      const after = await prisma.oTFulfillmentArtifact.findMany({
        where: { fulfillmentId: fulfillment!.id },
      });
      expect(after).toHaveLength(1);
      expect(after[0]).toEqual(before[0]);
    },
  );

  it("refuses an existing-row / ARTIFACT_PENDING inconsistency", async () => {
    const { order, fulfillment } = await seed();
    await store.bind(command(order, fulfillment!));

    // A row exists while the summary claims the artifact is still pending —
    // a contradiction, not a replay.
    await prisma.oTFulfillment.update({
      where: { id: fulfillment!.id },
      data: { status: "ARTIFACT_PENDING", statusRevision: 2 },
    });

    const replay = await store.bind(command(order, fulfillment!));
    expect(replay).toEqual({
      ok: false,
      blocker: "INELIGIBLE_FULFILLMENT_STATUS",
    });

    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary).toMatchObject({
      status: "ARTIFACT_PENDING",
      statusRevision: 2,
    });
    expect(
      await prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: fulfillment!.id },
      }),
    ).toBe(1);
  });

  it("still permits the exact no-op replay from ARTIFACT_READY", async () => {
    const { order, fulfillment } = await seed();
    const first = await store.bind(command(order, fulfillment!));
    const replay = await store.bind(command(order, fulfillment!));

    expect(replay).toMatchObject({ ok: true, created: false });
    if (first.ok && replay.ok) expect(replay.artifactId).toBe(first.artifactId);

    const summary = await prisma.oTFulfillment.findUnique({
      where: { id: fulfillment!.id },
    });
    expect(summary).toMatchObject({
      status: "ARTIFACT_READY",
      statusRevision: 1,
    });
  });

  it("never creates a fulfillment summary — no historical backfill", async () => {
    // Models the legacy mismatched paid T2 order: paid, but with no evidence
    // row. Binding must refuse and must NOT manufacture a summary for it.
    const { order } = await seed({ withFulfillment: false });

    const result = await store.bind(
      command(order, { id: `${prefix}_missing_fulfillment` }),
    );
    expect(result).toEqual({ ok: false, blocker: "FULFILLMENT_NOT_FOUND" });

    expect(
      await prisma.oTFulfillment.count({ where: { orderId: order.id } }),
    ).toBe(0);

    // The paid order itself is untouched.
    const after = await prisma.oTOrder.findUnique({ where: { id: order.id } });
    expect(after).toMatchObject({ status: "PAID", tier: "T2" });
    expect(after?.settledAmountCents).toBe(6900);
  });

  it("enforces the unique (fulfillment, version) index at the database level", async () => {
    const { fulfillment } = await seed();
    await prisma.oTFulfillmentArtifact.create({
      data: {
        fulfillmentId: fulfillment!.id,
        version: 1,
        artifactSha256: computeArtifactSha256(BYTES),
        byteSize: BYTES.byteLength,
        storageLocator: `artifacts/${prefix}/v1.pdf`,
        generatorVersion: "gen_v1",
      },
    });

    await expect(
      prisma.oTFulfillmentArtifact.create({
        data: {
          fulfillmentId: fulfillment!.id,
          version: 1,
          artifactSha256: computeArtifactSha256(OTHER_BYTES),
          byteSize: OTHER_BYTES.byteLength,
          storageLocator: `artifacts/${prefix}/v1b.pdf`,
          generatorVersion: "gen_v1",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces the all-or-nothing provenance CHECK constraint", async () => {
    const { fulfillment } = await seed();
    // Half-populated provenance must be impossible at the storage layer.
    await expect(
      prisma.$executeRaw`
        INSERT INTO "ot_fulfillment_artifact"
          ("id", "fulfillment_id", "version", "artifact_sha256", "byte_size",
           "storage_locator", "generator_version", "created_at", "source_order_id")
        VALUES (${`${prefix}_half`}, ${fulfillment!.id}, 9, ${"a".repeat(64)}, 10,
           ${"artifacts/x/v9.pdf"}, ${"gen_v1"}, NOW(), ${"some-order"})
      `,
    ).rejects.toThrow();
  });

  describe("future generation time is refused against real transaction time", () => {
    // The clock here is PostgreSQL's own CURRENT_TIMESTAMP, read inside the
    // binding transaction. Nothing in the command can influence it.

    async function artifactState(fulfillmentId: string) {
      const [count, summary] = await Promise.all([
        prisma.oTFulfillmentArtifact.count({ where: { fulfillmentId } }),
        prisma.oTFulfillment.findUnique({
          where: { id: fulfillmentId },
          select: { status: true, statusRevision: true },
        }),
      ]);
      return {
        count,
        status: summary?.status,
        revision: summary?.statusRevision,
      };
    }

    it("reads a trusted clock that actually agrees with real UTC", async () => {
      // Regression guard. Reading CURRENT_TIMESTAMP through driver date mapping
      // yields the server's LOCAL wall-clock reading relabelled as UTC — a
      // silent skew equal to the UTC offset, which would refuse legitimate
      // bindings generated inside that window. The store therefore has the
      // database render canonical UTC text. Prove the result is genuinely UTC.
      const rows = await prisma.$queryRaw<Array<{ now: unknown }>>(
        Prisma.sql`
          SELECT to_char(
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ) AS "now"
        `,
      );
      const trustedNow = rows[0]!.now;
      expect(typeof trustedNow).toBe("string");
      expect(trustedNow).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      // Within a minute of this process's own UTC clock, in either direction.
      const skewMs = Math.abs(
        new Date(trustedNow as string).getTime() - Date.now(),
      );
      expect(skewMs).toBeLessThan(60_000);
    });

    it("refuses a future generatedAt and mutates absolutely nothing", async () => {
      const { order, fulfillment } = await seed();
      const before = await artifactState(fulfillment!.id);

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: {
            sourceOrderId: order.id,
            propertyPin: PIN,
            propertyAddress: ADDRESS,
            generatorVersion: "gen_v1",
            templateVersion: "tpl_v1",
            generatedAt: future,
          },
        }) as never,
      );

      expect(result).toEqual({ ok: false, blocker: "GENERATED_AT_IN_FUTURE" });

      // Zero artifact rows, zero status change, zero revision change.
      const after = await artifactState(fulfillment!.id);
      expect(after.count).toBe(before.count);
      expect(after.count).toBe(0);
      expect(after.status).toBe("ARTIFACT_PENDING");
      expect(after.revision).toBe(before.revision);
    });

    it("refuses a far-future generatedAt identically", async () => {
      const { order, fulfillment } = await seed();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: {
            sourceOrderId: order.id,
            propertyPin: PIN,
            propertyAddress: ADDRESS,
            generatorVersion: "gen_v1",
            templateVersion: "tpl_v1",
            generatedAt: "2099-01-01T00:00:00.000Z",
          },
        }) as never,
      );
      expect(result).toEqual({ ok: false, blocker: "GENERATED_AT_IN_FUTURE" });
      const after = await artifactState(fulfillment!.id);
      expect(after.count).toBe(0);
      expect(after.status).toBe("ARTIFACT_PENDING");
      expect(after.revision).toBe(0);
    });

    it("positive control: a past generatedAt still binds and advances the summary", async () => {
      const { order, fulfillment } = await seed();
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: {
            sourceOrderId: order.id,
            propertyPin: PIN,
            propertyAddress: ADDRESS,
            generatorVersion: "gen_v1",
            templateVersion: "tpl_v1",
            generatedAt: past,
          },
        }) as never,
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);
      const after = await artifactState(fulfillment!.id);
      expect(after.count).toBe(1);
      expect(after.status).toBe("ARTIFACT_READY");
      expect(after.revision).toBe(1);
    });

    it("the approved ARTIFACT_READY replay remains green under the new gate", async () => {
      const { order, fulfillment } = await seed();
      const past = new Date(Date.now() - 60 * 1000).toISOString();
      const cmd = command(order, fulfillment!, {
        provenance: {
          sourceOrderId: order.id,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: past,
        },
      }) as never;

      const first = await store.bind(cmd);
      expect(first.ok).toBe(true);
      const afterFirst = await artifactState(fulfillment!.id);

      const replay = await store.bind(cmd);
      expect(replay).toMatchObject({ ok: true, created: false });

      // An exact replay is a true no-op: no second row, no extra revision bump.
      const afterReplay = await artifactState(fulfillment!.id);
      expect(afterReplay).toEqual(afterFirst);
      expect(afterReplay.count).toBe(1);
      expect(afterReplay.revision).toBe(1);
    });
  });

  describe("timezone coherence — persisted instants under a non-UTC database", () => {
    /**
     * Phase 1 stores artifact timestamps as TIMESTAMP(3) WITHOUT TIME ZONE.
     * Such a column holds a bare wall-clock reading with no zone attached, so
     * the ONLY thing that makes it meaningful is an agreement about which zone
     * that reading is in. Everything downstream — `deriveProvenanceState`, the
     * evidence loader, the admin console — treats it as UTC.
     *
     * Two things can break that agreement:
     *   - leaving `created_at` to `DEFAULT CURRENT_TIMESTAMP` while the
     *     PostgreSQL session runs a non-UTC zone, which stores LOCAL wall time;
     *   - serializing `generated_at` through a driver that renders a JS Date in
     *     the Node process's local zone.
     *
     * These assertions therefore read the persisted values as TEXT via
     * `to_char`, not through the driver's date mapping. That is deliberate: if
     * the Node process and the database happen to share a zone, a driver
     * round-trip re-parses local-as-local and silently cancels the storage
     * error, so a `Date`-based assertion would pass while the bytes on disk are
     * wrong. The text form is what a differently-zoned reader actually sees.
     */

    /** Real UTC, independent of the process zone. */
    function realUtcNowMs(): number {
      return new Date().getTime();
    }

    function parseStoredUtc(text: string): number {
      return Date.parse(text);
    }

    async function sessionTimeZone(): Promise<string> {
      const rows = await prisma.$queryRaw<Array<{ tz: string }>>(
        Prisma.sql`SELECT current_setting('TimeZone') AS "tz"`,
      );
      return rows[0]!.tz;
    }

    /**
     * The raw wall-clock readings actually on disk, rendered as text by the
     * database and labelled `Z` because that is the frame every reader assumes.
     */
    async function storedInstants(fulfillmentId: string) {
      const rows = await prisma.$queryRaw<
        Array<{ generated: string | null; created: string }>
      >(
        Prisma.sql`SELECT
                     to_char("generated_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "generated",
                     to_char("created_at",   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "created"
                   FROM "ot_fulfillment_artifact"
                   WHERE "fulfillment_id" = ${fulfillmentId}`,
      );
      return rows[0]!;
    }

    function pastProvenance(orderId: string, msAgo: number) {
      return {
        sourceOrderId: orderId,
        propertyPin: PIN,
        propertyAddress: ADDRESS,
        generatorVersion: "gen_v1",
        templateVersion: "tpl_v1",
        generatedAt: new Date(realUtcNowMs() - msAgo).toISOString(),
      };
    }

    it("is exercising a genuinely non-UTC database session", async () => {
      const tz = await sessionTimeZone();
      expect(tz).not.toBe("UTC");
      // Guard against a silently-UTC cluster making the rest vacuous.
      const rows = await prisma.$queryRaw<Array<{ off: string }>>(
        Prisma.sql`SELECT to_char(CURRENT_TIMESTAMP, 'OF') AS "off"`,
      );
      expect(rows[0]!.off).not.toBe("+00");
    });

    it("reads a trusted clock that agrees with real UTC to within 60s", async () => {
      const rows = await prisma.$queryRaw<Array<{ now: string }>>(
        Prisma.sql`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "now"`,
      );
      expect(
        Math.abs(parseStoredUtc(rows[0]!.now) - realUtcNowMs()),
      ).toBeLessThan(60_000);
    });

    it("persists created_at as canonical UTC wall time, not local wall time", async () => {
      const { order, fulfillment } = await seed();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: pastProvenance(order.id, 60_000),
        }),
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);

      const stored = await storedInstants(fulfillment!.id);
      // Read as UTC — the frame every consumer assumes — this must be now.
      expect(
        Math.abs(parseStoredUtc(stored.created) - realUtcNowMs()),
      ).toBeLessThan(60_000);
    });

    it("persists generated_at as canonical UTC wall time", async () => {
      const { order, fulfillment } = await seed();
      const provenance = pastProvenance(order.id, 60_000);
      const result = await store.bind(
        command(order, fulfillment!, { provenance }),
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);

      const stored = await storedInstants(fulfillment!.id);
      expect(
        Math.abs(
          parseStoredUtc(stored.generated!) -
            Date.parse(provenance.generatedAt),
        ),
      ).toBeLessThan(1_000);
    });

    it("binds a packet generated one minute ago and persists generatedAt <= createdAt", async () => {
      const { order, fulfillment } = await seed();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: pastProvenance(order.id, 60_000),
        }),
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);

      const stored = await storedInstants(fulfillment!.id);
      // This is precisely the relation `deriveProvenanceState` enforces.
      expect(parseStoredUtc(stored.generated!)).toBeLessThanOrEqual(
        parseStoredUtc(stored.created),
      );
    });

    it("the REAL admin read model classifies the persisted row as RECORDED", async () => {
      const { order, fulfillment } = await seed();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: pastProvenance(order.id, 60_000),
        }),
      );
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);

      const summary = await prisma.oTFulfillment.findUniqueOrThrow({
        where: { id: fulfillment!.id },
        select: { status: true, statusRevision: true },
      });
      const rows = await prisma.oTFulfillmentArtifact.findMany({
        where: { fulfillmentId: fulfillment!.id },
        select: {
          version: true,
          artifactSha256: true,
          byteSize: true,
          generatorVersion: true,
          templateVersion: true,
          sourceOrderId: true,
        },
      });
      const stored = await storedInstants(fulfillment!.id);
      const hourAgo = new Date(realUtcNowMs() - 3_600_000).toISOString();

      // Feed the ACTUAL persisted wall-clock readings — as a UTC-zoned reader
      // sees them — through the ACTUAL projection.
      const view = deriveAdminEvidenceView({
        order: {
          id: order.id,
          tier: "T2",
          status: "PAID",
          amountPaid: 69,
          createdAt: hourAgo,
        },
        fulfillment: {
          id: fulfillment!.id,
          kind: "T2_APPEAL_EVIDENCE",
          status: summary.status,
          statusRevision: summary.statusRevision,
          attemptCount: 0,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastReasonCode: null,
          createdAt: hourAgo,
          updatedAt: stored.created,
          artifacts: rows.map((a) => ({
            version: a.version,
            artifactSha256: a.artifactSha256,
            byteSize: a.byteSize,
            generatorVersion: a.generatorVersion,
            templateVersion: a.templateVersion,
            createdAt: stored.created,
            generatedAt: stored.generated,
            sourceOrderId: a.sourceOrderId,
            // Round 1 authenticates this at the loader; a matching binding is
            // not what this test is about, so state it directly.
            propertyBinding: "MATCHES" as const,
          })),
          attempts: [],
          events: [],
        },
        now: new Date(realUtcNowMs()).toISOString(),
      });

      expect(view.artifact.provenance).toBe("RECORDED");
      expect(view.conflicted).toBe(false);
      expect(view.summary.displayState).toBe("ARTIFACT_READY");
      expect(summary.status).toBe("ARTIFACT_READY");
      expect(summary.statusRevision).toBe(1);
    });

    it("still refuses a future generatedAt under a non-UTC session and mutates nothing", async () => {
      const { order, fulfillment } = await seed();
      const result = await store.bind(
        command(order, fulfillment!, {
          provenance: pastProvenance(order.id, -3_600_000),
        }),
      );
      expect(result).toEqual({
        ok: false,
        blocker: "GENERATED_AT_IN_FUTURE",
      });

      expect(
        await prisma.oTFulfillmentArtifact.count({
          where: { fulfillmentId: fulfillment!.id },
        }),
      ).toBe(0);
      const summary = await prisma.oTFulfillment.findUniqueOrThrow({
        where: { id: fulfillment!.id },
        select: { status: true, statusRevision: true },
      });
      expect(summary.status).toBe("ARTIFACT_PENDING");
      expect(summary.statusRevision).toBe(0);
    });

    /**
     * The decisive one. `created_at` must come from the SAME PostgreSQL
     * transaction instant the gates were judged against — not from a second,
     * independent application clock.
     *
     * Prisma resolves `@default(now())` client-side (the column's
     * `DEFAULT CURRENT_TIMESTAMP` never fires for a Prisma insert), so omitting
     * `createdAt` silently sources it from the Node process clock. That clock is
     * not the clock `trustedNow` came from. When it lags, a packet whose
     * `generatedAt` legitimately precedes trusted transaction time is persisted
     * with `generatedAt > createdAt` and the read model taints it on sight.
     *
     * Only `Date` is faked; timers stay real so the driver keeps working.
     */
    it("sources created_at from the trusted transaction clock, not the app clock", async () => {
      const { order, fulfillment } = await seed();
      const trueNowMs = realUtcNowMs();
      // An honest generator using a correct UTC source, one minute ago.
      const generatedAt = new Date(trueNowMs - 60_000).toISOString();

      jest.useFakeTimers({
        now: trueNowMs - 2 * 3_600_000, // application clock lags two hours
        doNotFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "setImmediate",
          "clearImmediate",
          "nextTick",
          "queueMicrotask",
          "performance",
          "hrtime",
        ],
      });
      let result: Awaited<ReturnType<typeof store.bind>>;
      try {
        result = await store.bind(
          command(order, fulfillment!, {
            provenance: {
              sourceOrderId: order.id,
              propertyPin: PIN,
              propertyAddress: ADDRESS,
              generatorVersion: "gen_v1",
              templateVersion: "tpl_v1",
              generatedAt,
            },
          }),
        );
      } finally {
        jest.useRealTimers();
      }
      if (!result.ok) throw new Error(`unexpected refusal: ${result.blocker}`);

      const stored = await storedInstants(fulfillment!.id);
      // The lagging application clock must not have reached the row at all.
      expect(
        Math.abs(parseStoredUtc(stored.created) - realUtcNowMs()),
      ).toBeLessThan(60_000);
      // ...so the invariant the read model enforces still holds.
      expect(parseStoredUtc(stored.generated!)).toBeLessThanOrEqual(
        parseStoredUtc(stored.created),
      );
    });

    it("exact ARTIFACT_READY replay under a non-UTC session stays one row / revision 1", async () => {
      const { order, fulfillment } = await seed();
      const provenance = pastProvenance(order.id, 60_000);
      const first = await store.bind(
        command(order, fulfillment!, { provenance }),
      );
      if (!first.ok) throw new Error(`unexpected refusal: ${first.blocker}`);
      const before = await storedInstants(fulfillment!.id);

      const replay = await store.bind(
        command(order, fulfillment!, { provenance }),
      );
      expect(replay).toMatchObject({ ok: true, created: false });

      expect(
        await prisma.oTFulfillmentArtifact.count({
          where: { fulfillmentId: fulfillment!.id },
        }),
      ).toBe(1);
      // A replay authorizes no write, so the persisted instants are untouched.
      expect(await storedInstants(fulfillment!.id)).toEqual(before);
      const summary = await prisma.oTFulfillment.findUniqueOrThrow({
        where: { id: fulfillment!.id },
        select: { status: true, statusRevision: true },
      });
      expect(summary.status).toBe("ARTIFACT_READY");
      expect(summary.statusRevision).toBe(1);
    });
  });
});
