/** @jest-environment node */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

import { kickOffT2FulfillmentEvidence } from "@/lib/fulfillment-runtime/kickoff";
import { createPrismaT2FulfillmentKickoffStore } from "@/lib/fulfillment-runtime/prisma-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = testDatabaseUrl ? describe : describe.skip;

describeIfDb("OT fulfillment PostgreSQL kickoff proof", () => {
  jest.setTimeout(30_000);

  let pool: Pool;
  let prisma: PrismaClient;
  let prefix: string;

  beforeAll(() => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 5, ssl: false });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  beforeEach(() => {
    prefix = `ot_fulfillment_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    await prisma.oTOrder.deleteMany({ where: { id: { startsWith: prefix } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  async function paidT2Order() {
    return prisma.oTOrder.create({
      data: {
        id: `${prefix}_order`,
        checkoutKey: `${prefix}:checkout`,
        contractKey: `${prefix}:contract`,
        tier: "T2",
        email: `${prefix}@example.com`,
        propertyAddress: "123 Main St",
        propertyPin: "09000000000000",
        township: "Northfield",
        windowStatus: "OPEN",
        checkoutAmountCents: 6900,
        checkoutCurrency: "usd",
        settledAmountCents: 6900,
        settledCurrency: "usd",
        stripeSessionId: `${prefix}_session`,
        status: "PAID",
        attempt: 1,
      },
    });
  }

  it("converges concurrent retries to one row and never resets later state", async () => {
    const order = await paidT2Order();
    const store = createPrismaT2FulfillmentKickoffStore(
      prisma as unknown as Parameters<
        typeof createPrismaT2FulfillmentKickoffStore
      >[0],
    );
    const input = {
      id: order.id,
      tier: order.tier,
      status: order.status,
      propertyAddress: order.propertyAddress,
      propertyPin: order.propertyPin,
    };
    const options = {
      env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
      store,
    };

    await Promise.all([
      kickOffT2FulfillmentEvidence(input, options),
      kickOffT2FulfillmentEvidence(input, options),
    ]);

    const summary = await prisma.oTFulfillment.findUnique({
      where: {
        orderId_kind: { orderId: order.id, kind: "T2_APPEAL_EVIDENCE" },
      },
    });
    expect(summary).toMatchObject({
      orderId: order.id,
      status: "ARTIFACT_PENDING",
    });
    if (!summary) throw new Error("expected fulfillment summary");

    const [artifactCount, attemptCount, eventCount] = await Promise.all([
      prisma.oTFulfillmentArtifact.count({
        where: { fulfillmentId: summary.id },
      }),
      prisma.oTDeliveryAttempt.count({ where: { fulfillmentId: summary.id } }),
      prisma.oTDeliveryEvent.count({ where: { fulfillmentId: summary.id } }),
    ]);
    expect({ artifactCount, attemptCount, eventCount }).toEqual({
      artifactCount: 0,
      attemptCount: 0,
      eventCount: 0,
    });

    const fulfillment = await prisma.oTFulfillment.update({
      where: {
        orderId_kind: { orderId: order.id, kind: "T2_APPEAL_EVIDENCE" },
      },
      data: { status: "DELIVERED" },
    });

    await kickOffT2FulfillmentEvidence(input, options);

    expect(
      await prisma.oTFulfillment.findUnique({ where: { id: fulfillment.id } }),
    ).toMatchObject({
      id: fulfillment.id,
      status: "DELIVERED",
      statusRevision: 0,
    });
  });

  it("cascades the summary when its parent OT order is deleted", async () => {
    const order = await paidT2Order();
    const store = createPrismaT2FulfillmentKickoffStore(
      prisma as unknown as Parameters<
        typeof createPrismaT2FulfillmentKickoffStore
      >[0],
    );
    await kickOffT2FulfillmentEvidence(
      {
        id: order.id,
        tier: order.tier,
        status: order.status,
        propertyAddress: order.propertyAddress,
        propertyPin: order.propertyPin,
      },
      {
        env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
        store,
      },
    );

    await prisma.oTOrder.delete({ where: { id: order.id } });
    expect(
      await prisma.oTFulfillment.count({ where: { orderId: order.id } }),
    ).toBe(0);
  });
});
