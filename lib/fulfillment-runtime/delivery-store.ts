/**
 * Transactional store for T2 delivery attempts.
 *
 * The ordering invariant this store exists to enforce: **the attempt is durable
 * before the send happens.** `persistAttempt` inserts the attempt row, its
 * REQUESTED event, and the ARTIFACT_READY → DELIVERY_PENDING transition in one
 * transaction, and only then may a caller hand anything to a provider. A
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
 * Every operation that may authorize a send is additionally gated on a LIVE
 * LEASE held by the caller. `claim`, `persistAttempt` and `assertSendable` all
 * take `owner`/`token` and measure expiry against the DATABASE's wall clock —
 * read after the locks, never at transaction start and never from a
 * caller-supplied instant: holding a lease object in process memory proves
 * nothing, a process whose clock runs slow must not be able to act on a lease
 * that expired minutes ago, and neither must a transaction that spent that
 * lease's whole remaining life blocked on the row lock. The compare-and-set that advances the summary
 * repeats the lease predicate in SQL, so an expired or stolen lease cannot
 * persist an attempt even if the read above it were weakened.
 *
 * `assertSendable` exists because the attempt is durable BEFORE the send: there
 * is an asynchronous gap between deciding to send and sending. A refund, a
 * withdrawn flag, property drift or a lost lease landing in that gap must stop
 * the send, so the caller re-asserts the exact pending attempt identity plus
 * current authority immediately before handing anything to an adapter. That
 * narrows the gap to a single transaction. It does not eliminate it — nothing
 * outside the database can be made atomic with it, and nothing here can un-send
 * a message that has already left.
 *
 * This store sends nothing. It has no provider dependency, imports no mail
 * client, and holds no recipient address — the `ot_delivery_attempt` row records
 * a provider NAME and an opaque message id and nothing else.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { classifyPropertyBinding } from "@/lib/fulfillment/artifact-binding";
import { t2DeliveryEnabled } from "@/lib/fulfillment/flag";
import { evaluateLease, type LeaseSnapshot } from "@/lib/fulfillment/lease";
import {
  decideDeliveryDispatch,
  decideSendOutcomeRecord,
  type DeliverySendOutcome,
} from "@/lib/fulfillment/delivery-orchestration";

/** Bounded attempt budget. A delivery retry reuses the artifact; it never regenerates. */
export const T2_MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Bounds on a lease's durable lifetime.
 *
 * A caller asks for a DURATION, never an expiry instant: the instant is derived
 * from the database clock inside the claim transaction. Too short and a normal
 * attempt loses its own lease mid-flight; too long and a dead worker holds the
 * fulfillment hostage far past the point a human would want to intervene. Out of
 * range is refused rather than clamped, so a caller's mistake stays visible.
 */
export const T2_MIN_LEASE_MS = 30 * 1000;
export const T2_MAX_LEASE_MS = 15 * 60 * 1000;

export type DeliveryLeaseClaim = {
  orderId: string;
  fulfillmentId: string;
  owner: string;
  token: string;
  /** Bounded duration; the expiry instant is computed from the DB clock. */
  leaseMs: number;
};

export type PersistAttemptInput = {
  orderId: string;
  fulfillmentId: string;
  provider: string;
  /** The lease this caller claims to hold. Verified against the row, not trusted. */
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
      /** The artifact's own order binding, re-checked before the send. */
      sourceOrderId: string;
      /** The property binding in force when the attempt was persisted. */
      propertyBindingFingerprint: string;
      idempotencyKey: string;
      provider: string;
      statusRevision: number;
    }
  | { ok: false; blocker: string };

/**
 * Everything the pre-send gate must match EXACTLY against freshly read state.
 *
 * It is deliberately the full identity of the durable attempt rather than just
 * an id: an attempt row that exists is not evidence that the same artifact, the
 * same property binding and the same lease are still in force.
 */
export type AssertSendableInput = {
  orderId: string;
  fulfillmentId: string;
  owner: string;
  token: string;
  attemptId: string;
  attemptNumber: number;
  idempotencyKey: string;
  provider: string;
  artifactVersion: number;
  artifactSha256: string;
  propertyBindingFingerprint: string;
  statusRevision: number;
};

export type AssertSendableOutcome =
  | { ok: true }
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
  /**
   * Re-verify, under the lock, that this exact durable attempt may still be
   * handed to a provider RIGHT NOW. Read-only: it authorizes nothing and writes
   * nothing, so a refusal leaves the attempt exactly as unresolved as it was.
   */
  assertSendable(input: AssertSendableInput): Promise<AssertSendableOutcome>;
  recordOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult>;
}

/**
 * WALL-CLOCK time as a strict RFC3339 UTC instant, rendered by the database.
 *
 * `clock_timestamp()`, deliberately NOT `CURRENT_TIMESTAMP`/`now()`. Every read
 * of this happens AFTER a `FOR UPDATE` lock that may have blocked for an
 * unbounded time behind another writer, and `CURRENT_TIMESTAMP` is frozen at
 * TRANSACTION START — it does not advance across that wait. A transaction that
 * began while a lease was still live and then waited past its expiry would read
 * the pre-wait instant and conclude the lease is live, authorizing a send under
 * an expired lease. `clock_timestamp()` advances during the transaction, so the
 * expiry is measured at the moment the decision is actually made.
 *
 * Rendered with `to_char`, never through a driver date mapping, which would
 * silently apply the server's local UTC offset.
 */
const TRUSTED_CLOCK_SQL = Prisma.sql`
  SELECT to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "now"
`;

type OrderRow = {
  id: string;
  status: string;
  tier: string;
  propertyPin: string | null;
  propertyAddress: string | null;
};

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
  sourceOrderId: string | null;
  propertyBindingFingerprint: string | null;
};

type AttemptRow = {
  id: string;
  attemptNumber: number;
  artifactVersion: number;
  idempotencyKey: string;
  provider: string;
  providerAcceptedAt: Date | string | null;
  failedAt: Date | string | null;
};

/** The CURRENT artifact is the highest bound version; never an older one. */
const CURRENT_ARTIFACT_SQL = (fulfillmentId: string) => Prisma.sql`
  SELECT "version", "artifact_sha256" AS "artifactSha256",
         "generator_version" AS "generatorVersion",
         "template_version" AS "templateVersion",
         "source_order_id" AS "sourceOrderId",
         "property_binding_fingerprint" AS "propertyBindingFingerprint"
  FROM "ot_fulfillment_artifact"
  WHERE "fulfillment_id" = ${fulfillmentId}
  ORDER BY "version" DESC LIMIT 1
`;

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
    Prisma.sql`SELECT "id", "status", "tier", "propertyPin", "propertyAddress"
               FROM "ot_order" WHERE "id" = ${orderId} FOR UPDATE`,
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

/**
 * The database's own WALL-CLOCK time, or "" when it cannot be trusted.
 *
 * Every caller reads this AFTER `lockedContext` has taken its `FOR UPDATE`
 * locks, so the instant reflects the end of any lock wait rather than the start
 * of the transaction. See [[TRUSTED_CLOCK_SQL]].
 */
async function readTrustedNow(tx: T2DeliveryTransaction): Promise<string> {
  const clock = await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);
  return toInstant(clock[0]?.now);
}

/**
 * True only when the row's lease is live and names exactly this owner AND token.
 *
 * `RENEWABLE` is the decision that means precisely that; every other decision —
 * absent, expired, malformed, held by someone else — is a refusal here.
 */
function leaseHeldBy(
  summary: SummaryRow,
  owner: string,
  token: string,
  trustedNow: string,
): boolean {
  const { decision } = evaluateLease({
    lease: leaseSnapshot(summary),
    now: trustedNow,
    requester: owner,
    requesterToken: token,
  });
  return decision === "RENEWABLE";
}

/**
 * The artifact must belong to this order and still describe its property.
 *
 * An artifact whose `source_order_id` disagrees, or whose fingerprint no longer
 * matches the order's current property inputs, is untrusted for delivery: the
 * packet would assert something about a property the order no longer names.
 */
function artifactBindingBlocker(
  artifact: ArtifactRow,
  order: OrderRow,
): string | null {
  if (artifact.sourceOrderId !== order.id)
    return "ARTIFACT_SOURCE_ORDER_MISMATCH";
  const fingerprint = artifact.propertyBindingFingerprint;
  if (typeof fingerprint !== "string" || fingerprint.trim() === "")
    return "PROPERTY_BINDING_UNVERIFIED";
  const binding = classifyPropertyBinding({
    storedFingerprint: fingerprint,
    orderId: order.id,
    propertyPin: order.propertyPin,
    propertyAddress: order.propertyAddress,
  });
  // Only an affirmative match authorizes a send. ABSENT/UNVERIFIABLE mean we
  // cannot show the packet describes this order's property, which is a refusal.
  if (binding !== "MATCHES") return "PROPERTY_BINDING_UNVERIFIED";
  return null;
}

export function createPrismaT2DeliveryStore(
  client: T2DeliveryClient,
): T2DeliveryStore {
  return {
    async claim(input) {
      if (!t2DeliveryEnabled(process.env)) return false;
      // A duration outside the bounds is a caller error, refused before any
      // database work rather than clamped into something that looks fine.
      if (
        !Number.isInteger(input.leaseMs) ||
        input.leaseMs < T2_MIN_LEASE_MS ||
        input.leaseMs > T2_MAX_LEASE_MS
      ) {
        return false;
      }
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
        // Only a state a send could legally begin from may be leased.
        // DELIVERY_PENDING, PROVIDER_ACCEPTED and DELAYED are all unresolved —
        // a provider still holds a message in each — so none is claimable.
        if (summary.status !== "ARTIFACT_READY") return false;

        // The database's wall clock, read AFTER the locks above, decides both
        // whether the incumbent lease has expired and when ours will. A
        // caller-supplied instant could reclaim a live lease simply by running
        // fast; transaction-start time could treat an incumbent lease that
        // expired during our lock wait as still live.
        const trustedNow = await readTrustedNow(tx);
        if (trustedNow === "") return false;
        const nowMs = Date.parse(trustedNow);
        if (!Number.isFinite(nowMs)) return false;
        const expiresAt = new Date(nowMs + input.leaseMs);

        const { decision } = evaluateLease({
          lease: leaseSnapshot(summary),
          now: trustedNow,
          requester: input.owner,
          requesterToken: input.token,
        });
        if (decision !== "CLAIMABLE" && decision !== "EXPIRED_RECLAIMABLE")
          return false;

        // The status AND lease predicates are repeated in the write so the claim
        // stays conditional even if a future edit weakens the reads above: a
        // lease that is live and belongs to someone else is never overwritten.
        const updated = await tx.$executeRaw(
          Prisma.sql`UPDATE "ot_fulfillment"
                     SET "lease_owner" = ${input.owner}, "lease_token" = ${input.token},
                         "lease_expires_at" = ${expiresAt}
                     WHERE "id" = ${input.fulfillmentId}
                       AND "status"::text = 'ARTIFACT_READY'
                       AND ("lease_owner" IS NULL
                            OR "lease_expires_at" IS NULL
                            OR "lease_expires_at" <= ${new Date(nowMs)}
                            OR ("lease_owner" = ${input.owner}
                                AND "lease_token" = ${input.token}))`,
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

          const trustedNow = await readTrustedNow(tx);
          if (trustedNow === "")
            return { ok: false, blocker: "UNTRUSTED_CLOCK" };

          // The caller must still hold the lease, measured against the database
          // clock. An expired holder and a thief are refused identically: what
          // authorizes an attempt is the row, not the object in their memory.
          if (!leaseHeldBy(summary, input.owner, input.token, trustedNow))
            return { ok: false, blocker: "LEASE_NOT_HELD" };

          // A delivery sends the CURRENT artifact — the highest bound version.
          // It never regenerates and never reaches for an older version.
          const artifacts = await tx.$queryRaw<ArtifactRow[]>(
            CURRENT_ARTIFACT_SQL(input.fulfillmentId),
          );
          const artifact = artifacts[0];
          if (!artifact) return { ok: false, blocker: "ARTIFACT_NOT_FOUND" };

          // Untrusted artifact/property drift is refused here too, not only at
          // the pre-send gate: an attempt that could never legitimately be sent
          // must not become a durable record that a send was requested.
          const drift = artifactBindingBlocker(artifact, order);
          if (drift !== null) return { ok: false, blocker: drift };

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

          // Advance only from the exact revision the decision was made against,
          // and only while this caller's lease is still live in the row itself.
          const advanced = await tx.$executeRaw(
            Prisma.sql`UPDATE "ot_fulfillment"
                       SET "status" = 'DELIVERY_PENDING',
                           "status_revision" = ${plan.expectedStatusRevision + 1},
                           "attempt_count" = ${plan.attemptNumber}
                       WHERE "id" = ${input.fulfillmentId}
                         AND "status"::text = ${plan.fromStatus}
                         AND "status_revision" = ${plan.expectedStatusRevision}
                         AND "lease_owner" = ${input.owner}
                         AND "lease_token" = ${input.token}
                         AND "lease_expires_at" > ${new Date(trustedNow)}`,
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
            sourceOrderId: order.id,
            propertyBindingFingerprint:
              artifact.propertyBindingFingerprint as string,
            idempotencyKey: plan.idempotencyKey,
            provider: plan.provider,
            statusRevision: plan.expectedStatusRevision + 1,
          };
        },
      ).catch(unwind) as Promise<PersistAttemptOutcome>;
    },

    /**
     * The gate immediately before a provider call.
     *
     * It repeats every authority the persist already checked, because all of
     * them can change during the asynchronous gap the durable-attempt ordering
     * deliberately creates, and adds the one thing the persist could not: that
     * THIS attempt row still exists, is still the pending one, and has not
     * already been resolved by anything else.
     *
     * It is read-only on purpose. A refusal here must leave the attempt exactly
     * as it was — unresolved — because writing a failure for a send that never
     * happened is how a duplicate delivery gets authorized later.
     */
    async assertSendable(input) {
      if (!t2DeliveryEnabled(process.env))
        return { ok: false, blocker: "FLAG_DISABLED" };

      return client.$transaction(
        async (tx): Promise<AssertSendableOutcome> => {
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

          // Exactly the state the persist left behind, at exactly the revision
          // and attempt count it left. Anything else means something else has
          // acted on this fulfillment since, so this send is not ours to make.
          if (summary.status !== "DELIVERY_PENDING")
            return { ok: false, blocker: "NOT_PENDING_SEND" };
          if (summary.statusRevision !== input.statusRevision)
            return { ok: false, blocker: "DELIVERY_ATTEMPT_CONFLICT" };
          if (summary.attemptCount !== input.attemptNumber)
            return { ok: false, blocker: "DELIVERY_ATTEMPT_CONFLICT" };

          const trustedNow = await readTrustedNow(tx);
          if (trustedNow === "")
            return { ok: false, blocker: "UNTRUSTED_CLOCK" };
          if (!leaseHeldBy(summary, input.owner, input.token, trustedNow))
            return { ok: false, blocker: "LEASE_NOT_HELD" };

          const artifacts = await tx.$queryRaw<ArtifactRow[]>(
            CURRENT_ARTIFACT_SQL(input.fulfillmentId),
          );
          const artifact = artifacts[0];
          if (!artifact) return { ok: false, blocker: "ARTIFACT_NOT_FOUND" };
          if (
            artifact.version !== input.artifactVersion ||
            artifact.artifactSha256 !== input.artifactSha256
          ) {
            return { ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" };
          }
          // Drift since the persist is a refusal, and so is drift away from the
          // fingerprint the attempt was persisted against.
          const drift = artifactBindingBlocker(artifact, order);
          if (drift !== null) return { ok: false, blocker: drift };
          if (
            artifact.propertyBindingFingerprint !==
            input.propertyBindingFingerprint
          ) {
            return { ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" };
          }

          const attempts = await tx.$queryRaw<AttemptRow[]>(
            Prisma.sql`SELECT "id", "attempt_number" AS "attemptNumber",
                              "artifact_version" AS "artifactVersion",
                              "idempotency_key" AS "idempotencyKey", "provider",
                              "provider_accepted_at" AS "providerAcceptedAt",
                              "failed_at" AS "failedAt"
                       FROM "ot_delivery_attempt"
                       WHERE "fulfillment_id" = ${input.fulfillmentId}
                         AND "attempt_number" = ${input.attemptNumber}`,
          );
          const attempt = attempts[0];
          if (!attempt) return { ok: false, blocker: "ATTEMPT_NOT_FOUND" };
          if (
            attempt.id !== input.attemptId ||
            attempt.attemptNumber !== input.attemptNumber ||
            attempt.idempotencyKey !== input.idempotencyKey ||
            attempt.provider !== input.provider ||
            attempt.artifactVersion !== input.artifactVersion
          ) {
            return { ok: false, blocker: "ATTEMPT_IDENTITY_MISMATCH" };
          }
          // An attempt that already carries an outcome has been resolved by
          // something else; sending again would be a duplicate, not a retry.
          if (attempt.providerAcceptedAt !== null || attempt.failedAt !== null)
            return { ok: false, blocker: "ATTEMPT_ALREADY_RESOLVED" };

          // Re-read last, after every await, so a withdrawal that lands while
          // this transaction waited still denies the send.
          if (!t2DeliveryEnabled(process.env))
            return { ok: false, blocker: "FLAG_DISABLED" };
          return { ok: true };
        },
      );
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
