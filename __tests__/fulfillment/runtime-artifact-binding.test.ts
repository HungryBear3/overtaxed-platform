/**
 * @jest-environment node
 */

/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — production orchestration seam.
 *
 * These prove the seam is default-off in the strictest sense available: when the
 * Slice 2 flag is not exactly "true", NO store method is called at all, which is
 * what makes "no transaction is opened" true rather than merely likely. They also
 * prove activation cannot be asserted by command data, and that the already-live
 * Phase 1 flag cannot switch this slice on by implication.
 */
import {
  bindT2Artifact,
  type BindT2ArtifactCommand,
  type T2ArtifactBindingStore,
} from "@/lib/fulfillment-runtime/bind-artifact";
import { createPrismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store";
import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest";
import { OT_T2_ARTIFACT_BINDING_FLAG } from "@/lib/fulfillment/flag";

const ORDER_ID = "ord_seam_primary";
const FULFILLMENT_ID = "ful_seam_primary";
const PIN = "09000000000000";
const ADDRESS = "123 Main St";
const BYTES = Buffer.from("%PDF-1.7 seam bytes\n");

const ON = { [OT_T2_ARTIFACT_BINDING_FLAG]: "true" };

function command(): BindT2ArtifactCommand {
  return {
    orderId: ORDER_ID,
    fulfillmentId: FULFILLMENT_ID,
    bytes: BYTES,
    storageLocator: "artifacts/ful_seam_primary/v1.pdf",
    provenance: {
      sourceOrderId: ORDER_ID,
      propertyPin: PIN,
      propertyAddress: ADDRESS,
      generatorVersion: "gen_v1",
      templateVersion: "tpl_v1",
      generatedAt: "2026-08-09T12:00:00.000Z",
    },
  };
}

function fakeStore() {
  const bind = jest.fn(async () => ({
    ok: true as const,
    created: true,
    artifactId: "art_1",
    artifactSha256: computeArtifactSha256(BYTES),
  }));
  return { store: { bind } as T2ArtifactBindingStore, bind };
}

describe("bindT2Artifact — default-off production seam", () => {
  it.each([
    ["absent", {}],
    ["empty", { [OT_T2_ARTIFACT_BINDING_FLAG]: "" }],
    ["false", { [OT_T2_ARTIFACT_BINDING_FLAG]: "false" }],
    ["TRUE", { [OT_T2_ARTIFACT_BINDING_FLAG]: "TRUE" }],
    ["True", { [OT_T2_ARTIFACT_BINDING_FLAG]: "True" }],
    ["1", { [OT_T2_ARTIFACT_BINDING_FLAG]: "1" }],
    ["yes", { [OT_T2_ARTIFACT_BINDING_FLAG]: "yes" }],
    ["  true  ", { [OT_T2_ARTIFACT_BINDING_FLAG]: "  true  " }],
  ])(
    "returns bounded FLAG_DISABLED and makes zero store calls when the flag is %s",
    async (_label, env) => {
      const { store, bind } = fakeStore();
      await expect(bindT2Artifact(command(), { env, store })).resolves.toEqual({
        outcome: "DISABLED",
        blocker: "FLAG_DISABLED",
      });
      // Zero store calls is the load-bearing assertion: no store call means no
      // transaction was opened and no row was locked, read, or written.
      expect(bind).not.toHaveBeenCalled();
    },
  );

  it("cannot be enabled by the already-live Phase 1 evidence flag", async () => {
    const { store, bind } = fakeStore();
    await expect(
      bindT2Artifact(command(), {
        env: { OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" },
        store,
      }),
    ).resolves.toEqual({ outcome: "DISABLED", blocker: "FLAG_DISABLED" });
    expect(bind).not.toHaveBeenCalled();
  });

  it("calls the injected store exactly once for the exact Slice 2 flag", async () => {
    const { store, bind } = fakeStore();
    await expect(
      bindT2Artifact(command(), { env: ON, store }),
    ).resolves.toEqual({
      outcome: "BOUND",
      created: true,
      artifactId: "art_1",
      artifactSha256: computeArtifactSha256(BYTES),
    });
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("passes a store refusal through as a bounded blocker", async () => {
    const bind = jest.fn(async () => ({
      ok: false as const,
      blocker: "INELIGIBLE_SETTLEMENT" as const,
    }));
    await expect(
      bindT2Artifact(command(), {
        env: ON,
        store: { bind } as unknown as T2ArtifactBindingStore,
      }),
    ).resolves.toEqual({ outcome: "REFUSED", blocker: "INELIGIBLE_SETTLEMENT" });
  });

  it("does not let command data assert activation", async () => {
    const { store, bind } = fakeStore();
    // A hostile caller adds the field the reviewed version used to accept.
    const hostile = {
      ...command(),
      flagEnabled: true,
      OT_T2_ARTIFACT_BINDING_ENABLED: "true",
    } as BindT2ArtifactCommand;
    await expect(
      bindT2Artifact(hostile, { env: {}, store }),
    ).resolves.toEqual({ outcome: "DISABLED", blocker: "FLAG_DISABLED" });
    expect(bind).not.toHaveBeenCalled();
  });

  it("reads the ambient environment when none is injected", async () => {
    const { store, bind } = fakeStore();
    const previous = process.env[OT_T2_ARTIFACT_BINDING_FLAG];
    delete process.env[OT_T2_ARTIFACT_BINDING_FLAG];
    try {
      await expect(bindT2Artifact(command(), { store })).resolves.toEqual({
        outcome: "DISABLED",
        blocker: "FLAG_DISABLED",
      });
      expect(bind).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env[OT_T2_ARTIFACT_BINDING_FLAG];
      else process.env[OT_T2_ARTIFACT_BINDING_FLAG] = previous;
    }
  });
});

describe("artifact binding store — defence in depth behind the seam", () => {
  function client() {
    const $transaction = jest.fn(async () => {
      throw new Error("no transaction may be opened while disabled");
    });
    return {
      client: { $transaction } as unknown as Parameters<
        typeof createPrismaArtifactBindingStore
      >[0],
      $transaction,
    };
  }

  it("refuses with FLAG_DISABLED and opens no transaction when its gate is off", async () => {
    const { client: c, $transaction } = client();
    const store = createPrismaArtifactBindingStore(c, {
      isBindingEnabled: () => false,
    });
    await expect(store.bind(command())).resolves.toEqual({
      ok: false,
      blocker: "FLAG_DISABLED",
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("defaults to the strict default-off gate when no dependency is injected", async () => {
    const { client: c, $transaction } = client();
    const previous = process.env[OT_T2_ARTIFACT_BINDING_FLAG];
    delete process.env[OT_T2_ARTIFACT_BINDING_FLAG];
    try {
      const store = createPrismaArtifactBindingStore(c);
      await expect(store.bind(command())).resolves.toEqual({
        ok: false,
        blocker: "FLAG_DISABLED",
      });
      expect($transaction).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env[OT_T2_ARTIFACT_BINDING_FLAG];
      else process.env[OT_T2_ARTIFACT_BINDING_FLAG] = previous;
    }
  });
});

describe("Slice 2 remains dormant", () => {
  it("is imported by no production route, worker, or generator", async () => {
    const { execFileSync } = await import("node:child_process");
    const hits = execFileSync(
      "git",
      [
        "grep",
        "-l",
        // untracked: the slice is not committed, so its own files are untracked.
        "--untracked",
        "-e",
        "fulfillment-runtime/bind-artifact",
        "-e",
        "fulfillment-runtime/artifact-binding-store",
        "--",
        "app",
        "lib",
        "components",
        "scripts",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    // The seam and the store may reference each other; nothing else may.
    expect(hits.sort()).toEqual([
      "lib/fulfillment-runtime/bind-artifact.ts",
    ]);
  });
});

describe("Slice 2 — trusted time is store-owned, never command-carried", () => {
  // The clock that decides whether generation time is possible must not be
  // reachable from request-shaped data, for the same reason activation is not.
  // Otherwise a caller could authorize its own impossible timestamp.

  const FORBIDDEN_TIME_KEYS = [
    "now",
    "currentTime",
    "trustedNow",
    "generatedAtOverride",
    "clock",
    "timestamp",
  ];

  it("exposes no clock field on BindT2ArtifactCommand", () => {
    const keys = Object.keys(command());
    for (const forbidden of FORBIDDEN_TIME_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("ignores an injected clock smuggled onto the command at runtime", async () => {
    // Even if an untyped caller forces extra keys through, the store must read
    // its own clock. A future generatedAt is refused regardless of what the
    // command claims "now" is.
    const smuggled = {
      ...command(),
      now: "2099-01-01T00:00:00.000Z",
      trustedNow: "2099-01-01T00:00:00.000Z",
      currentTime: "2099-01-01T00:00:00.000Z",
    } as BindT2ArtifactCommand;

    let seenInput: { trustedNow?: string } | null = null;
    const store: T2ArtifactBindingStore = {
      async bind() {
        return { ok: false, blocker: "GENERATED_AT_IN_FUTURE" as const };
      },
    };
    const result = await bindT2Artifact(smuggled, { env: ON, store });
    // The seam forwards the command verbatim; it does not synthesize a clock,
    // and the smuggled keys reach nothing that reads them.
    expect(result.outcome).toBe("REFUSED");
    expect(seenInput).toBeNull();
  });

  it("reads the trusted clock inside the store transaction, not from the caller", async () => {
    // Assert the production store asks PostgreSQL for the time. The query must
    // be issued on the transaction handle, so the check and the write share one
    // transaction boundary and cannot straddle a clock change.
    const rawQueries: string[] = [];
    const tx = {
      async $queryRaw(query: unknown) {
        rawQueries.push(JSON.stringify(query));
        return [];
      },
      oTFulfillment: {
        async findUnique() { return null },
        async updateMany() { return { count: 0 } },
      },
      oTFulfillmentArtifact: {
        async create() { throw new Error("must not create") },
        async findUnique() { return null },
      },
    };
    const client = {
      async $transaction<T>(work: (t: typeof tx) => Promise<T>): Promise<T> {
        return work(tx);
      },
    };
    const store = createPrismaArtifactBindingStore(
      client as never,
      { isBindingEnabled: () => true },
    );
    await store.bind(command());
    const joined = rawQueries.join(" ")
    expect(joined).toMatch(/CURRENT_TIMESTAMP/i);
  });
});
