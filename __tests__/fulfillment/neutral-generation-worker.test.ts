/** @jest-environment node */
jest.mock("server-only", () => ({}), { virtual: true });

import {
  NEUTRAL_GENERATION_LEASE_MS,
  runNeutralReportGeneration,
  type NeutralGenerationClaim,
  type NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";

type Work = {
  status:
    | "PENDING"
    | "CLAIMED"
    | "PRODUCING"
    | "COMPLETE"
    | "RETRY_REQUIRED"
    | "RECONCILIATION_REQUIRED"
    | "FAILED";
  revision: number;
  attemptCount: number;
  owner: string | null;
  token: string | null;
  expiresAt: Date | null;
  reasonCode: string | null;
  productionStartedAt: Date | null;
};

function memoryStore() {
  const work: Work = {
    status: "PENDING",
    revision: 0,
    attemptCount: 0,
    owner: null,
    token: null,
    expiresAt: null,
    reasonCode: null,
    productionStartedAt: null,
  };
  let authoritative = true;
  let currentTime = instant.getTime();
  const store: NeutralGenerationStore = {
    ensure: jest.fn(async () => ({ workId: "work_1" })),
    claim: jest.fn(async (input) => {
      const now = Date.parse(input.now);
      currentTime = now;
      if (!authoritative) return null;
      if (
        work.status === "CLAIMED" &&
        work.expiresAt &&
        work.expiresAt.getTime() > now
      )
        return null;
      if (!["PENDING", "RETRY_REQUIRED", "CLAIMED"].includes(work.status))
        return null;
      work.status = "CLAIMED";
      work.revision++;
      work.attemptCount++;
      work.owner = input.owner;
      work.token = input.token;
      work.expiresAt = input.expiresAt;
      work.reasonCode = null;
      work.productionStartedAt = null;
      return { workId: "work_1", revision: work.revision } satisfies NeutralGenerationClaim;
    }),
    beginProduction: jest.fn(async (input) => {
      if (
        !authoritative ||
        work.status !== "CLAIMED" ||
        work.owner !== input.owner ||
        work.token !== input.token ||
        work.revision !== input.revision ||
        !work.expiresAt ||
        work.expiresAt.getTime() <= currentTime
      )
        return null;
      work.status = "PRODUCING";
      work.revision++;
      work.productionStartedAt = new Date(currentTime);
      return {
        workId: "work_1",
        orderId: "ord_1",
        propertyPin: "14000000000000",
        revision: work.revision,
      };
    }),
    transition: jest.fn(async (input) => {
      if (
        work.status !== "PRODUCING" ||
        work.owner !== input.owner ||
        work.token !== input.token ||
        work.revision !== input.revision
      )
        return false;
      work.status = input.status;
      work.revision++;
      work.owner = null;
      work.token = null;
      work.expiresAt = null;
      work.reasonCode = input.reasonCode;
      return true;
    }),
    candidates: jest.fn(async () => {
      if (
        work.status === "PRODUCING" &&
        work.expiresAt &&
        work.expiresAt.getTime() <= currentTime
      ) {
        work.status = "RECONCILIATION_REQUIRED";
        work.revision++;
        work.owner = null;
        work.token = null;
        work.expiresAt = null;
        work.reasonCode = "PRODUCTION_OUTCOME_UNKNOWN";
        return [];
      }
      if (
        ["PENDING", "RETRY_REQUIRED"].includes(work.status) ||
        (work.status === "CLAIMED" &&
          work.expiresAt &&
          work.expiresAt.getTime() <= currentTime)
      )
        return ["work_1"];
      return [];
    }),
  };
  return {
    store,
    work,
    revoke: () => {
      authoritative = false;
    },
    restore: () => {
      authoritative = true;
    },
    advance: (value: Date) => {
      currentTime = value.getTime();
    },
  };
}

const enabled = { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true" };
const instant = new Date("2026-09-21T12:00:00.000Z");

test("strict default-off refuses before store or producer calls", async () => {
  for (const value of [undefined, "", "1", "TRUE", "true ", "false"]) {
    const { store } = memoryStore();
    const produce = jest.fn();
    await expect(
      runNeutralReportGeneration(
        { workId: "work_1" },
        {
          env: { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: value },
          store,
          produce,
          now: () => instant,
        },
      ),
    ).resolves.toEqual({ outcome: "DISABLED" });
    expect(store.claim).not.toHaveBeenCalled();
    expect(produce).not.toHaveBeenCalled();
  }
});

test("two concurrent workers acquire one lease and make one producer call", async () => {
  const { store } = memoryStore();
  let release!: () => void;
  const produce = jest.fn(
    () =>
      new Promise<{ ok: true; receipt: object }>((resolve) => {
        release = () => resolve({ ok: true, receipt: {} });
      }),
  );
  const deps = { env: enabled, store, produce, now: () => instant };
  const first = runNeutralReportGeneration({ workId: "work_1" }, deps);
  await Promise.resolve();
  const second = runNeutralReportGeneration({ workId: "work_1" }, deps);
  await expect(second).resolves.toEqual({ outcome: "NOT_CLAIMED" });
  release();
  await expect(first).resolves.toEqual({ outcome: "COMPLETE" });
  expect(produce).toHaveBeenCalledTimes(1);
});

test("an expired lease cannot start a second producer while the first producer is still running", async () => {
  const fixture = memoryStore();
  const { store } = fixture;
  let effectiveNow = instant;
  let releaseFirst!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const produce = jest.fn(
    () =>
      new Promise<{ ok: true; receipt: object }>((resolve) => {
        if (!releaseFirst) {
          releaseFirst = () => resolve({ ok: true, receipt: {} });
          markStarted();
        } else resolve({ ok: true, receipt: {} });
      }),
  );
  const deps = {
    env: enabled,
    store,
    produce,
    now: () => effectiveNow,
    identity: jest
      .fn()
      .mockReturnValueOnce("worker-a")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("worker-b")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222"),
  };

  const original = runNeutralReportGeneration({ workId: "work_1" }, deps);
  await started;
  effectiveNow = new Date(instant.getTime() + NEUTRAL_GENERATION_LEASE_MS + 1);
  fixture.advance(effectiveNow);
  await expect(store.candidates({ limit: 10 })).resolves.toEqual([]);

  await expect(
    runNeutralReportGeneration({ workId: "work_1" }, deps),
  ).resolves.toEqual({ outcome: "NOT_CLAIMED" });
  expect(produce).toHaveBeenCalledTimes(1);

  releaseFirst();
  await expect(original).resolves.toEqual({ outcome: "LEASE_LOST" });
});

test("lease exceeds the serverless budget and authority is revalidated atomically when production begins", async () => {
  expect(NEUTRAL_GENERATION_LEASE_MS).toBeGreaterThan(5 * 60 * 1000);
  const fixture = memoryStore();
  const produce = jest.fn();
  fixture.revoke();
  await expect(
    runNeutralReportGeneration(
      { workId: "work_1" },
      { env: enabled, store: fixture.store, produce, now: () => instant },
    ),
  ).resolves.toEqual({ outcome: "NOT_CLAIMED" });
  expect(produce).not.toHaveBeenCalled();

  fixture.restore();
  (fixture.store.beginProduction as jest.Mock).mockResolvedValueOnce(null);
  await expect(
    runNeutralReportGeneration(
      { workId: "work_1" },
      { env: enabled, store: fixture.store, produce, now: () => instant },
    ),
  ).resolves.toEqual({ outcome: "LEASE_LOST" });
  expect(produce).not.toHaveBeenCalled();
});

test("success and verified replay complete; transient and ambiguous outcomes use fixed states/codes", async () => {
  const cases = [
    [{ ok: true, receipt: {} }, "COMPLETE", null],
    [
      { ok: false, blocker: "NEUTRAL_DEADLINE_UNAVAILABLE" },
      "RETRY_REQUIRED",
      "SOURCE_UNAVAILABLE",
    ],
    [
      { ok: false, blocker: "NEUTRAL_STAGE_UNKNOWN" },
      "RECONCILIATION_REQUIRED",
      "STAGE_OUTCOME_AMBIGUOUS",
    ],
    [
      { ok: false, blocker: "NEUTRAL_PROMOTE_UNKNOWN" },
      "RECONCILIATION_REQUIRED",
      "PROMOTE_OUTCOME_AMBIGUOUS",
    ],
    [
      { ok: false, blocker: "ORDER_PROPERTY_MISMATCH" },
      "FAILED",
      "AUTHORITY_OR_INPUT_REFUSED",
    ],
  ] as const;
  for (const [result, status, reasonCode] of cases) {
    const fixture = memoryStore();
    const outcome = await runNeutralReportGeneration(
      { workId: "work_1" },
      {
        env: enabled,
        store: fixture.store,
        produce: jest.fn(async () => result),
        now: () => instant,
      },
    );
    expect(outcome.outcome).toBe(status);
    expect(fixture.work).toMatchObject({ status, reasonCode });
  }
});

test("raw exceptions are not inspected and become a fixed ambiguous-outcome hold", async () => {
  const fixture = memoryStore();
  const raw = {
    toString: jest.fn(() => {
      throw new Error("must not inspect");
    }),
  };
  await expect(
    runNeutralReportGeneration(
      { workId: "work_1" },
      {
        env: enabled,
        store: fixture.store,
        produce: jest.fn(async () => {
          throw raw;
        }),
        now: () => instant,
      },
    ),
  ).resolves.toEqual({ outcome: "RECONCILIATION_REQUIRED" });
  expect(raw.toString).not.toHaveBeenCalled();
  expect(fixture.work.reasonCode).toBe("PRODUCTION_OUTCOME_UNKNOWN");
});

test("stale owner/token cannot finalize or release a successor claim; expired is reclaimable and active is not", async () => {
  const fixture = memoryStore();
  const first = await fixture.store.claim({
    workId: "work_1",
    owner: "owner_a",
    token: "token_a",
    now: instant.toISOString(),
    expiresAt: new Date(instant.getTime() + 1000),
  });
  expect(first).not.toBeNull();
  expect(
    await fixture.store.claim({
      workId: "work_1",
      owner: "owner_b",
      token: "token_b",
      now: new Date(instant.getTime() + 500).toISOString(),
      expiresAt: new Date(instant.getTime() + 2000),
    }),
  ).toBeNull();
  const successor = await fixture.store.claim({
    workId: "work_1",
    owner: "owner_b",
    token: "token_b",
    now: new Date(instant.getTime() + 1001).toISOString(),
    expiresAt: new Date(instant.getTime() + 3000),
  });
  expect(successor).not.toBeNull();
  const production = await fixture.store.beginProduction({
    workId: "work_1",
    owner: "owner_b",
    token: "token_b",
    revision: successor!.revision,
  });
  expect(production?.revision).toBe(successor!.revision + 1);
  await expect(
    fixture.store.transition({
      workId: "work_1",
      owner: "owner_a",
      token: "token_a",
      revision: first!.revision,
      status: "COMPLETE",
      reasonCode: null,
    }),
  ).resolves.toBe(false);
  expect(fixture.work).toMatchObject({
    status: "PRODUCING",
    owner: "owner_b",
    token: "token_b",
  });
  await expect(
    fixture.store.transition({
      workId: "work_1",
      owner: "owner_b",
      token: "token_b",
      revision: successor!.revision,
      status: "COMPLETE",
      reasonCode: null,
    }),
  ).resolves.toBe(false);
  await expect(
    fixture.store.transition({
      workId: "work_1",
      owner: "owner_b",
      token: "token_b",
      revision: production!.revision,
      status: "COMPLETE",
      reasonCode: null,
    }),
  ).resolves.toBe(true);
});
