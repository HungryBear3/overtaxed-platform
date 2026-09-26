import "server-only";

import { randomUUID } from "node:crypto";
import { produceNeutralReport } from "@/lib/fulfillment-runtime/neutral-report-producer";
import { prismaNeutralGenerationStore } from "@/lib/fulfillment-runtime/neutral-generation-store";

export const NEUTRAL_GENERATION_LEASE_MS = 15 * 60 * 1000;

/**
 * Declared route duration for both neutral generation code paths, in seconds.
 *
 * Neither path declared one, so both ran at an unknown platform default. This
 * value is the repository's own established ceiling — `app/api/cron/
 * informational-deadlines/route.ts` already runs at 60 — and is accepted on
 * every Vercel plan, so the budget below is derived from a known number rather
 * than a guessed one. Next.js route segment config must be statically
 * analysable, so each route repeats the literal; a test pins them together.
 */
export const NEUTRAL_GENERATION_MAX_DURATION_SECONDS = 60;

/**
 * Wall budget a single invocation may spend starting production work, leaving
 * headroom under the declared duration for the response, the lease round trips
 * and platform overhead.
 */
export const NEUTRAL_GENERATION_INVOCATION_BUDGET_MS = 45_000;

/**
 * Wall budget that must remain before a production attempt may be *started*.
 *
 * A row is only exposed to a platform timeout while it is `PRODUCING`: if the
 * function dies there, the lease expires unattended and the sweep force-moves
 * the row to terminal `RECONCILIATION_REQUIRED`, which nothing retries. A row
 * that is never claimed stays `PENDING`/`RETRY_REQUIRED` and the next sweep
 * picks it up, so refusing to start is strictly safer than starting and being
 * killed. This bounds the sweep's former ten-sequential-productions amplifier,
 * which was the routine way to run out of budget mid-production.
 */
export const NEUTRAL_GENERATION_ITEM_RESERVE_MS = 20_000;

export type NeutralGenerationStatus =
  | "PENDING"
  | "CLAIMED"
  | "PRODUCING"
  | "COMPLETE"
  | "RETRY_REQUIRED"
  | "RECONCILIATION_REQUIRED"
  | "FAILED";

export type NeutralGenerationReasonCode =
  | "SOURCE_UNAVAILABLE"
  | "RUNTIME_UNAVAILABLE"
  | "WORKER_EXCEPTION"
  | "STAGE_OUTCOME_AMBIGUOUS"
  | "PROMOTE_OUTCOME_AMBIGUOUS"
  | "WRITE_OR_VERIFY_AMBIGUOUS"
  | "PRODUCTION_OUTCOME_UNKNOWN"
  | "AUTHORITY_OR_INPUT_REFUSED";

export type NeutralGenerationClaim = {
  workId: string;
  revision: number;
};

export type NeutralGenerationProduction = NeutralGenerationClaim & {
  orderId: string;
  propertyPin: string;
};

export interface NeutralGenerationStore {
  ensure(orderId: string): Promise<{ workId: string } | null>;
  claim(input: {
    workId: string;
    owner: string;
    token: string;
    now: string;
    expiresAt: Date;
  }): Promise<NeutralGenerationClaim | null>;
  beginProduction(input: {
    workId: string;
    owner: string;
    token: string;
    revision: number;
  }): Promise<NeutralGenerationProduction | null>;
  transition(input: {
    workId: string;
    owner: string;
    token: string;
    revision: number;
    status: Exclude<NeutralGenerationStatus, "PENDING" | "CLAIMED" | "PRODUCING">;
    reasonCode: NeutralGenerationReasonCode | null;
  }): Promise<boolean>;
  candidates(input: { limit: number }): Promise<string[]>;
}

type ProducerResult =
  | { ok: true; receipt: unknown }
  | { ok: false; blocker: string };
type FinalState = {
  status: Exclude<NeutralGenerationStatus, "PENDING" | "CLAIMED" | "PRODUCING">;
  reasonCode: NeutralGenerationReasonCode | null;
};

const ambiguous: Readonly<Record<string, FinalState>> = {
  NEUTRAL_STAGE_UNKNOWN: {
    status: "RECONCILIATION_REQUIRED",
    reasonCode: "STAGE_OUTCOME_AMBIGUOUS",
  },
  NEUTRAL_PROMOTE_UNKNOWN: {
    status: "RECONCILIATION_REQUIRED",
    reasonCode: "PROMOTE_OUTCOME_AMBIGUOUS",
  },
  NEUTRAL_STAGE_VERIFY_FAILED: {
    status: "RECONCILIATION_REQUIRED",
    reasonCode: "WRITE_OR_VERIFY_AMBIGUOUS",
  },
};

const transient = new Set([
  "NEUTRAL_RAW_SOURCE_UNAVAILABLE",
  "NEUTRAL_DEADLINE_UNAVAILABLE",
  "NEUTRAL_REPOSITORY_UNAVAILABLE",
  "NEUTRAL_RESERVATION_UNKNOWN",
]);

function classify(result: ProducerResult): FinalState {
  if (result.ok) return { status: "COMPLETE", reasonCode: null };
  if (ambiguous[result.blocker]) return ambiguous[result.blocker]!;
  if (transient.has(result.blocker))
    return {
      status: "RETRY_REQUIRED",
      reasonCode:
        result.blocker.includes("SOURCE") || result.blocker.includes("DEADLINE")
          ? "SOURCE_UNAVAILABLE"
          : "RUNTIME_UNAVAILABLE",
    };
  return { status: "FAILED", reasonCode: "AUTHORITY_OR_INPUT_REFUSED" };
}

export type NeutralGenerationWorkerResult =
  | { outcome: "DISABLED" | "DEFERRED" | "NOT_CLAIMED" | "LEASE_LOST" }
  | {
      outcome:
        | "COMPLETE"
        | "RETRY_REQUIRED"
        | "RECONCILIATION_REQUIRED"
        | "FAILED";
    };

export async function runNeutralReportGeneration(
  input: { workId: string },
  deps: {
    env?: Readonly<Record<string, string | undefined>>;
    store?: NeutralGenerationStore;
    produce?: (input: {
      orderId: string;
      propertyPin?: string;
      deadline?: number;
    }) => Promise<ProducerResult>;
    now?: () => Date;
    identity?: () => string;
    /**
     * Epoch milliseconds after which this invocation may be killed by the
     * platform. When supplied, no work is claimed unless at least
     * `NEUTRAL_GENERATION_ITEM_RESERVE_MS` remains. Absent, behaviour is
     * unchanged.
     */
    deadline?: number;
  } = {},
): Promise<NeutralGenerationWorkerResult> {
  if ((deps.env ?? process.env).OT_NEUTRAL_REPORT_PRODUCTION_ENABLED !== "true")
    return { outcome: "DISABLED" };
  const store = deps.store ?? prismaNeutralGenerationStore;
  const now = deps.now?.() ?? new Date();
  // Admission gate. Checked before the claim so a deferral leaves the row
  // exactly as it was found — not claimed, never PRODUCING, still recoverable.
  if (
    typeof deps.deadline === "number" &&
    deps.deadline - now.getTime() < NEUTRAL_GENERATION_ITEM_RESERVE_MS
  )
    return { outcome: "DEFERRED" };
  const identity = deps.identity ?? randomUUID;
  const owner = `ot-neutral-generation:${identity()}`;
  const token = identity();
  const claim = await store.claim({
    workId: input.workId,
    owner,
    token,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + NEUTRAL_GENERATION_LEASE_MS),
  });
  if (!claim) return { outcome: "NOT_CLAIMED" };
  const fence = {
    workId: claim.workId,
    owner,
    token,
    revision: claim.revision,
  };

  // A claim can itself consume the remaining route budget. Recheck before the
  // irreversible PRODUCING transition. Leaving a short-lived CLAIMED lease is
  // safe: the recovery query can reclaim it after expiry, while no production
  // side effect has started and no outcome can become ambiguous.
  const afterClaim = deps.now?.() ?? new Date();
  if (
    typeof deps.deadline === "number" &&
    deps.deadline - afterClaim.getTime() < NEUTRAL_GENERATION_ITEM_RESERVE_MS
  )
    return { outcome: "DEFERRED" };

  const production = await store.beginProduction(fence);
  if (!production) return { outcome: "LEASE_LOST" };

  // Keep this invocation adjacent to the durable begin: no DB, source,
  // provider, repository, or storage work may occur between them.
  let final: FinalState;
  try {
    final = classify(
      await (deps.produce ?? produceNeutralReport)({
        orderId: production.orderId,
        propertyPin: production.propertyPin,
        deadline: deps.deadline,
      }),
    );
  } catch {
    // The thrown value is deliberately never read or logged.
    final = {
      status: "RECONCILIATION_REQUIRED",
      reasonCode: "PRODUCTION_OUTCOME_UNKNOWN",
    };
  }
  const transitioned = await store.transition({
    ...fence,
    revision: production.revision,
    ...final,
  });
  return transitioned ? { outcome: final.status } : { outcome: "LEASE_LOST" };
}
