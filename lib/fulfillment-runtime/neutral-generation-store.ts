import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NEUTRAL_REPORT_COMMERCE_POLICY } from "@/lib/commerce/neutral-report-policy";
import { neutralPrisma } from "@/lib/fulfillment-runtime/neutral-db";
import { trustedPaymentAuthority } from "@/lib/fulfillment-runtime/payment-authority";
import type {
  NeutralGenerationClaim,
  NeutralGenerationProduction,
  NeutralGenerationReasonCode,
  NeutralGenerationStore,
} from "@/lib/fulfillment-runtime/neutral-generation-worker";

type Db = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

const db = new Proxy({} as Db, {
  get(_target, key) {
    const client = neutralPrisma() as unknown as Record<PropertyKey, unknown>;
    const value = client[key];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
const authority = (orderId?: string) => Prisma.sql`
  ${orderId ? Prisma.sql`o."id"=${orderId} AND` : Prisma.empty}
  o."tier"='T2' AND o."status"='PAID'
  AND o."settledAmountCents"=6900 AND lower(o."settledCurrency")='usd' AND o."amountPaid"=69
  AND o."propertyPin" ~ '^[0-9]{14}$'
  AND o."checkoutPriceId" IS NOT NULL AND o."checkoutProductId" IS NOT NULL
  AND r."checkout_price_id"=o."checkoutPriceId" AND r."checkout_product_id"=o."checkoutProductId"
  AND r."policy_version"=${NEUTRAL_REPORT_COMMERCE_POLICY.version}
  AND r."reservation_key"='neutral-order-binding/' || encode(sha256(convert_to(
    'orderId:' || length(o."id")::text || ':' || o."id" || '|policy:' || r."policy_version", 'UTF8'
  )), 'hex')
  AND r."property_fingerprint"=encode(sha256(
    convert_to('ot-neutral-property/v1', 'UTF8') || decode('00', 'hex') || convert_to(o."propertyPin", 'UTF8')
  ), 'hex')
  AND r."status" IN ('RESERVED','STAGED','PROMOTED')
  AND ${trustedPaymentAuthority("o", true)}
`;

export function createNeutralGenerationStore(
  client: Db,
): NeutralGenerationStore {
  return {
    /**
     * Durable, idempotent enqueue of the single work row for an order.
     *
     * The table carries two unique constraints — `(order_id)` and
     * `(reservation_id)` — and a reservation is 1:1 with an order, so two
     * concurrent calls for the same order propose an identical value for both.
     * `ON CONFLICT` resolves on one arbiter index only; a conflict detected on
     * any other unique index is raised as `23505` rather than routed to the
     * `DO UPDATE` path. Two callers that both get past the arbiter pre-check
     * therefore reach speculative insertion together and one of them raises on
     * `ot_neutral_generation_reservation_key`. That is reachable on the
     * ordinary production path: a duplicate Stripe delivery does not hold the
     * event claim, and two distinct events for one order can land on two
     * instances at once.
     *
     * The fix serialises callers for the same order on a transaction-scoped
     * advisory lock taken in a materialised CTE, which is evaluated before any
     * tuple can reach the INSERT. Every statement here runs in autocommit, so
     * the lock is held for exactly this statement and released on commit. A
     * second caller blocks until the first has committed; its arbiter
     * pre-check then finds the committed row and takes the `DO UPDATE` path,
     * so speculative insertion — and with it the non-arbiter unique index —
     * is never reached. The pre-check reads through a dirty snapshot rather
     * than the statement snapshot, which is why the row is found and
     * `RETURNING` yields it even though the statement's own snapshot predates
     * the other transaction's commit. This is deliberately not a
     * CTE/`DO NOTHING` pattern, which would return zero rows in exactly that
     * situation.
     *
     * Fail-closed binding: the `DO UPDATE` is guarded on the existing row
     * agreeing with the proposed reservation. If a work row is already bound
     * to a different reservation the statement returns no row and the caller
     * is refused; the binding is never silently rewritten. Neither unique
     * constraint is weakened, and no error is caught or retried.
     */
    async ensure(orderId) {
      if (!orderId || orderId.length > 128) return null;
      const rows = await client.$queryRaw<Array<{ workId: string }>>(Prisma.sql`
        WITH serialized AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(
            'ot-neutral-generation-work/' || ${orderId}, 0)) AS "held"
        )
        INSERT INTO "ot_neutral_generation_work" ("id","order_id","reservation_id")
        SELECT ${randomUUID()},o."id",r."id"
        FROM "serialized" s,"ot_neutral_runtime_order" o
        JOIN "ot_neutral_report_reservation" r ON r."order_id"=o."id"
        WHERE ${authority(orderId)}
        ON CONFLICT ("order_id") DO UPDATE SET "order_id"=EXCLUDED."order_id"
          WHERE "ot_neutral_generation_work"."reservation_id"=EXCLUDED."reservation_id"
        RETURNING "id" AS "workId"`);
      return rows[0] ?? null;
    },

    async claim(input) {
      const rows = await client.$queryRaw<NeutralGenerationClaim[]>(Prisma.sql`
        WITH candidate AS (
          SELECT "id","status_revision" FROM "ot_neutral_generation_work"
          WHERE "id"=${input.workId}
            AND ("status" IN ('PENDING','RETRY_REQUIRED') OR ("status"='CLAIMED' AND "lease_expires_at"<=CURRENT_TIMESTAMP))
        )
        UPDATE "ot_neutral_generation_work" w
        SET "status"='CLAIMED',"status_revision"=w."status_revision"+1,
            "attempt_count"=w."attempt_count"+1,"lease_owner"=${input.owner},
            "lease_token"=${input.token},"lease_expires_at"=${input.expiresAt},
            "reason_code"=NULL,"claimed_at"=CURRENT_TIMESTAMP,
            "production_started_at"=NULL,"updated_at"=CURRENT_TIMESTAMP
        FROM candidate c,"ot_neutral_report_reservation" r,"ot_neutral_runtime_order" o
        WHERE w."id"=c."id" AND w."status_revision"=c."status_revision"
          AND r."id"=w."reservation_id" AND o."id"=w."order_id"
          AND ${authority()}
          AND o."id"=w."order_id"
        RETURNING w."id" AS "workId",w."status_revision" AS "revision"`);
      return rows[0] ?? null;
    },

    async beginProduction(input) {
      const rows = await client.$queryRaw<NeutralGenerationProduction[]>(
        Prisma.sql`
        UPDATE "ot_neutral_generation_work" w
        SET "status"='PRODUCING',"status_revision"=w."status_revision"+1,
            "production_started_at"=CURRENT_TIMESTAMP,"updated_at"=CURRENT_TIMESTAMP
        FROM "ot_neutral_report_reservation" r,"ot_neutral_runtime_order" o
        WHERE w."id"=${input.workId} AND w."status"='CLAIMED'
          AND w."status_revision"=${input.revision} AND w."lease_owner"=${input.owner} AND w."lease_token"=${input.token}
          AND w."lease_expires_at">CURRENT_TIMESTAMP
          AND r."id"=w."reservation_id" AND o."id"=w."order_id"
          AND ${authority()} AND o."id"=w."order_id"
        RETURNING w."id" AS "workId",w."order_id" AS "orderId",
          o."propertyPin" AS "propertyPin",w."status_revision" AS "revision"`,
      );
      return rows[0] ?? null;
    },

    async transition(input) {
      const reason = input.reasonCode as NeutralGenerationReasonCode | null;
      const count = await client.$executeRaw(Prisma.sql`
        UPDATE "ot_neutral_generation_work"
        SET "status"=CAST(${input.status} AS "OTNeutralGenerationStatus"),"status_revision"="status_revision"+1,
            "lease_owner"=NULL,"lease_token"=NULL,"lease_expires_at"=NULL,
            "reason_code"=${reason},"completed_at"=CASE WHEN ${input.status}='COMPLETE' THEN CURRENT_TIMESTAMP ELSE "completed_at" END,
            "updated_at"=CURRENT_TIMESTAMP
        WHERE "id"=${input.workId} AND "status"='PRODUCING' AND "status_revision"=${input.revision}
          AND "lease_owner"=${input.owner} AND "lease_token"=${input.token}`);
      return count === 1;
    },

    async candidates(input) {
      const limit = Number.isInteger(input.limit)
        ? Math.max(1, Math.min(input.limit, 10))
        : 10;
      const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH selected AS MATERIALIZED (
          SELECT w."id",w."status" FROM "ot_neutral_generation_work" w
          WHERE w."status" IN ('PENDING','RETRY_REQUIRED')
            OR (w."status"='CLAIMED' AND w."lease_expires_at"<=CURRENT_TIMESTAMP)
            OR (w."status"='PRODUCING' AND w."lease_expires_at"<=CURRENT_TIMESTAMP)
          ORDER BY w."updated_at",w."id" LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        ), held AS (
          UPDATE "ot_neutral_generation_work" w
          SET "status"='RECONCILIATION_REQUIRED',"status_revision"=w."status_revision"+1,
              "lease_owner"=NULL,"lease_token"=NULL,"lease_expires_at"=NULL,
              "reason_code"='PRODUCTION_OUTCOME_UNKNOWN',"updated_at"=CURRENT_TIMESTAMP
          FROM selected s
          WHERE w."id"=s."id" AND s."status"='PRODUCING'
          RETURNING w."id"
        )
        SELECT w."id" FROM selected s
        JOIN "ot_neutral_generation_work" w ON w."id"=s."id"
        JOIN "ot_neutral_report_reservation" r ON r."id"=w."reservation_id"
        JOIN "ot_neutral_runtime_order" o ON o."id"=w."order_id"
        WHERE s."status"<>'PRODUCING' AND ${authority()} AND o."id"=w."order_id"
          AND (SELECT count(*) FROM held)>=0
        ORDER BY w."updated_at",w."id"`);
      return rows.map((row) => row.id);
    },
  };
}

export const prismaNeutralGenerationStore = createNeutralGenerationStore(db);
