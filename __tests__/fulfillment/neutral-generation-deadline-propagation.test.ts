/** @jest-environment node */

jest.mock("server-only", () => ({}), { virtual: true });

import {
  NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
  runNeutralReportGeneration,
  type NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";

function claimedStore(): NeutralGenerationStore {
  return {
    ensure: jest.fn(), candidates: jest.fn(),
    claim: jest.fn(async () => ({ workId: "w1", revision: 1 })),
    beginProduction: jest.fn(async () => ({ workId: "w1", orderId: "ord1", propertyPin: "14000000000000", revision: 2 })),
    transition: jest.fn(async () => true),
  };
}

test("worker propagates its absolute invocation deadline into the real producer boundary", async () => {
  const store = claimedStore();
  const deadline = Date.parse("2026-09-22T00:00:45.000Z");
  const produce = jest.fn(async () => ({ ok: false as const, blocker: "NEUTRAL_RAW_SOURCE_UNAVAILABLE" as const }));
  await runNeutralReportGeneration(
    { workId: "w1" },
    {
      env: { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true" },
      store,
      produce,
      now: () => new Date("2026-09-22T00:00:00.000Z"),
      deadline,
    },
  );
  expect(produce).toHaveBeenCalledWith({
    orderId: "ord1",
    propertyPin: "14000000000000",
    deadline,
  });
});

test("worker rechecks the budget after a slow claim before beginning production", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-22T00:00:00.000Z"));
  const store = claimedStore();
  (store.claim as jest.Mock).mockImplementation(async () => {
    jest.setSystemTime(new Date(Date.now() + NEUTRAL_GENERATION_INVOCATION_BUDGET_MS));
    return { workId: "w1", revision: 1 };
  });
  try {
    await expect(runNeutralReportGeneration(
      { workId: "w1" },
      {
        env: { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true" },
        store,
        now: () => new Date(Date.now()),
        deadline: Date.now() + NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
      },
    )).resolves.toEqual({ outcome: "DEFERRED" });
    expect(store.beginProduction).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
