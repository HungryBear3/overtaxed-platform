/**
 * @jest-environment node
 */
import {
  kickOffT2FulfillmentEvidence,
  type T2FulfillmentKickoffStore,
} from "@/lib/fulfillment-runtime/kickoff";
import { createPrismaT2FulfillmentKickoffStore } from "@/lib/fulfillment-runtime/prisma-store";

const completePaidT2 = {
  id: "ord_t2_paid",
  tier: "T2",
  status: "PAID",
  propertyAddress: "1 TEST ST",
  propertyPin: "09000000000000",
};

function fakeStore() {
  const ensureInitial = jest.fn(async (input) => ({
    id: "ful_1",
    status: input.status,
  }));
  return {
    store: { ensureInitial } as T2FulfillmentKickoffStore,
    ensureInitial,
  };
}

describe("kickOffT2FulfillmentEvidence", () => {
  it.each([undefined, "false", "TRUE", "1"])(
    "is a hard no-op unless the feature flag is exact true (%s)",
    async (flag) => {
      const { store, ensureInitial } = fakeStore();
      const env =
        flag === undefined ? {} : { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: flag };
      await expect(
        kickOffT2FulfillmentEvidence(completePaidT2, { env, store }),
      ).resolves.toEqual({ outcome: "DISABLED" });
      expect(ensureInitial).not.toHaveBeenCalled();
    },
  );

  it("persists one ARTIFACT_PENDING summary for an exact paid T2 order", async () => {
    const { store, ensureInitial } = fakeStore();
    await expect(
      kickOffT2FulfillmentEvidence(completePaidT2, {
        env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
        store,
      }),
    ).resolves.toMatchObject({
      outcome: "PERSISTED",
      status: "ARTIFACT_PENDING",
    });
    expect(ensureInitial).toHaveBeenCalledTimes(1);
    expect(ensureInitial).toHaveBeenCalledWith({
      orderId: "ord_t2_paid",
      kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_PENDING",
      reasonCode: null,
    });
  });

  it.each([
    { propertyPin: null },
    { propertyPin: "0900-0000-0000-00" },
    { propertyPin: "0900000000000" },
    { propertyAddress: "   " },
  ])(
    "persists INCOMPLETE_INPUT rather than inferring readiness (%o)",
    async (missing) => {
      const { store, ensureInitial } = fakeStore();
      const incomplete = { ...completePaidT2, ...missing };
      await expect(
        kickOffT2FulfillmentEvidence(incomplete, {
          env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
          store,
        }),
      ).resolves.toMatchObject({
        outcome: "PERSISTED",
        status: "INCOMPLETE_INPUT",
      });
      expect(ensureInitial).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "INCOMPLETE_INPUT",
          reasonCode: "INCOMPLETE_INPUT",
        }),
      );
    },
  );

  it.each([
    [{ ...completePaidT2, tier: "T3" }, "INELIGIBLE_T3_MANUAL"],
    [
      { ...completePaidT2, status: "PAID_RECOVERY_REQUIRED" },
      "INELIGIBLE_RECOVERY_REQUIRED",
    ],
    [{ ...completePaidT2, status: "REFUNDED" }, "INELIGIBLE_REFUNDED"],
  ])(
    "does not create T2 evidence for an ineligible order",
    async (order, reason) => {
      const { store, ensureInitial } = fakeStore();
      await expect(
        kickOffT2FulfillmentEvidence(order, {
          env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
          store,
        }),
      ).resolves.toEqual({ outcome: "SKIPPED", reason });
      expect(ensureInitial).not.toHaveBeenCalled();
    },
  );
});

describe("Prisma T2 fulfillment kickoff store", () => {
  it("uses create-only upsert semantics so retries never rewrite existing state", async () => {
    const upsert = jest.fn(async () => ({
      id: "ful_existing",
      status: "DELIVERED",
      createdAt: new Date("2026-08-07T00:20:00.000Z"),
    }));
    const findUnique = jest.fn();
    const store = createPrismaT2FulfillmentKickoffStore({
      oTFulfillment: { upsert, findUnique },
    });

    await expect(
      store.ensureInitial({
        orderId: "ord_t2_paid",
        kind: "T2_APPEAL_EVIDENCE",
        status: "ARTIFACT_PENDING",
        reasonCode: null,
      }),
    ).resolves.toEqual({ id: "ful_existing", status: "DELIVERED" });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        orderId_kind: {
          orderId: "ord_t2_paid",
          kind: "T2_APPEAL_EVIDENCE",
        },
      },
      create: {
        orderId: "ord_t2_paid",
        kind: "T2_APPEAL_EVIDENCE",
        status: "ARTIFACT_PENDING",
        lastReasonCode: null,
      },
      update: {},
      select: { id: true, status: true },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("converges a concurrent compound-key P2002 only after reading the winner", async () => {
    const unique = Object.assign(new Error("unique"), { code: "P2002" });
    const upsert = jest.fn(async () => Promise.reject(unique));
    const findUnique = jest.fn(async () => ({
      id: "ful_winner",
      status: "ARTIFACT_PENDING",
    }));
    const store = createPrismaT2FulfillmentKickoffStore({
      oTFulfillment: { upsert, findUnique },
    });

    await expect(
      store.ensureInitial({
        orderId: "ord_t2_paid",
        kind: "T2_APPEAL_EVIDENCE",
        status: "ARTIFACT_PENDING",
        reasonCode: null,
      }),
    ).resolves.toEqual({ id: "ful_winner", status: "ARTIFACT_PENDING" });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        orderId_kind: {
          orderId: "ord_t2_paid",
          kind: "T2_APPEAL_EVIDENCE",
        },
      },
      select: { id: true, status: true },
    });
  });

  it("fails closed when a uniqueness error has no exact compound-key winner", async () => {
    const unique = Object.assign(new Error("unique"), { code: "P2002" });
    const store = createPrismaT2FulfillmentKickoffStore({
      oTFulfillment: {
        upsert: jest.fn(async () => Promise.reject(unique)),
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(
      store.ensureInitial({
        orderId: "ord_t2_paid",
        kind: "T2_APPEAL_EVIDENCE",
        status: "ARTIFACT_PENDING",
        reasonCode: null,
      }),
    ).rejects.toBe(unique);
  });
});
