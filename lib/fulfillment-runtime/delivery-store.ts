/**
 * Transactional store for T2 delivery attempts.
 *
 * The ordering invariant this store exists to enforce: **the attempt is durable
 * before the send happens.** `persistAttempt` inserts the attempt row, its
 * REQUESTED event, and the ARTIFACT_READY/DELAYED → DELIVERY_PENDING transition
 * in one transaction, and only then may a caller hand anything to a provider. A
 * process that dies between the two leaves a DELIVERY_PENDING summary — which
 * [[decideDeliverySend]] refuses as UNRESOLVED_SEND — rather than a silent
 * possible duplicate.
 *
 * `recordOutcome` is the mirror image: provider "accepted" becomes
 * PROVIDER_ACCEPTED and never DELIVERED, a rejection becomes terminal FAILED,
 * and an UNKNOWN outcome writes nothing at all, deliberately leaving the send
 * unresolved so no automatic retry can duplicate it.
 *
 * Concurrency contract, matching the binder and the artifact orchestrator so the
 * three cannot deadlock: lock `ot_order` FOR UPDATE first, then `ot_fulfillment`,
 * and re-verify everything inside that lock against freshly read state.
 *
 * This store sends nothing. It has no provider dependency, imports no mail
 * client, and holds no recipient address — the `ot_delivery_attempt` row records
 * a provider NAME and an opaque message id and nothing else.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { t2DeliveryEnabled } from "@/lib/fulfillment/flag";
import { evaluateLease, type LeaseSnapshot } from "@/lib/fulfillment/lease";
import {
  decideDeliveryDispatch,
  decideSendOutcomeRecord,
  type DeliverySendOutcome,
} from "@/lib/fulfillment/delivery-orchestration";

/** Bounded attempt budget. A delivery retry reuses the artifact; it never regenerates. */
export const T2_MAX_DELIVERY_ATTEMPTS = 3;

export type DeliveryLeaseClaim = {
  orderId: string;
  fulfillmentId: string;
  owner: string;
  token: string;
  /** Strict RFC3339 UTC instant; the same instant the expiry is measured from. */
  now: string;
  expiresAt: Date;
};

export type PersistAttemptInput = {
  orderId: string;
  fulfillmentId: string;
  provider: string;
  owner: string;
  token: string;
};

export type PersistAttemptOutcome =
  | {
      ok: true;
      attemptId: string;
      attemptNumber: number;
      artifactVersion: number;
      artifactSha256: string;
      idempotencyKey: string;
      statusRevision: number;
    }
  | { ok: false; blocker: string };

export type RecordOutcomeInput = {
  orderId: string;
  fulfillmentId: string;
  attemptNumber: number;
  outcome: DeliverySendOutcome;
};

export type RecordOutcomeResult =
  | { ok: true; recorded: boolean; unresolved: boolean; status: string }
  | { ok: false; blocker: string };

export interface T2DeliveryStore {
  claim(input: DeliveryLeaseClaim): Promise<boolean>;
  release(input: {
    fulfillmentId: string;
    owner: string;
    token: string;
  }): Promise<boolean>;
  persistAttempt(input: PersistAttemptInput): Promise<PersistAttemptOutcome>;
  recordOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult>;
}

const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

type OrderRow = { id: string; status: string; tier: string };

type SummaryRow = {
  id: string;
  orderId: string;
  kind: string;
  status: string;
  statusRevision: number;
  attemptCount: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | string | null;
};

type ArtifactRow = {
  version: number;
  artifactSha256: string;
  generatorVersion: string;
  templateVersion: string | null;
};

const SUMMARY_COLUMNS = Prisma.sql`
  "id", "order_id" AS "orderId", "kind"::text AS "kind", "status"::text AS "status",
  "status_revision" AS "statusRevision", "attempt_count" AS "attemptCount",
  "lease_owner" AS "leaseOwner", "lease_token" AS "leaseToken",
  "lease_expires_at" AS "leaseExpiresAt"
`;

export type T2DeliveryTransaction = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type T2DeliveryClient = {
  $transaction<T>(work: (tx: T2DeliveryTransaction) => Promise<T>): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

function toInstant(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A wholly absent lease is null; anything partial is INVALID at the decision. */
function leaseSnapshot(row: SummaryRow): LeaseSnapshot {
  if (
    row.leaseOwner === null &&
    row.leaseToken === null &&
    row.leaseExpiresAt === null
  ) {
    return null;
  }
  return {
    owner: row.leaseOwner as string,
    token: row.leaseToken as string,
    expiresAt:
      row.leaseExpiresAt instanceof Date
        ? row.leaseExpiresAt.toISOString()
        : (row.leaseExpiresAt as unknown as string),
  };
}

async function lockedContext(
  tx: T2DeliveryTransaction,
  orderId: string,
  fulfillmentId: string,
): Promise<{ order: OrderRow | null; summary: SummaryRow | null }> {
  const orders = await tx.$queryRaw<OrderRow[]>(
    Prisma.sql`SELECT "id", "status", "tier" FROM "ot_order" WHERE "id" = ${orderId} FOR UPDATE`,
  );
  const order = orders[0] ?? null;
  if (!order) return { order: null, summary: null };
  const summaries = await tx.$queryRaw<SummaryRow[]>(
    Prisma.sql`SELECT ${SUMMARY_COLUMNS} FROM "ot_fulfillment"
               WHERE "id" = ${fulfillmentId} FOR UPDATE`,
  );
  return { order, summary: summaries[0] ?? null };
}

/** Settlement must be exactly a paid T2 order, read fresh under the lock. */
function settlementOk(order: OrderRow | null): boolean {
  return order?.status === "PAID" && order.tier === "T2";
}

export function createPrismaT2DeliveryStore(
  client: T2DeliveryClient,
): T2DeliveryStore {
  return {
    async claim(input) {
      if (!t2DeliveryEnabled(process.env)) return false;
      return client.$transaction(async (tx): Promise<boolean> => {
        const { order, summary } = await lockedContext(
          tx,
          input.orderId,
          input.fulfillmentId,
        );
        if (!settlementOk(order) || !summary) return false;
        if (
          summary.orderId !== input.orderId ||
          summary.kind !== "T2_APPEAL_EVIDENCE"
        ) {
          return false;
        }
        // Only a state a send could legally begin from may be leased. A
        // DELIVERY_PENDING row is unresolved, not claimable.
        if (summary.status !== "ARTIFACT_READY" && summary.status !== "DELAYED")
          return false;

        const { decision } = evaluateLease({
          lease: leaseSnapshot(summary),
          now: input.now,
          requester: input.owner,
          requesterToken: input.token,
        });
        if (decision !== "CLAIMABLE" && decision !== "EXPIRED_RECLAIMABLE")
          return false;

        // The status predicate is repeated in the write so the claim stays
        // conditional even if a future edit weakens the read above.
        const updated = await tx.$executeRaw(
          Prisma.sql`UPDATE "ot_fulfillment"
                     SET "lease_owner" = ${input.owner}, "lease_token" = ${input.token},
                         "lease_expires_at" = ${input.expiresAt}
                     WHERE "id" = ${input.fulfillmentId}
                       AND "status"::text IN ('ARTIFACT_READY', 'DELAYED')`,
        );
        return updated === 1;
      });
    },

    async release(input) {
      const updated = await client.$executeRaw(
        Prisma.sql`UPDATE "ot_fulfillment"
                   SET "lease_owner" = NULL, "lease_token" = NULL, "lease_expires_at" = NULL
                   WHERE "id" = ${input.fulfillmentId}
                     AND "lease_owner" = ${input.owner} AND "lease_token" = ${input.token}`,
      );
      return updated === 1;
    },

    async persistAttempt(input) {
      if (!t2DeliveryEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      return client.$transaction(
        async (tx): Promise<PersistAttemptOutcome> => {
          const { order, summary } = await lockedContext(
            tx,
            input.orderId,
            input.fulfillmentId,
          );
          if (!order) return { ok: false, blocker: "ORDER_NOT_FOUND" };
          if (!settlementOk(order))
            return { ok: false, blocker: "INELIGIBLE_SETTLEMENT" };
          if (!summary) return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };
          if (summary.orderId !== input.orderId)
            return { ok: false, blocker: "FULFILLMENT_ORDER_MISMATCH" };
          if (summary.kind !== "T2_APPEAL_EVIDENCE")
            return { ok: false, blocker: "INELIGIBLE_FULFILLMENT_STATUS" };

          // A delivery sends the CURRENT artifact — the highest bound version.
          // It never regenerates and never reaches for an older version.
          const artifacts = await tx.$queryRaw<ArtifactRow[]>(
            Prisma.sql`SELECT "version", "artifact_sha256" AS "artifactSha256",
                              "generator_version" AS "generatorVersion",
                              "template_version" AS "templateVersion"
                       FROM "ot_fulfillment_artifact"
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                       ORDER BY "version" DESC LIMIT 1`,
          );
          const artifact = artifacts[0];
          if (!artifact) return { ok: false, blocker: "ARTIFACT_NOT_FOUND" };

          const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
            TRUSTED_CLOCK_SQL,
          );
          const trustedNow = toInstant(clock[0]?.now);
          if (trustedNow === "")
            return { ok: false, blocker: "UNTRUSTED_CLOCK" };

          if (evaluateLease({
            lease: leaseSnapshot(summary), now: trustedNow,
            requester: input.owner, requesterToken: input.token,
          }).decision !== "RENEWABLE")
            return { ok: false, blocker: "LEASE_NOT_OWNED" };

          const decision = decideDeliveryDispatch({
            flagEnabled: t2DeliveryEnabled(process.env),
            orderId: input.orderId,
            fulfillmentId: input.fulfillmentId,
            status: summary.status,
            statusRevision: summary.statusRevision,
            attemptCount: summary.attemptCount,
            maxAttempts: T2_MAX_DELIVERY_ATTEMPTS,
            provider: input.provider,
            artifactVersion: artifact.version,
            artifactSha256: artifact.artifactSha256,
            generatorVersion: artifact.generatorVersion,
            templateVersion: artifact.templateVersion ?? undefined,
          });
          if (!decision.ok) return { ok: false, blocker: decision.blocker };
          const plan = decision.plan;

          const attemptId = randomUUID();
          const requestedAt = new Date(trustedNow);
          // The attempt row is the durable record that a send is about to
          // happen. Its unique idempotency key means a replay of this exact
          // logical send cannot insert a second attempt.
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "ot_delivery_attempt" (
                         "id", "fulfillment_id", "attempt_number", "artifact_version",
                         "idempotency_key", "provider", "requested_at", "created_at"
                       ) VALUES (
                         ${attemptId}, ${input.fulfillmentId}, ${plan.attemptNumber},
                         ${plan.artifactVersion}, ${plan.idempotencyKey},
                         ${plan.provider}, ${requestedAt}, ${requestedAt}
                       )`,
          );

          // Locally assigned monotonic fold order, computed under the lock so
          // two events can never claim one sequence slot.
          const sequences = await tx.$queryRaw<Array<{ next: number }>>(
            Prisma.sql`SELECT COALESCE(MAX("sequence"), 0) + 1 AS "next"
                       FROM "ot_delivery_event"
                       WHERE "fulfillment_id" = ${input.fulfillmentId}`,
          );
          const sequence = Number(sequences[0]?.next ?? 1);
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "ot_delivery_event" (
                         "id", "fulfillment_id", "attempt_number", "provider",
                         "provider_event_id", "event_type", "sequence",
                         "occurred_at", "received_at"
                       ) VALUES (
                         ${randomUUID()}, ${input.fulfillmentId}, ${plan.attemptNumber},
                         ${plan.provider},
                         ${`local:${plan.idempotencyKey}`},
                         ${"REQUESTED"}::"OTDeliveryEventType", ${sequence},
                         ${requestedAt}, ${requestedAt}
                       )`,
          );

          // Advance only from the exact revision the decision was made against.
          const advanced = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_fulfillment"
                       SET "status" = 'DELIVERY_PENDING',
                           "status_revision" = ${plan.expectedStatusRevision + 1},
                           "attempt_count" = ${plan.attemptNumber}
                       WHERE "id" = ${input.fulfillmentId}
                         AND "status"::text = ${plan.fromStatus}
                         AND "status_revision" = ${plan.expectedStatusRevision}`,
          );
          if (advanced !== 1)
            throw new DeliveryRollback("DELIVERY_ATTEMPT_CONFLICT");

          // A withdrawal observed while the writes awaited PostgreSQL rolls the
          // whole attempt back, so no send is ever authorized under a shut flag.
          if (!t2DeliveryEnabled(process.env))
            throw new DeliveryRollback("FLAG_DISABLED");

          return {
            ok: true,
            attemptId,
            attemptNumber: plan.attemptNumber,
            artifactVersion: plan.artifactVersion,
            artifactSha256: artifact.artifactSha256,
            idempotencyKey: plan.idempotencyKey,
            statusRevision: plan.expectedStatusRevision + 1,
          };
        },
      ).catch(unwind) as Promise<PersistAttemptOutcome>;
    },

    async recordOutcome(input) {
      return client.$transaction(
        async (tx): Promise<RecordOutcomeResult> => {
          const { order, summary } = await lockedContext(
            tx,
            input.orderId,
            input.fulfillmentId,
          );
          if (!order || !summary)
            return { ok: false, blocker: "FULFILLMENT_NOT_FOUND" };

          if (!settlementOk(order))
            return { ok: false, blocker: "INELIGIBLE_SETTLEMENT" };
          if (summary.orderId !== input.orderId)
            return { ok: false, blocker: "FULFILLMENT_ORDER_MISMATCH" };
          if (summary.kind !== "T2_APPEAL_EVIDENCE")
            return { ok: false, blocker: "INELIGIBLE_FULFILLMENT_STATUS" };
          if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1)
            return { ok: false, blocker: "ATTEMPT_NOT_FOUND" };
          const attempts = await tx.$queryRaw<Array<{ provider: string }>>(
            Prisma.sql`SELECT "provider" FROM "ot_delivery_attempt"
              WHERE "fulfillment_id" = ${input.fulfillmentId}
                AND "attempt_number" = ${input.attemptNumber} FOR UPDATE`,
          );
          if (!attempts[0]) return { ok: false, blocker: "ATTEMPT_NOT_FOUND" };
          if (attempts[0].provider !== input.outcome.provider)
            return { ok: false, blocker: "ATTEMPT_PROVIDER_MISMATCH" };
          if (summary.attemptCount !== input.attemptNumber)
            return { ok: false, blocker: "STALE_ATTEMPT" };

          const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
            TRUSTED_CLOCK_SQL,
          );
          const trustedNow = toInstant(clock[0]?.now);
          if (trustedNow === "")
            return { ok: false, blocker: "UNTRUSTED_CLOCK" };

          const decision = decideSendOutcomeRecord({
            status: summary.status,
            outcome: input.outcome,
            occurredAt: trustedNow,
          });
          if (!decision.ok) return { ok: false, blocker: decision.blocker };
          const record = decision.record;

          // An unresolved send is recorded by recording NOTHING. The summary
          // stays DELIVERY_PENDING, which the send authority refuses to retry,
          // so the ambiguity survives until a provider event or an operator
          // resolves it. Writing a speculative failure here is exactly how a
          // duplicate delivery gets authorized later.
          if (record.eventType === null || record.nextStatus === null)
            return {
              ok: true,
              recorded: false,
              unresolved: record.unresolved,
              status: summary.status,
            };

          const occurredAt = new Date(trustedNow);
          const accepted = record.eventType === "ACCEPTED";
          const updatedAttempt = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_delivery_attempt"
                       SET "provider_message_id" = COALESCE("provider_message_id", ${record.providerMessageId}),
                           "provider_accepted_at" = CASE WHEN ${accepted} THEN COALESCE("provider_accepted_at", ${occurredAt}) ELSE "provider_accepted_at" END,
                           "failed_at" = CASE WHEN ${accepted} THEN "failed_at" ELSE COALESCE("failed_at", ${occurredAt}) END,
                           "reason_code" = COALESCE("reason_code", ${record.reasonCode})
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "attempt_number" = ${input.attemptNumber}`,
          );
          if (updatedAttempt !== 1)
            throw new DeliveryRollback("ATTEMPT_NOT_FOUND");

          const sequences = await tx.$queryRaw<Array<{ next: number }>>(
            Prisma.sql`SELECT COALESCE(MAX("sequence"), 0) + 1 AS "next"
                       FROM "ot_delivery_event"
                       WHERE "fulfillment_id" = ${input.fulfillmentId}`,
          );
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO "ot_delivery_event" (
                         "id", "fulfillment_id", "attempt_number", "provider",
                         "provider_event_id", "event_type", "sequence",
                         "occurred_at", "received_at", "reason_code"
                       ) VALUES (
                         ${randomUUID()}, ${input.fulfillmentId}, ${input.attemptNumber},
                         ${input.outcome.provider},
                         ${`local:${input.fulfillmentId}:${input.attemptNumber}:${record.eventType}`},
                         ${record.eventType}::"OTDeliveryEventType",
                         ${Number(sequences[0]?.next ?? 1)},
                         ${occurredAt}, ${occurredAt}, ${record.reasonCode}
                       )
                       ON CONFLICT ("provider", "provider_event_id") DO NOTHING`,
          );

          const advanced = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_fulfillment"
                       SET "status" = ${record.nextStatus}::"OTFulfillmentStatus",
                           "status_revision" = ${summary.statusRevision + 1},
                           "last_reason_code" = COALESCE(${record.reasonCode}, "last_reason_code")
                       WHERE "id" = ${input.fulfillmentId}
                         AND "status_revision" = ${summary.statusRevision}`,
          );
          if (advanced !== 1)
            throw new DeliveryRollback("DELIVERY_ATTEMPT_CONFLICT");

          return {
            ok: true,
            recorded: true,
            unresolved: false,
            status: record.nextStatus,
          };
        },
      ).catch(unwind) as Promise<RecordOutcomeResult>;
    },
  };
}

/** Internal signal: unwind (and roll back) the transaction with a bounded code. */
class DeliveryRollback extends Error {
  constructor(readonly blocker: string) {
    super(blocker);
    this.name = "DeliveryRollback";
  }
}

function unwind(error: unknown): { ok: false; blocker: string } {
  if (error instanceof DeliveryRollback)
    return { ok: false, blocker: error.blocker };
  throw error;
}

export const prismaT2DeliveryStore = createPrismaT2DeliveryStore(
  prisma as unknown as T2DeliveryClient,
);
