/** @jest-environment node */
/**
 * The leased T2 artifact orchestrator: the only runtime caller of the reviewed
 * binding workflow. It is inert unless its own strict flag is true, it invokes
 * the workflow only after an atomic claim on the exact ARTIFACT_PENDING row, and
 * it releases the lease by owner-and-token compare-and-set whatever happens.
 */
import { Prisma } from "@prisma/client";
import {
  runT2ArtifactOrchestration,
  T2_ARTIFACT_LEASE_MS,
  type T2ArtifactOrchestrationDeps,
} from "@/lib/fulfillment-runtime/t2-artifact-orchestrator";
import {
  createPrismaT2ArtifactOrchestrationStore,
  type T2ArtifactLeaseClaim,
  type T2ArtifactLeaseRelease,
  type T2ArtifactOrchestrationClient,
  type T2ArtifactOrchestrationTransaction,
} from "@/lib/fulfillment-runtime/orchestration-store";
import type { T2ArtifactWorkflowResult } from "@/lib/fulfillment-runtime/t2-artifact-workflow";

jest.mock("server-only", () => ({}));

type WorkflowOutcome = T2ArtifactWorkflowResult["outcome"];
type RunInput = { orderId: string; fulfillmentId: string };

const ON = { OT_T2_ARTIFACT_ORCHESTRATION_ENABLED: "true" };
const IDS: RunInput = { orderId: "ord_1", fulfillmentId: "ful_1" };
const NOW = new Date("2026-06-08T12:00:00.000Z");

function fakeStore(claimed = true, released = true) {
  return {
    claim: jest.fn(async (_input: T2ArtifactLeaseClaim) => claimed),
    release: jest.fn(async (_input: T2ArtifactLeaseRelease) => released),
  };
}

/** A workflow stub whose return type is the real bounded outcome union. */
function fakeRun(outcome: WorkflowOutcome) {
  return jest.fn(async (_input: RunInput) => ({ outcome }));
}

type OrderFixture = { id: string; status: string; tier: string } | null;
type FulfillmentFixture = Record<string, unknown> | null;
type Fixture = { order: OrderFixture; fulfillment: FulfillmentFixture };

/** A fulfillment row as the store reads it, plus the order it hangs off. */
function rows(over: Record<string, unknown> = {}): Fixture {
  return {
    order: { id: "ord_1", status: "PAID", tier: "T2" },
    fulfillment: {
      id: "ful_1",
      order_id: "ord_1",
      kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_PENDING",
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      ...over,
    },
  };
}

/** The assignment list of an UPDATE, whitespace-collapsed. */
function setClause(sql: string): string {
  return (/SET([^]*?)WHERE/.exec(sql)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function fakePrisma(state: Fixture, updated = 1) {
  const executeRaw = jest.fn(async (_query: Prisma.Sql) => updated);
  const queue: unknown[][] = [
    state.order ? [state.order] : [],
    state.fulfillment ? [state.fulfillment] : [],
  ];
  const queryRaw = jest.fn(async (_query: Prisma.Sql) => queue.shift() ?? []);
  let transactions = 0;
  const tx: T2ArtifactOrchestrationTransaction = {
    // `$queryRaw` is generic over the row type and a stub cannot express that
    // generic; this single property is the only cast in the file.
    $queryRaw:
      queryRaw as unknown as T2ArtifactOrchestrationTransaction["$queryRaw"],
    $executeRaw: executeRaw,
  };
  const client: T2ArtifactOrchestrationClient = {
    $transaction: <T>(
      work: (t: T2ArtifactOrchestrationTransaction) => Promise<T>,
    ) => {
      transactions += 1;
      return work(tx);
    },
    $executeRaw: executeRaw,
  };
  return { client, executeRaw, queryRaw, transactions: () => transactions };
}

describe("the orchestration flag is the only switch", () => {
  it.each([undefined, "", "  ", "false", "TRUE", "True", "1", "yes", "true "])(
    "%s is a hard no-op: no store call, no workflow call",
    async (flag) => {
      const store = fakeStore();
      const run = fakeRun("BOUND");
      const env: T2ArtifactOrchestrationDeps["env"] =
        flag === undefined
          ? {}
          : { OT_T2_ARTIFACT_ORCHESTRATION_ENABLED: flag };
      await expect(
        runT2ArtifactOrchestration(IDS, { env, store, run }),
      ).resolves.toEqual({ outcome: "DISABLED" });
      expect(store.claim).not.toHaveBeenCalled();
      expect(store.release).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );
});

describe("the workflow runs only behind a successful claim", () => {
  it("claims with a bounded opaque owner/token and a fixed five-minute lease", async () => {
    const store = fakeStore();
    const run = fakeRun("BOUND");
    await runT2ArtifactOrchestration(IDS, {
      env: ON,
      store,
      run,
      now: () => NOW,
    });
    const claim = store.claim.mock.calls[0][0];
    expect(claim.orderId).toBe("ord_1");
    expect(claim.fulfillmentId).toBe("ful_1");
    expect(claim.owner).toMatch(/^ot-t2-orchestrator:[0-9a-f-]{36}$/);
    expect(claim.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim.now).toBe("2026-06-08T12:00:00.000Z");
    expect(claim.expiresAt.getTime() - NOW.getTime()).toBe(
      T2_ARTIFACT_LEASE_MS,
    );
    expect(T2_ARTIFACT_LEASE_MS).toBe(300000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(IDS);
  });

  it("a refused claim never invokes the workflow and never releases", async () => {
    const store = fakeStore(false);
    const run = fakeRun("BOUND");
    await expect(
      runT2ArtifactOrchestration(IDS, { env: ON, store, run }),
    ).resolves.toEqual({ outcome: "NOT_CLAIMED" });
    expect(run).not.toHaveBeenCalled();
    expect(store.release).not.toHaveBeenCalled();
  });

  it("attempts the workflow exactly once per claim — no inline retry", async () => {
    const store = fakeStore();
    const run = fakeRun("REFUSED");
    await runT2ArtifactOrchestration(IDS, { env: ON, store, run });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("the lease is released by owner-and-token compare-and-set", () => {
  const OUTCOMES: WorkflowOutcome[] = [
    "BOUND",
    "DISABLED",
    "UNAVAILABLE",
    "REFUSED",
    "RECONCILIATION_REQUIRED",
  ];

  it.each(OUTCOMES)("releases after a %s workflow outcome", async (outcome) => {
    const store = fakeStore();
    const run = fakeRun(outcome);
    await expect(
      runT2ArtifactOrchestration(IDS, { env: ON, store, run }),
    ).resolves.toEqual({
      outcome: "RAN",
      workflowOutcome: outcome,
      released: true,
    });
    expect(store.release.mock.calls[0][0]).toEqual({
      fulfillmentId: "ful_1",
      owner: store.claim.mock.calls[0][0].owner,
      token: store.claim.mock.calls[0][0].token,
    });
  });

  it("releases after a thrown workflow and never surfaces the error", async () => {
    const store = fakeStore();
    const run = jest.fn(
      async (_input: RunInput): Promise<{ outcome: WorkflowOutcome }> => {
        throw new Error("pin 09000000000000 at 1 REAL ST leaked");
      },
    );
    const result = await runT2ArtifactOrchestration(IDS, {
      env: ON,
      store,
      run,
    });
    expect(result).toEqual({ outcome: "THREW", released: true });
    expect(JSON.stringify(result)).not.toMatch(/REAL ST|09000000000000|leaked/);
    expect(store.release).toHaveBeenCalledTimes(1);
  });

  it("reports a failed or missed release without throwing", async () => {
    const run = fakeRun("BOUND");
    await expect(
      runT2ArtifactOrchestration(IDS, {
        env: ON,
        store: fakeStore(true, false),
        run,
      }),
    ).resolves.toMatchObject({ released: false });
    const throwing = {
      claim: jest.fn(async (_input: T2ArtifactLeaseClaim) => true),
      release: jest.fn(
        async (_input: T2ArtifactLeaseRelease): Promise<boolean> => {
          throw new Error("release unavailable");
        },
      ),
    };
    await expect(
      runT2ArtifactOrchestration(IDS, { env: ON, store: throwing, run }),
    ).resolves.toMatchObject({ outcome: "RAN", released: false });
  });
});

describe("the atomic claim refuses every ineligible row", () => {
  const claimWith = async (state: Fixture, updated = 1) => {
    const fake = fakePrisma(state, updated);
    const store = createPrismaT2ArtifactOrchestrationStore(fake.client);
    const ok = await store.claim({
      ...IDS,
      owner: "owner-a",
      token: "token-a",
      now: "2026-06-08T12:00:00.000Z",
      expiresAt: new Date("2026-06-08T12:05:00.000Z"),
    });
    return { ok, ...fake };
  };

  it("claims a null lease inside one transaction and writes only the lease columns", async () => {
    const { ok, executeRaw, transactions } = await claimWith(rows());
    expect(ok).toBe(true);
    expect(transactions()).toBe(1);
    const text = executeRaw.mock.calls[0][0].strings.join("?");
    expect(text).toContain("UPDATE");
    // The write stays conditional on the pending status ...
    expect(text).toMatch(/WHERE[^]*ARTIFACT_PENDING/);
    // ... but assigns only the three lease columns; status is never SET.
    expect(setClause(text)).toBe(
      '"lease_owner" = ?, "lease_token" = ?, "lease_expires_at" = ?',
    );
  });

  it("locks the order row before the fulfillment row, matching the binder", async () => {
    const { queryRaw } = await claimWith(rows());
    const statements = queryRaw.mock.calls.map((call) =>
      call[0].strings.join("?").replace(/\s+/g, " "),
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('FROM "ot_order"');
    expect(statements[0]).toContain("FOR UPDATE");
    expect(statements[1]).toContain('FROM "ot_fulfillment"');
    expect(statements[1]).toContain("FOR UPDATE");
  });

  it("reclaims a fully valid expired lease", async () => {
    const { ok } = await claimWith(
      rows({
        lease_owner: "old",
        lease_token: "tok",
        lease_expires_at: new Date("2026-06-08T11:59:59.000Z"),
      }),
    );
    expect(ok).toBe(true);
  });

  it.each([
    [
      "an active foreign lease",
      {
        lease_owner: "other",
        lease_token: "tok",
        lease_expires_at: new Date("2026-06-08T12:04:00.000Z"),
      },
    ],
    [
      "an active same-owner lease whose token we do not hold",
      {
        lease_owner: "owner-a",
        lease_token: "someone-elses",
        lease_expires_at: new Date("2026-06-08T12:04:00.000Z"),
      },
    ],
    [
      "partial lease metadata (owner only)",
      { lease_owner: "old", lease_token: null, lease_expires_at: null },
    ],
    [
      "partial lease metadata (expiry only)",
      {
        lease_owner: null,
        lease_token: null,
        lease_expires_at: new Date("2026-06-08T11:00:00.000Z"),
      },
    ],
    [
      "a malformed expiry",
      {
        lease_owner: "old",
        lease_token: "tok",
        lease_expires_at: "not-a-date",
      },
    ],
    [
      "a blank lease owner",
      {
        lease_owner: "",
        lease_token: "tok",
        lease_expires_at: new Date("2026-06-08T11:00:00.000Z"),
      },
    ],
    ["a mismatched order", { order_id: "ord_other" }],
    ["the wrong fulfillment kind", { kind: "T2_DELIVERY" }],
    ["a non-pending status", { status: "ARTIFACT_READY" }],
    ["a terminal status", { status: "CANCELLED" }],
  ])("refuses %s", async (_label, over) => {
    const { ok, executeRaw } = await claimWith(rows(over));
    expect(ok).toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<Fixture>]>([
    ["a missing fulfillment row", { fulfillment: null }],
    ["a missing order row", { order: null }],
    [
      "a non-PAID order",
      { order: { id: "ord_1", status: "PENDING", tier: "T2" } },
    ],
    [
      "a refund-reverted order",
      { order: { id: "ord_1", status: "REFUNDED", tier: "T2" } },
    ],
    ["a non-T2 order", { order: { id: "ord_1", status: "PAID", tier: "T3" } }],
  ])("refuses %s", async (_label, over) => {
    const { ok, executeRaw } = await claimWith({ ...rows(), ...over });
    expect(ok).toBe(false);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("loses the claim when the conditional update matches no row", async () => {
    const { ok } = await claimWith(rows(), 0);
    expect(ok).toBe(false);
  });

  it("two concurrent claims on the same row yield exactly one workflow call", async () => {
    // One shared row; the first claim to commit takes the lease, and the second
    // sees it as active and is refused. Both orchestrations are started together.
    let leased: { expiresAt: Date } | null = null;
    const store = {
      claim: jest.fn(async (input: T2ArtifactLeaseClaim) => {
        if (leased && leased.expiresAt.getTime() > NOW.getTime()) return false;
        leased = { expiresAt: input.expiresAt };
        return true;
      }),
      release: jest.fn(async (_input: T2ArtifactLeaseRelease) => true),
    };
    const run = fakeRun("BOUND");
    const results = await Promise.all([
      runT2ArtifactOrchestration(IDS, { env: ON, store, run, now: () => NOW }),
      runT2ArtifactOrchestration(IDS, { env: ON, store, run, now: () => NOW }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "NOT_CLAIMED",
      "RAN",
    ]);
  });

  it("releases only on an exact owner-and-token match", async () => {
    const { client, executeRaw } = fakePrisma(rows());
    const store = createPrismaT2ArtifactOrchestrationStore(client);
    await expect(
      store.release({
        fulfillmentId: "ful_1",
        owner: "owner-a",
        token: "token-a",
      }),
    ).resolves.toBe(true);
    const sql = executeRaw.mock.calls[0][0];
    const text = sql.strings.join("?");
    expect(setClause(text)).toBe(
      '"lease_owner" = NULL, "lease_token" = NULL, "lease_expires_at" = NULL',
    );
    expect(text).toMatch(/WHERE[^]*"lease_owner"[^]*"lease_token"/);
    expect(sql.values).toEqual(["ful_1", "owner-a", "token-a"]);
  });
});
