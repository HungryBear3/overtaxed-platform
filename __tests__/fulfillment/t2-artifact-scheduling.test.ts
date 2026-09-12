/** @jest-environment node */
import { scheduleT2ArtifactOrchestration } from "@/lib/fulfillment-runtime/t2-artifact-scheduling";
import type { T2FulfillmentKickoffResult } from "@/lib/fulfillment-runtime/kickoff";
jest.mock("server-only", () => ({}));
jest.mock("next/server", () => ({ after: jest.fn() }));
const pending: T2FulfillmentKickoffResult = {
  outcome: "PERSISTED",
  status: "ARTIFACT_PENDING",
  fulfillmentId: "ful_test",
};
const paid = { id: "ord_test", tier: "T2", status: "PAID" };
const on = { OT_T2_ARTIFACT_ORCHESTRATION_ENABLED: "true" };
function setup() {
  const callbacks: Array<() => Promise<void>> = [];
  const after = jest.fn((callback: () => Promise<void>) => {
    callbacks.push(callback);
  });
  const run = jest.fn(
    async (_input: { orderId: string; fulfillmentId: string }) => {},
  );
  return { callbacks, after, run, env: { ...on } };
}
test.each([undefined, "", " ", "false", "TRUE", "True", "1", "yes", "true "])(
  "flag %s schedules nothing",
  (flag) => {
    const deps = setup();
    deps.env = { OT_T2_ARTIFACT_ORCHESTRATION_ENABLED: flag as string };
    expect(scheduleT2ArtifactOrchestration(paid, pending, deps)).toBe(false);
    expect(deps.after).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  },
);
test.each([
  { ...paid, tier: "T3" },
  { ...paid, status: "PENDING" },
  { ...paid, status: "REFUNDED" },
  { ...paid, refunded: true },
  { ...paid, disputed: true },
])("ineligible order is inert: %j", (order) => {
  const deps = setup();
  expect(scheduleT2ArtifactOrchestration(order, pending, deps)).toBe(false);
  expect(deps.after).not.toHaveBeenCalled();
});
test.each<T2FulfillmentKickoffResult>([
  { outcome: "DISABLED" },
  { outcome: "SKIPPED", reason: "INCOMPLETE_INPUT" },
  { ...pending, status: "ARTIFACT_READY" },
  { ...pending, status: "DELIVERED" },
])("non-pending kickoff is inert: %j", (result) => {
  const deps = setup();
  expect(scheduleT2ArtifactOrchestration(paid, result, deps)).toBe(false);
  expect(deps.after).not.toHaveBeenCalled();
});
test("registers one deferred callback and does not wait for generation", async () => {
  const deps = setup();
  let finish!: () => void;
  deps.run.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(scheduleT2ArtifactOrchestration(paid, pending, deps)).toBe(true);
  expect(deps.after).toHaveBeenCalledTimes(1);
  expect(deps.run).not.toHaveBeenCalled();
  const running = deps.callbacks[0]();
  expect(deps.run).toHaveBeenCalledWith({
    orderId: "ord_test",
    fulfillmentId: "ful_test",
  });
  finish();
  await running;
});
test("disabling before callback execution prevents work", async () => {
  const deps = setup();
  scheduleT2ArtifactOrchestration(paid, pending, deps);
  deps.env.OT_T2_ARTIFACT_ORCHESTRATION_ENABLED = "false";
  await deps.callbacks[0]();
  expect(deps.run).not.toHaveBeenCalled();
});
test("callback contains raw claim/workflow errors and logs only a fixed code", async () => {
  const deps = setup();
  deps.run.mockRejectedValue(new Error("synthetic-private-provider-detail"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    scheduleT2ArtifactOrchestration(paid, pending, deps);
    await expect(deps.callbacks[0]()).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([
      ["[ot-artifact-orchestration] outcome=THREW"],
    ]);
  } finally {
    log.mockRestore();
  }
});
test("registration failure propagates to the webhook retry path", () => {
  const deps = setup();
  deps.after.mockImplementation(() => {
    throw new Error("registration failed");
  });
  expect(() => scheduleT2ArtifactOrchestration(paid, pending, deps)).toThrow(
    "registration failed",
  );
  expect(deps.run).not.toHaveBeenCalled();
});
