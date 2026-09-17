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
    async (_input: { orderId: string; fulfillmentId: string }): Promise<unknown> =>
      undefined,
  );
  return { callbacks, after, run, env: { ...on } as Record<string, string | undefined> };
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

/**
 * The delivery handoff.
 *
 * Delivery is reached from exactly one place: an artifact workflow that reported
 * BOUND with its producing lease already released. Every other outcome must
 * leave the sender untouched — not blocked at a later gate, but never invoked.
 */
describe("delivery runs only after a bound artifact and a released lease", () => {
  function delivery() {
    const deps = setup();
    const deliver = jest.fn(async () => ({ outcome: "ATTEMPTED" }));
    return { ...deps, deliver };
  }

  it("delivers once the workflow bound an artifact and gave the lease back", async () => {
    const deps = delivery();
    deps.run.mockResolvedValue({
      outcome: "RAN",
      workflowOutcome: "BOUND",
      released: true,
    } as never);
    scheduleT2ArtifactOrchestration(paid, pending, deps);
    await deps.callbacks[0]();
    expect(deps.deliver).toHaveBeenCalledWith({
      orderId: "ord_test",
      fulfillmentId: "ful_test",
    });
  });

  it.each([
    ["a workflow that produced nothing", { outcome: "RAN", workflowOutcome: "REFUSED", released: true }],
    ["a workflow that could not reconcile", { outcome: "RAN", workflowOutcome: "RECONCILIATION_REQUIRED", released: true }],
    ["a workflow that was disabled", { outcome: "RAN", workflowOutcome: "DISABLED", released: true }],
    ["a bound artifact whose lease was NOT released", { outcome: "RAN", workflowOutcome: "BOUND", released: false }],
    ["an orchestrator that never claimed", { outcome: "NOT_CLAIMED" }],
    ["an orchestrator that threw", { outcome: "THREW", released: true }],
    ["an orchestrator that returned nothing", undefined],
  ])("never delivers after %s", async (_label, result) => {
    const deps = delivery();
    deps.run.mockResolvedValue(result as never);
    scheduleT2ArtifactOrchestration(paid, pending, deps);
    await deps.callbacks[0]();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it("never delivers when the artifact orchestrator throws", async () => {
    const deps = delivery();
    deps.run.mockRejectedValue(new Error("synthetic-private-detail"));
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      scheduleT2ArtifactOrchestration(paid, pending, deps);
      await deps.callbacks[0]();
      expect(deps.deliver).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("contains a thrown delivery and logs only a fixed code", async () => {
    const deps = delivery();
    deps.run.mockResolvedValue({ outcome: "RAN", workflowOutcome: "BOUND", released: true } as never);
    deps.deliver.mockRejectedValue(new Error("synthetic-provider-detail") as never);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      scheduleT2ArtifactOrchestration(paid, pending, deps);
      await expect(deps.callbacks[0]()).resolves.toBeUndefined();
      expect(log.mock.calls).toEqual([["[ot-t2-delivery] outcome=THREW"]]);
    } finally {
      log.mockRestore();
    }
  });

  it("builds no real delivery caller while the delivery flag is shut", async () => {
    // No injected deliverer: the module must resolve one itself, and it must
    // refuse to. A thrown dynamic import would surface as the THREW log.
    const deps = setup();
    deps.run.mockResolvedValue({ outcome: "RAN", workflowOutcome: "BOUND", released: true } as never);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      deps.env.OT_T2_DELIVERY_ENABLED = "false";
      scheduleT2ArtifactOrchestration(paid, pending, deps);
      await expect(deps.callbacks[0]()).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
