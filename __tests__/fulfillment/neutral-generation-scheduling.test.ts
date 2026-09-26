/** @jest-environment node */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/server", () => ({ after: jest.fn() }));

import { enqueueAndScheduleNeutralReportProduction } from "@/lib/fulfillment-runtime/neutral-generation-scheduling";
import { sweepNeutralReportGeneration } from "@/lib/fulfillment-runtime/neutral-generation-recovery";

const enabled = { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true" };

test("durably enqueues before synchronously registering one callback and duplicate calls converge", async () => {
  const calls: string[] = [];
  const callbacks: Array<() => Promise<void>> = [];
  const store = {
    ensure: jest.fn(async () => {
      calls.push("ensure");
      return { workId: "work_1" };
    }),
  };
  const after = jest.fn((callback: () => Promise<void>) => {
    calls.push("after");
    callbacks.push(callback);
  });
  const run = jest.fn(async () => ({ outcome: "COMPLETE" as const }));
  await expect(
    enqueueAndScheduleNeutralReportProduction("ord_1", {
      env: enabled,
      store: store as never,
      after,
      run,
    }),
  ).resolves.toEqual({ outcome: "SCHEDULED", workId: "work_1" });
  await expect(
    enqueueAndScheduleNeutralReportProduction("ord_1", {
      env: enabled,
      store: store as never,
      after,
      run,
    }),
  ).resolves.toEqual({ outcome: "SCHEDULED", workId: "work_1" });
  expect(calls).toEqual(["ensure", "after", "ensure", "after"]);
  expect(run).not.toHaveBeenCalled();
  await Promise.all(callbacks.map((callback) => callback()));
  expect(run).toHaveBeenCalledTimes(2); // durable worker claim is the single-flight boundary
});

test("disabled and non-authoritative orders make no callback/producer/source calls", async () => {
  const store = { ensure: jest.fn(async () => null) };
  const after = jest.fn();
  const run = jest.fn();
  await expect(
    enqueueAndScheduleNeutralReportProduction("ord_1", {
      env: {},
      store: store as never,
      after,
      run,
    }),
  ).resolves.toEqual({ outcome: "DISABLED" });
  expect(store.ensure).not.toHaveBeenCalled();
  await expect(
    enqueueAndScheduleNeutralReportProduction("ord_1", {
      env: enabled,
      store: store as never,
      after,
      run,
    }),
  ).resolves.toEqual({ outcome: "REFUSED" });
  expect(after).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("registration failure propagates after durable enqueue", async () => {
  const store = { ensure: jest.fn(async () => ({ workId: "work_1" })) };
  await expect(
    enqueueAndScheduleNeutralReportProduction("ord_1", {
      env: enabled,
      store: store as never,
      after: () => {
        throw new Error("registration failed");
      },
    }),
  ).rejects.toThrow("registration failed");
  expect(store.ensure).toHaveBeenCalledTimes(1);
});

test("caller-supplied request-entry deadline is preserved through after registration", async () => {
  const callbacks: Array<() => Promise<void>> = [];
  const run = jest.fn(async () => ({ outcome: "DEFERRED" as const }));
  const deadline = 12_345;
  await enqueueAndScheduleNeutralReportProduction("ord_1", {
    env: enabled,
    store: { ensure: jest.fn(async () => ({ workId: "work_1" })) } as never,
    after: callback => { callbacks.push(callback); },
    run,
    now: () => 99_999,
    deadline,
  });
  await callbacks[0]!();
  expect(run).toHaveBeenCalledWith({ workId: "work_1" }, { env: enabled, deadline });
});

test("lost after callback remains recoverable; sweep is bounded, isolated, and excludes reconciliation", async () => {
  const candidates = jest.fn(async ({ limit }: { limit: number }) => {
    expect(limit).toBe(10);
    return ["pending", "retry", "expired"];
  });
  const run = jest.fn(async ({ workId }: { workId: string }) => {
    if (workId === "retry") throw new Error("synthetic");
    return { outcome: "COMPLETE" as const };
  });
  await expect(
    sweepNeutralReportGeneration({
      env: { ...enabled, OT_NEUTRAL_REPORT_RECOVERY_ENABLED: "true" },
      store: { candidates } as never,
      run,
    }),
  ).resolves.toEqual({ reviewed: 3, completed: 2, failed: 1, deferred: 0 });
  expect(run.mock.calls.map((call) => call[0].workId)).toEqual([
    "pending",
    "retry",
    "expired",
  ]);
});

test("a worker-deferred item is reported as deferred, not completed", async () => {
  const candidates = jest.fn(async () => ["w1"]);
  const run = jest.fn(async () => ({ outcome: "DEFERRED" as const }));
  await expect(
    sweepNeutralReportGeneration({
      env: { ...enabled, OT_NEUTRAL_REPORT_RECOVERY_ENABLED: "true" },
      store: { candidates } as never,
      run: run as never,
    }),
  ).resolves.toEqual({ reviewed: 1, completed: 0, failed: 0, deferred: 1 });
});

test("recovery is independently strict-default-off", async () => {
  for (const flag of [undefined, "1", "TRUE", "false", "true "]) {
    const candidates = jest.fn();
    const run = jest.fn();
    await expect(
      sweepNeutralReportGeneration({
        env: { ...enabled, OT_NEUTRAL_REPORT_RECOVERY_ENABLED: flag },
        store: { candidates } as never,
        run,
      }),
    ).resolves.toEqual({ reviewed: 0, completed: 0, failed: 0, deferred: 0 });
    expect(candidates).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  }
  const candidates = jest.fn();
  await expect(
    sweepNeutralReportGeneration({
      env: { OT_NEUTRAL_REPORT_RECOVERY_ENABLED: "true" },
      store: { candidates } as never,
    }),
  ).resolves.toEqual({ reviewed: 0, completed: 0, failed: 0, deferred: 0 });
  expect(candidates).not.toHaveBeenCalled();
});
