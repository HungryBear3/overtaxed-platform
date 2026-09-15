/**
 * Bounded operator recovery for T2 delivery.
 *
 * There are exactly two things an operator may do here, and a long list of
 * things they may not.
 *
 * **RECONCILE_PROVIDER_CALLBACKS** re-offers provider evidence this deployment
 * already holds to the message id now bound to the current attempt. It is the
 * manual half of the send/callback race: the automatic pass runs the moment an
 * accepted send records its id, and this exists for the case where that pass
 * lost its process, or where an event arrived after it. It writes no new
 * evidence, invents nothing, and can only ever apply events that arrived
 * authenticated and were stored sanitized.
 *
 * It is bounded to a fulfillment whose send is still UNRESOLVED — see
 * [[RECONCILABLE_STATUSES]]. A DELIVERED or terminal summary already holds the
 * evidence a replay would be looking for, so a pass from one cannot change
 * anything and is refused rather than run as an expensive no-op.
 *
 * **RESOLVE_UNRESOLVED_SEND** ends an unresolved send by recording it FAILED. It
 * requires the operator to assert, explicitly and on the record, that they have
 * definite evidence the provider is no longer trying. That assertion is not
 * something this code can verify, so it is attributed to the acting admin in the
 * append-only admin event log rather than inferred. A delayed callback is NOT
 * evidence the provider stopped; neither is an expired lease.
 *
 * What is deliberately absent, and must stay absent:
 *
 *   - no resend. The result is terminal FAILED, which `decideDeliverySend`
 *     refuses, so nothing downstream can turn this into a second delivery;
 *   - no regeneration. A delivery problem is never an artifact problem, and the
 *     county/eligibility/deadline gates that produce a packet are not reachable
 *     from here at all;
 *   - no re-minting. Revocation ends the credential this attempt issued; it
 *     never issues another;
 *   - no legacy replay. Orders excluded from artifact binding as legacy or
 *     manual-recovery rows are not reachable: recovery acts only on an existing
 *     fulfillment of an existing paid T2 order, and creates nothing;
 *   - no "retry because the lease expired". Lease expiry says a worker stopped,
 *     not that a message did.
 *
 * Every action is compare-and-set against an EXACT order, fulfillment, status
 * and revision supplied by the caller, so an operator acting on a stale console
 * view changes nothing.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { t2DeliveryRecoveryEnabled } from "@/lib/fulfillment/flag";
import { RESEND_PROVIDER } from "@/lib/fulfillment/provider-callbacks";
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";
import { reconcileT2ResendCallbacks } from "@/lib/fulfillment-runtime/t2-resend-events";

export type DeliveryRecoveryAction =
  | "RECONCILE_PROVIDER_CALLBACKS"
  | "RESOLVE_UNRESOLVED_SEND";

export const DELIVERY_RECOVERY_ACTIONS: ReadonlySet<string> = new Set<string>([
  "RECONCILE_PROVIDER_CALLBACKS",
  "RESOLVE_UNRESOLVED_SEND",
]);

/**
 * The statuses a reconciliation pass may be requested from.
 *
 * Every one of them is a state where the send is genuinely UNRESOLVED — no
 * durable evidence yet says what happened to the message — so replaying stored
 * provider evidence can still change the answer:
 *
 *   - DELIVERY_PENDING: a send was requested and nothing has reported back;
 *   - PROVIDER_ACCEPTED: the provider took custody and has not said more;
 *   - DELAYED: the provider is still retrying.
 *
 * DELIVERED and every terminal-lock status are deliberately absent. They already
 * HAVE the evidence, `nextStatusForEvent` refuses to move them, and a pass from
 * one could only spend replay budget and write REFUSED rows. Refusing here says
 * so plainly instead of letting an operator watch a no-op succeed.
 */
export const RECONCILABLE_STATUSES: ReadonlySet<string> = new Set<string>([
  "DELIVERY_PENDING",
  "PROVIDER_ACCEPTED",
  "DELAYED",
]);

/**
 * The bounded reasons an operator may attach to a resolved-as-failed send.
 *
 * A closed subset of the shared allowlist: only codes that can honestly describe
 * "we know this send did not complete and will not". A bounce or a complaint is
 * absent on purpose — those arrive as authenticated provider evidence and are
 * not something an operator types in.
 */
export const RESOLVE_REASON_CODES: ReadonlySet<string> = new Set<string>([
  "PROVIDER_ERROR",
  "TIMEOUT",
  "INVALID_RECIPIENT",
  "MANUAL_REVIEW",
]);

/**
 * The operator's assertion that they hold definite evidence no message is still
 * in flight. Spelled out as a literal the caller must send, so resolving cannot
 * happen by omission or by a default.
 */
export const NO_IN_FLIGHT_EVIDENCE = "NO_IN_FLIGHT_CONFIRMED";

export type DeliveryRecoveryInput = {
  orderId: string;
  actorUserId: string;
  action: DeliveryRecoveryAction;
  expectedStatus: OTFulfillmentStatus;
  expectedStatusRevision: number;
  /** Required, and checked, for RESOLVE_UNRESOLVED_SEND only. */
  evidence?: string;
  reasonCode?: string;
};

export type DeliveryRecoveryResult =
  | {
      ok: true;
      action: "RECONCILE_PROVIDER_CALLBACKS";
      examined: number;
      applied: number;
      stillUnmatched: number;
      /** Read but not ours to act on: claimed elsewhere, resolved, or spent. */
      skipped: number;
    }
  | {
      ok: true;
      action: "RESOLVE_UNRESOLVED_SEND";
      status: "FAILED";
      statusRevision: number;
      revokedCapabilities: number;
    }
  | { ok: false; code: DeliveryRecoveryRefusal };

export type DeliveryRecoveryRefusal =
  | "RECOVERY_DISABLED"
  | "INVALID_ACTION"
  | "INVALID_REASON_CODE"
  | "EVIDENCE_NOT_ASSERTED"
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_T2"
  | "ORDER_NOT_PAID"
  | "NO_FULFILLMENT_SUMMARY"
  | "STALE_STATE"
  | "NOT_UNRESOLVED"
  | "NOT_RECONCILABLE"
  | "ATTEMPT_NOT_FOUND"
  | "NO_BOUND_MESSAGE_ID"
  | "UNTRUSTED_CLOCK";

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
};
type AttemptRow = {
  attemptNumber: number;
  provider: string;
  providerMessageId: string | null;
};

export type RecoveryTransaction = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type RecoveryClient = {
  $transaction<T>(work: (tx: RecoveryTransaction) => Promise<T>): Promise<T>;
};

export type DeliveryRecoveryDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  client?: RecoveryClient;
  reconcile?: typeof reconcileT2ResendCallbacks;
};

function toInstant(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Internal signal: unwind (and roll back) the transaction with a bounded code.
 *
 * Returning a refusal from inside the transaction callback would COMMIT
 * everything written before it. That matters here because the FAILED event and
 * the attempt timestamps are written before the status compare-and-set: losing
 * that CAS and merely returning would leave an orphaned failure event attached
 * to a fulfillment whose status never moved.
 */
class RecoveryRollback extends Error {
  constructor(readonly code: DeliveryRecoveryRefusal) {
    super(code);
    this.name = "RecoveryRollback";
  }
}

/**
 * Read and lock the authoritative context for a recovery action.
 *
 * Same lock ordering as every other store here — order, then fulfillment, then
 * attempt — so recovery cannot deadlock against a concurrent delivery or
 * callback. The caller's expected status and revision are verified INSIDE the
 * lock, which is what makes a stale console view inert rather than dangerous.
 */
async function lockedContext(
  tx: RecoveryTransaction,
  input: DeliveryRecoveryInput,
): Promise<
  | { ok: false; code: DeliveryRecoveryRefusal }
  | {
      ok: true;
      summary: SummaryRow;
      attempt: AttemptRow | null;
      trustedNow: string;
    }
> {
  const orders = await tx.$queryRaw<OrderRow[]>(
    Prisma.sql`SELECT "id", "status", "tier" FROM "ot_order"
               WHERE "id" = ${input.orderId} FOR UPDATE`,
  );
  const order = orders[0];
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
  if (order.tier !== "T2") return { ok: false, code: "ORDER_NOT_T2" };
  if (order.status !== "PAID") return { ok: false, code: "ORDER_NOT_PAID" };

  const summaries = await tx.$queryRaw<SummaryRow[]>(
    Prisma.sql`SELECT "id", "order_id" AS "orderId", "kind"::text AS "kind",
                      "status"::text AS "status",
                      "status_revision" AS "statusRevision",
                      "attempt_count" AS "attemptCount"
               FROM "ot_fulfillment"
               WHERE "order_id" = ${input.orderId}
                 AND "kind" = 'T2_APPEAL_EVIDENCE' FOR UPDATE`,
  );
  const summary = summaries[0];
  if (!summary) return { ok: false, code: "NO_FULFILLMENT_SUMMARY" };
  if (
    summary.status !== input.expectedStatus ||
    summary.statusRevision !== input.expectedStatusRevision
  ) {
    return { ok: false, code: "STALE_STATE" };
  }

  const attempts =
    summary.attemptCount >= 1
      ? await tx.$queryRaw<AttemptRow[]>(
          Prisma.sql`SELECT "attempt_number" AS "attemptNumber", "provider",
                            "provider_message_id" AS "providerMessageId"
                     FROM "ot_delivery_attempt"
                     WHERE "fulfillment_id" = ${summary.id}
                       AND "attempt_number" = ${summary.attemptCount} FOR UPDATE`,
        )
      : [];

  const clock = await tx.$queryRaw<Array<{ now: unknown }>>(TRUSTED_CLOCK_SQL);
  const trustedNow = toInstant(clock[0]?.now);
  if (trustedNow === "") return { ok: false, code: "UNTRUSTED_CLOCK" };

  return { ok: true, summary, attempt: attempts[0] ?? null, trustedNow };
}

/**
 * Perform one bounded recovery action, or refuse with a stable code.
 *
 * Default-off: with OT_T2_DELIVERY_RECOVERY_ENABLED absent this makes no
 * database call at all.
 */
export async function runT2DeliveryRecovery(
  input: DeliveryRecoveryInput,
  deps: DeliveryRecoveryDeps = {},
): Promise<DeliveryRecoveryResult> {
  const env = deps.env ?? process.env;
  if (!t2DeliveryRecoveryEnabled(env))
    return { ok: false, code: "RECOVERY_DISABLED" };
  if (!DELIVERY_RECOVERY_ACTIONS.has(input.action))
    return { ok: false, code: "INVALID_ACTION" };

  const client = deps.client ?? (prisma as unknown as RecoveryClient);

  if (input.action === "RECONCILE_PROVIDER_CALLBACKS") {
    // The lock is taken only to establish that the caller's view is current and
    // to read the bound message id. Reconciliation itself runs in its own
    // transactions afterwards, so this one is short and holds nothing while a
    // potentially long replay proceeds.
    const context = await client.$transaction((tx) => lockedContext(tx, input));
    if (!context.ok) return { ok: false, code: context.code };
    // Bounded to states whose send is still unresolved. `lockedContext` has
    // already proved the caller's expected status and revision match the row, so
    // this is a check on the ROW, not on what the operator typed.
    if (!RECONCILABLE_STATUSES.has(context.summary.status))
      return { ok: false, code: "NOT_RECONCILABLE" };
    const attempt = context.attempt;
    if (!attempt) return { ok: false, code: "ATTEMPT_NOT_FOUND" };
    if (attempt.provider !== RESEND_PROVIDER || !attempt.providerMessageId)
      return { ok: false, code: "NO_BOUND_MESSAGE_ID" };

    const reconcile = deps.reconcile ?? reconcileT2ResendCallbacks;
    const outcome = await reconcile(
      { providerMessageId: attempt.providerMessageId },
      { env },
    );
    return { ok: true, action: "RECONCILE_PROVIDER_CALLBACKS", ...outcome };
  }

  // RESOLVE_UNRESOLVED_SEND.
  if (input.evidence !== NO_IN_FLIGHT_EVIDENCE)
    return { ok: false, code: "EVIDENCE_NOT_ASSERTED" };
  const reasonCode = input.reasonCode ?? "";
  if (!RESOLVE_REASON_CODES.has(reasonCode))
    return { ok: false, code: "INVALID_REASON_CODE" };

  return client.$transaction(async (tx): Promise<DeliveryRecoveryResult> => {
    const context = await lockedContext(tx, input);
    if (!context.ok) return { ok: false, code: context.code };
    const { summary, attempt, trustedNow } = context;

    // Only a send that is genuinely unresolved may be ended this way.
    // PROVIDER_ACCEPTED is NOT unresolved — the provider took custody and is
    // expected to report — and every other status either has no send in flight
    // or is already terminal.
    if (summary.status !== "DELIVERY_PENDING")
      return { ok: false, code: "NOT_UNRESOLVED" };
    if (!attempt) return { ok: false, code: "ATTEMPT_NOT_FOUND" };

    const occurredAt = new Date(trustedNow);
    const sequences = await tx.$queryRaw<Array<{ next: number }>>(
      Prisma.sql`SELECT COALESCE(MAX("sequence"), 0) + 1 AS "next"
                 FROM "ot_delivery_event"
                 WHERE "fulfillment_id" = ${summary.id}`,
    );
    // Locally originated evidence, namespaced so it can never collide with a
    // provider event id and can never be mistaken for one.
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "ot_delivery_event" (
                   "id", "fulfillment_id", "attempt_number", "provider",
                   "provider_event_id", "event_type", "sequence",
                   "occurred_at", "received_at", "reason_code"
                 ) VALUES (
                   ${randomUUID()}, ${summary.id}, ${attempt.attemptNumber},
                   ${attempt.provider},
                   ${`local:recovery:${summary.id}:${attempt.attemptNumber}`},
                   ${"FAILED"}::"OTDeliveryEventType",
                   ${Number(sequences[0]?.next ?? 1)},
                   ${occurredAt}, ${occurredAt}, ${reasonCode}
                 )
                 ON CONFLICT ("provider", "provider_event_id") DO NOTHING`,
    );
    await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_delivery_attempt"
                 SET "failed_at" = COALESCE("failed_at", ${occurredAt}),
                     "reason_code" = COALESCE("reason_code", ${reasonCode})
                 WHERE "fulfillment_id" = ${summary.id}
                   AND "attempt_number" = ${attempt.attemptNumber}`,
    );

    const advanced = await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_fulfillment"
                 SET "status" = 'FAILED', "status_revision" = ${input.expectedStatusRevision + 1},
                     "last_reason_code" = ${reasonCode}
                 WHERE "id" = ${summary.id}
                   AND "status"::text = 'DELIVERY_PENDING'
                   AND "status_revision" = ${input.expectedStatusRevision}`,
    );
    if (advanced !== 1) throw new RecoveryRollback("STALE_STATE");

    // The credential this attempt issued reached no mailbox we can evidence, and
    // FAILED is not a downloadable status anyway. Ending it explicitly means the
    // revocation is on the record with an actor behind it.
    const revoked = await tx.$executeRaw(
      Prisma.sql`UPDATE "ot_packet_download_capability"
                 SET "revoked_at" = ${occurredAt},
                     "revoked_reason_code" = ${"ADMIN_REVOKED"}
                 WHERE "fulfillment_id" = ${summary.id}
                   AND "revoked_at" IS NULL`,
    );

    // Actor-attributed, append-only. The unique (fulfillment, toRevision) means
    // one recovery per revision, so a double-submit cannot write two records.
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "ot_fulfillment_admin_event" (
                   "id", "fulfillment_id", "action", "from_status", "to_status",
                   "from_revision", "to_revision", "reason_code", "actor_user_id",
                   "created_at"
                 ) VALUES (
                   ${randomUUID()}, ${summary.id}, ${"RESOLVE_UNRESOLVED_SEND"},
                   ${"DELIVERY_PENDING"}::"OTFulfillmentStatus",
                   ${"FAILED"}::"OTFulfillmentStatus",
                   ${input.expectedStatusRevision},
                   ${input.expectedStatusRevision + 1},
                   ${reasonCode}, ${input.actorUserId}, ${occurredAt}
                 )`,
    );

    return {
      ok: true,
      action: "RESOLVE_UNRESOLVED_SEND",
      status: "FAILED",
      statusRevision: input.expectedStatusRevision + 1,
      revokedCapabilities: revoked,
    };
  }).catch((error: unknown): DeliveryRecoveryResult => {
    // The rollback signal unwound the transaction, so the event, the attempt
    // timestamps, the revocation and the admin record all went with it.
    if (error instanceof RecoveryRollback) return { ok: false, code: error.code };
    throw error;
  });
}
