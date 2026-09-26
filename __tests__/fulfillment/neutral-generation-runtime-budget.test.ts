/** @jest-environment node */
/**
 * P1-D: neither new code path declared a route duration, so both ran at an
 * unknown platform default while the source gateway alone may consume 120
 * seconds and the recovery sweep ran up to ten complete productions
 * sequentially. A function killed mid-production leaves its row `PRODUCING`
 * with a live lease; when that lease expires the sweep force-moves it to
 * terminal `RECONCILIATION_REQUIRED`, which no code path retries.
 *
 * These tests pin the deterministic, plan-independent decision: an explicit
 * route duration on both paths, and an admission gate that refuses to *start*
 * a production attempt without enough wall budget left to finish it. A row
 * that never enters `PRODUCING` can never be force-reconciled.
 *
 * The semantics of an already-expired `PRODUCING` lease are deliberately
 * untouched: an unknown outcome still requires reconciliation and is never
 * converted into a blind retry.
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
  NEUTRAL_GENERATION_ITEM_RESERVE_MS,
  NEUTRAL_GENERATION_MAX_DURATION_SECONDS,
  runNeutralReportGeneration,
  type NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";
import { sweepNeutralReportGeneration } from "@/lib/fulfillment-runtime/neutral-generation-recovery";

const enabled = { OT_NEUTRAL_REPORT_PRODUCTION_ENABLED: "true" } as const;
const recovering = {
  ...enabled,
  OT_NEUTRAL_REPORT_RECOVERY_ENABLED: "true",
} as const;

const ROUTES = [
  "app/api/billing/webhook/route.ts",
  "app/api/cron/neutral-report-production/route.ts",
] as const;

describe("declared route duration", () => {
  test.each(ROUTES)(
    "%s declares maxDuration as a static literal matching the shared constant",
    (route) => {
      const source = fs.readFileSync(path.join(process.cwd(), route), "utf8");
      // Next.js route segment config must be statically analysable, so the
      // value has to be a literal in the route file rather than an import.
      const declared = source.match(/export const maxDuration = (\d+)/);
      expect(declared?.[1]).toBe(String(NEUTRAL_GENERATION_MAX_DURATION_SECONDS));
    },
  );

  test("the invocation budget leaves headroom under the declared duration", () => {
    expect(NEUTRAL_GENERATION_INVOCATION_BUDGET_MS).toBeLessThan(
      NEUTRAL_GENERATION_MAX_DURATION_SECONDS * 1000,
    );
    expect(NEUTRAL_GENERATION_ITEM_RESERVE_MS).toBeLessThan(
      NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
    );
  });
});

describe("worker admission gate", () => {
  const store = () =>
    ({
      claim: jest.fn(),
      beginProduction: jest.fn(),
      transition: jest.fn(),
      candidates: jest.fn(),
      ensure: jest.fn(),
    }) as unknown as NeutralGenerationStore & {
      claim: jest.Mock;
      beginProduction: jest.Mock;
    };

  test("refuses to start work when less than the item reserve remains, without touching the row", async () => {
    const fake = store();
    const now = new Date("2026-09-22T00:00:00.000Z");
    await expect(
      runNeutralReportGeneration(
        { workId: "w1" },
        {
          env: enabled,
          store: fake,
          now: () => now,
          deadline: now.getTime() + NEUTRAL_GENERATION_ITEM_RESERVE_MS - 1,
        },
      ),
    ).resolves.toEqual({ outcome: "DEFERRED" });
    // Nothing was claimed, so the row is still PENDING/RETRY_REQUIRED and the
    // next sweep can pick it up. It never reaches PRODUCING.
    expect(fake.claim).not.toHaveBeenCalled();
    expect(fake.beginProduction).not.toHaveBeenCalled();
  });

  test("starts work when the reserve is satisfied", async () => {
    const fake = store();
    fake.claim.mockResolvedValue(null);
    const now = new Date("2026-09-22T00:00:00.000Z");
    await expect(
      runNeutralReportGeneration(
        { workId: "w1" },
        {
          env: enabled,
          store: fake,
          now: () => now,
          deadline: now.getTime() + NEUTRAL_GENERATION_ITEM_RESERVE_MS,
        },
      ),
    ).resolves.toEqual({ outcome: "NOT_CLAIMED" });
    expect(fake.claim).toHaveBeenCalledTimes(1);
  });

  test("an absent deadline preserves the pre-existing unbounded behaviour", async () => {
    const fake = store();
    fake.claim.mockResolvedValue(null);
    await expect(
      runNeutralReportGeneration({ workId: "w1" }, { env: enabled, store: fake }),
    ).resolves.toEqual({ outcome: "NOT_CLAIMED" });
    expect(fake.claim).toHaveBeenCalledTimes(1);
  });
});

describe("recovery sweep is wall-clock bounded", () => {
  test("stops starting items once the invocation budget is spent", async () => {
    const ids = Array.from({ length: 10 }, (_unused, index) => `w${index + 1}`);
    const candidates = jest.fn(async ({ limit }: { limit: number }) => {
      // The candidate query keeps its full limit: its reconciliation of
      // expired PRODUCING rows must still run for every row it selects.
      expect(limit).toBe(10);
      return ids;
    });
    let clock = 0;
    const run = jest.fn(async () => {
      clock += NEUTRAL_GENERATION_ITEM_RESERVE_MS;
      return { outcome: "COMPLETE" as const };
    });
    await expect(
      sweepNeutralReportGeneration({
        env: recovering,
        store: { candidates } as never,
        run: run as never,
        now: () => clock,
      }),
    ).resolves.toEqual({ reviewed: 10, completed: 2, failed: 0, deferred: 8 });
    expect(run.mock.calls).toHaveLength(2);
  });

  test("passes its deadline down so each item inherits the same budget", async () => {
    const candidates = jest.fn(async () => ["w1"]);
    const run = jest.fn(
      async (
        _input: { workId: string },
        _deps?: { deadline?: number },
      ) => ({ outcome: "COMPLETE" as const }),
    );
    await sweepNeutralReportGeneration({
      env: recovering,
      store: { candidates } as never,
      run: run as never,
      now: () => 1_000,
    });
    expect(run.mock.calls[0]![1]).toMatchObject({
      deadline: 1_000 + NEUTRAL_GENERATION_INVOCATION_BUDGET_MS,
    });
  });
});
