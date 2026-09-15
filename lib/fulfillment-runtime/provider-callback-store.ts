/**
 * Transactional store for authenticated provider callbacks.
 *
 * Every admitted callback lands in `ot_delivery_provider_callback` FIRST, inside
 * the same transaction as anything it goes on to change. That ordering is what
 * makes the whole thing safe:
 *
 *   - the unique `(provider, provider_event_id)` is the replay identity, taken
 *     from the SIGNED envelope rather than the body, so a duplicate signed
 *     delivery collapses to a no-op even if the first one crashed midway;
 *   - an event we cannot correlate yet is RECORDED as UNMATCHED rather than
 *     dropped, so the send/callback race never costs us evidence;
 *   - an event we decline to apply is RECORDED as REFUSED with a bounded reason,
 *     so "we chose not to act on this" is a fact on disk, not an absence.
 *
 * No correlation tag is ever consulted. The provider is not required to echo
 * one and this system never assumes it does; the only correlation is the
 * provider's message id, which becomes usable when the send returns and binds it
 * to an attempt. Until then, matching is genuinely impossible and we say so.
 *
 * Concurrency contract, identical to the delivery store's so the two cannot
 * deadlock: lock `ot_order` FOR UPDATE first, then `ot_fulfillment`, then the
 * attempt, and re-verify everything inside that lock against freshly read state.
 *
 * Nothing free-form is persisted here: no recipient, no subject, no bounce text,
 * no raw body, and no capability.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  decideCallbackApplication,
  MAX_RECONCILIATION_BATCH,
  MAX_UNMATCHED_CALLBACKS,
  UNMATCHED_RECONCILIATION_WINDOW_MS,
  type CallbackAttemptRow,
  type CallbackFulfillmentRow,
  type CallbackNonApplicationCode,
  type CallbackOrderRow,
  type SanitizedProviderCallback,
} from "@/lib/fulfillment/provider-callbacks";

export type CallbackIngestResult =
  /** A previously admitted signed delivery. Nothing was written. */
  | { outcome: "DUPLICATE" }
  /** Bound to an attempt and folded into the summary. */
  | { outcome: "APPLIED"; fulfillmentId: string; attemptNumber: number; status: string }
  /** Recorded, correlation not yet possible. Reconciled once the id is bound. */
  | { outcome: "UNMATCHED" }
  /** Recorded, deliberately not applied. */
  | { outcome: "REFUSED"; code: CallbackNonApplicationCode };

export interface ProviderCallbackStore {
  ingest(event: SanitizedProviderCallback): Promise<CallbackIngestResult>;
  /**
   * Re-attempt every stored UNMATCHED callback for one provider message id.
   * Called once a send returns and the id becomes correlatable, and available to
   * the bounded operator recovery control.
   */
  reconcile(input: {
    provider: string;
    providerMessageId: string;
  }): Promise<{ examined: number; applied: number; stillUnmatched: number }>;
}

const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

export type ProviderCallbackTransaction = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type ProviderCallbackClient = {
  $transaction<T>(work: (tx: ProviderCallbackTransaction) => Promise<T>): Promise<T>;
};

type StoredCallbackRow = {
  id: string;
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  reasonCode: string | null;
  occurredAt: Date | string;
  receivedAt: Date | string;
  replayCount: number;
};

type AttemptLookupRow = {
  fulfillmentId: string;
  attemptNumber: number;
  orderId: string;
};

function toInstant(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Internal signal: unwind (and roll back) the transaction with a bounded code. */
class CallbackRollback extends Error {
  constructor(readonly code: CallbackNonApplicationCode) {
    super(code);
    this.name = "CallbackRollback";
  }
}

export function createPrismaProviderCallbackStore(
  client: ProviderCallbackClient,
): ProviderCallbackStore {
  /**
   * Try to bind an already-recorded callback to an attempt and fold it.
   *
   * Shared by first-arrival ingestion and by reconciliation so the two can never
   * disagree about what is allowed to move a fulfillment.
   */
  async function apply(
    tx: ProviderCallbackTransaction,
    callbackId: string,
    event: SanitizedProviderCallback,
  ): Promise<CallbackIngestResult> {
    // The ONLY correlation: the provider's message id, bound to exactly one
    // attempt by the schema's unique (provider, provider_message_id).
    const located = await tx.$queryRaw<AttemptLookupRow[]>(
      Prisma.sql`SELECT t."fulfillment_id" AS "fulfillmentId",
                        t."attempt_number" AS "attemptNumber",
                        f."order_id" AS "orderId"
                 FROM "ot_delivery_attempt" t
                 JOIN "ot_fulfillment" f ON f."id" = t."fulfillment_id"
                 WHERE t."provider" = ${event.provider}
                   AND t."provider_message_id" = ${event.providerMessageId}`,
    );
    const found = located[0];
    if (!found) return { outcome: "UNMATCHED" };

    // Order → fulfillment → attempt.
    const orders = await tx.$queryRaw<CallbackOrderRow[]>(
      Prisma.sql`SELECT "id", "tier", "status" FROM "ot_order"
                 WHERE "id" = ${found.orderId} FOR UPDATE`,
    );
    const summaries = await tx.$queryRaw<CallbackFulfillmentRow[]>(
      Prisma.sql`SELECT "id", "order_id" AS "orderId", "kind"::text AS "kind",
                        "status"::text AS "status",
                        "status_revision" AS "statusRevision",
                        "attempt_count" AS "attemptCount"
                 FROM "ot_fulfillment" WHERE "id" = ${found.fulfillmentId} FOR UPDATE`,
    );
    const attempts = await tx.$queryRaw<CallbackAttemptRow[]>(
      Prisma.sql`SELECT "fulfillment_id" AS "fulfillmentId",
                        "attempt_number" AS "attemptNumber",
                        "provider",
                        "artifact_version" AS "artifactVersion"
                 FROM "ot_delivery_attempt"
                 WHERE "fulfillment_id" = ${found.fulfillmentId}
                   AND "attempt_number" = ${found.attemptNumber} FOR UPDATE`,
    );
    const artifacts = await tx.$queryRaw<Array<{ version: number }>>(
      Prisma.sql`SELECT "version" FROM "ot_fulfillment_artifact"
                 WHERE "fulfillment_id" = ${found.fulfillmentId}
                 ORDER BY "version" DESC LIMIT 1`,
    );
    const clock = await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);
    const trustedNow = toInstant(clock[0]?.now);

    const decision = decideCallbackApplication({
      event,
      order: orders[0] ?? null,
      fulfillment: summaries[0] ?? null,
      attempt: attempts[0] ?? null,
      currentArtifactVersion: artifacts[0]?.version ?? null,
      trustedNow,
    });
    if (!decision.ok) {
      await markRefused(tx, callbackId, decision.code, trustedNow, {
        fulfillmentId: found.fulfillmentId,
        attemptNumber: found.attemptNumber,
      });
      return { outcome: "REFUSED", code: decision.code };
    }
    const plan = decision.plan;
    const occurredAt = new Date(plan.occurredAt);

    // Append-only evidence. The authenticated provider event id is reused as the
    // event log's dedup identity, so the two dedup surfaces agree.
    const sequences = await tx.$queryRaw<Array<{ next: number }>>(
      Prisma.sql`SELECT COALESCE(MAX("sequence"), 0) + 1 AS "next"
                 FROM "ot_delivery_event"
                 WHERE "fulfillment_id" = ${plan.fulfillmentId}`,
    );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "ot_delivery_event" (
                   "id", "fulfillment_id", "attempt_number", "provider",
                   "provider_event_id", "event_type", "sequence",
                   "occurred_at", "received_at", "reason_code"
                 ) VALUES (
                   ${randomUUID()}, ${plan.fulfillmentId}, ${plan.attemptNumber},
                   ${event.provider}, ${event.providerEventId},
                   ${plan.eventType}::"OTDeliveryEventType",
                   ${Number(sequences[0]?.next ?? 1)},
                   ${occurredAt}, ${new Date(trustedNow)}, ${plan.reasonCode}
                 )
                 ON CONFLICT ("provider", "provider_event_id") DO NOTHING`,
    );

    // Lifecycle timestamps are set once and never rewritten, so a later replay
    // cannot move the moment something happened.
    await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_delivery_attempt"
                 SET "provider_accepted_at" = CASE WHEN ${plan.eventType === "ACCEPTED"}
                       THEN COALESCE("provider_accepted_at", ${occurredAt}) ELSE "provider_accepted_at" END,
                     "delivered_at" = CASE WHEN ${plan.eventType === "DELIVERED"}
                       THEN COALESCE("delivered_at", ${occurredAt}) ELSE "delivered_at" END,
                     "delayed_at" = CASE WHEN ${plan.eventType === "DELAYED"}
                       THEN COALESCE("delayed_at", ${occurredAt}) ELSE "delayed_at" END,
                     "failed_at" = CASE WHEN ${
                       plan.eventType === "BOUNCED" ||
                       plan.eventType === "COMPLAINED" ||
                       plan.eventType === "FAILED"
                     }
                       THEN COALESCE("failed_at", ${occurredAt}) ELSE "failed_at" END,
                     "reason_code" = COALESCE("reason_code", ${plan.reasonCode})
                 WHERE "fulfillment_id" = ${plan.fulfillmentId}
                   AND "attempt_number" = ${plan.attemptNumber}`,
    );

    // Advance only from the EXACT revision the decision was made against.
    const advanced = await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_fulfillment"
                 SET "status" = ${plan.nextStatus}::"OTFulfillmentStatus",
                     "status_revision" = ${plan.expectedStatusRevision + 1},
                     "last_reason_code" = COALESCE(${plan.reasonCode}, "last_reason_code")
                 WHERE "id" = ${plan.fulfillmentId}
                   AND "status"::text = ${plan.fromStatus}
                   AND "status_revision" = ${plan.expectedStatusRevision}`,
    );
    if (advanced !== 1) throw new CallbackRollback("STALE_ATTEMPT");

    // A terminal outcome ends customer access immediately rather than waiting for
    // the next download to notice the status is no longer downloadable.
    if (plan.revokesCapabilities) {
      await tx.$executeRaw(
        Prisma.sql`UPDATE "ot_packet_download_capability"
                   SET "revoked_at" = ${new Date(trustedNow)},
                       "revoked_reason_code" = ${"UNDELIVERABLE"}
                   WHERE "fulfillment_id" = ${plan.fulfillmentId}
                     AND "revoked_at" IS NULL`,
      );
    }

    await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_delivery_provider_callback"
                 SET "disposition" = ${"APPLIED"}, "disposition_code" = NULL,
                     "fulfillment_id" = ${plan.fulfillmentId},
                     "attempt_number" = ${plan.attemptNumber},
                     "resolved_at" = ${new Date(trustedNow)}
                 WHERE "id" = ${callbackId}`,
    );

    return {
      outcome: "APPLIED",
      fulfillmentId: plan.fulfillmentId,
      attemptNumber: plan.attemptNumber,
      status: plan.nextStatus,
    };
  }

  async function markRefused(
    tx: ProviderCallbackTransaction,
    callbackId: string,
    code: CallbackNonApplicationCode,
    trustedNow: string,
    binding: { fulfillmentId: string | null; attemptNumber: number | null },
  ): Promise<void> {
    const resolvedAt = trustedNow === "" ? null : new Date(trustedNow);
    await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_delivery_provider_callback"
                 SET "disposition" = ${"REFUSED"}, "disposition_code" = ${code},
                     "fulfillment_id" = ${binding.fulfillmentId},
                     "attempt_number" = ${binding.attemptNumber},
                     "resolved_at" = COALESCE("resolved_at", ${resolvedAt})
                 WHERE "id" = ${callbackId}`,
    );
  }

  return {
    async ingest(event) {
      try {
        return await client.$transaction(
          async (tx): Promise<CallbackIngestResult> => {
            const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
              TRUSTED_CLOCK_SQL,
            );
            const trustedNow = toInstant(clock[0]?.now);
            if (trustedNow === "")
              return { outcome: "REFUSED", code: "UNTRUSTED_CLOCK" };

            // Replay protection FIRST, before anything is read or decided. The
            // unique index is the authority; a conflicting insert writes nothing
            // and reports zero, which is the duplicate answer.
            const id = randomUUID();
            const inserted = await tx.$executeRaw(
              Prisma.sql`INSERT INTO "ot_delivery_provider_callback" (
                           "id", "provider", "provider_event_id", "provider_message_id",
                           "event_type", "reason_code", "occurred_at", "received_at",
                           "disposition", "replay_count"
                         ) VALUES (
                           ${id}, ${event.provider}, ${event.providerEventId},
                           ${event.providerMessageId},
                           ${event.eventType}::"OTDeliveryEventType",
                           ${event.reasonCode}, ${new Date(event.occurredAt)},
                           ${new Date(trustedNow)}, ${"UNMATCHED"}, 0
                         )
                         ON CONFLICT ("provider", "provider_event_id") DO NOTHING`,
            );
            if (inserted !== 1) return { outcome: "DUPLICATE" };

            const applied = await apply(tx, id, event);
            if (applied.outcome !== "UNMATCHED") return applied;

            // Genuinely uncorrelatable: the send has not yet bound this message
            // id to an attempt. The row stays UNMATCHED and is reconciled later.
            // The ceiling is enforced AFTER the insert so the count includes this
            // row; over the ceiling we keep the evidence but stop pretending it
            // will be replayed.
            const counts = await tx.$queryRaw<Array<{ live: bigint | number }>>(
              Prisma.sql`SELECT COUNT(*) AS "live"
                         FROM "ot_delivery_provider_callback"
                         WHERE "disposition" = 'UNMATCHED' AND "resolved_at" IS NULL`,
            );
            if (Number(counts[0]?.live ?? 0) > MAX_UNMATCHED_CALLBACKS) {
              await markRefused(tx, id, "UNMATCHED_STORE_FULL", trustedNow, {
                fulfillmentId: null,
                attemptNumber: null,
              });
              return { outcome: "REFUSED", code: "UNMATCHED_STORE_FULL" };
            }
            return { outcome: "UNMATCHED" };
          },
        );
      } catch (error) {
        if (error instanceof CallbackRollback)
          return { outcome: "REFUSED", code: error.code };
        throw error;
      }
    },

    async reconcile(input) {
      // Deliberately NOT one big transaction.
      //
      // `apply` can fail its compare-and-set after it has already appended an
      // event row, and unwinding that has to roll back exactly that row's work —
      // not the rows reconciled before it. Prisma's raw seam offers no
      // savepoints, so each stored callback gets its own transaction. The pass is
      // therefore re-runnable, and one poisoned row cannot undo the others.
      const horizonNow = await client.$transaction(async (tx) => {
        const clock = await tx.$queryRaw<Array<{ now: unknown }>>(
          TRUSTED_CLOCK_SQL,
        );
        return toInstant(clock[0]?.now);
      });
      if (horizonNow === "")
        return { examined: 0, applied: 0, stillUnmatched: 0 };
      const horizon = new Date(
        new Date(horizonNow).getTime() - UNMATCHED_RECONCILIATION_WINDOW_MS,
      );

      // Bounded in count and in age. Oldest first, so the fold sees provider
      // events in the order the provider observed them.
      const stored = await client.$transaction((tx) =>
        tx.$queryRaw<StoredCallbackRow[]>(
          Prisma.sql`SELECT "id", "provider", "provider_event_id" AS "providerEventId",
                            "provider_message_id" AS "providerMessageId",
                            "event_type"::text AS "eventType",
                            "reason_code" AS "reasonCode",
                            "occurred_at" AS "occurredAt",
                            "received_at" AS "receivedAt",
                            "replay_count" AS "replayCount"
                     FROM "ot_delivery_provider_callback"
                     WHERE "provider" = ${input.provider}
                       AND "provider_message_id" = ${input.providerMessageId}
                       AND "disposition" = 'UNMATCHED'
                       AND "resolved_at" IS NULL
                       AND "received_at" >= ${horizon}
                     ORDER BY "occurred_at" ASC, "received_at" ASC
                     LIMIT ${MAX_RECONCILIATION_BATCH}`,
        ),
      );

      let applied = 0;
      let stillUnmatched = 0;
      for (const row of stored) {
        let result: CallbackIngestResult;
        try {
          result = await client.$transaction(
            async (tx): Promise<CallbackIngestResult> => {
              // Claim the row conditionally. Losing this to a concurrent
              // reconciler means somebody else owns this replay, so we do
              // nothing rather than applying the same event twice.
              const claimed = await tx.$executeRaw(
                Prisma.sql`UPDATE "ot_delivery_provider_callback"
                           SET "replay_count" = LEAST("replay_count" + 1, 1000)
                           WHERE "id" = ${row.id}
                             AND "disposition" = 'UNMATCHED'
                             AND "resolved_at" IS NULL
                             AND "replay_count" = ${row.replayCount}`,
              );
              if (claimed !== 1) return { outcome: "DUPLICATE" };
              return apply(tx, row.id, {
                provider: row.provider,
                providerEventId: row.providerEventId,
                providerMessageId: row.providerMessageId,
                eventType:
                  row.eventType as SanitizedProviderCallback["eventType"],
                reasonCode: row.reasonCode,
                occurredAt: asInstant(row.occurredAt),
              });
            },
          );
        } catch (error) {
          // This row's writes rolled back with its own transaction. It stays
          // UNMATCHED and a later pass may pick it up again.
          if (error instanceof CallbackRollback) {
            stillUnmatched += 1;
            continue;
          }
          throw error;
        }
        if (result.outcome === "APPLIED") applied += 1;
        else if (result.outcome === "UNMATCHED") stillUnmatched += 1;
      }
      return { examined: stored.length, applied, stillUnmatched };
    },
  };
}

export const prismaProviderCallbackStore = createPrismaProviderCallbackStore(
  prisma as unknown as ProviderCallbackClient,
);
