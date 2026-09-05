/**
 * The atomic lease claim behind T2 artifact orchestration.
 *
 * This is the only new module in this slice that writes, and it writes exactly
 * three columns: `lease_owner`, `lease_token`, `lease_expires_at`. It never
 * touches `status`, never creates an artifact, delivery attempt or event, and
 * never sends anything. Moving `ARTIFACT_PENDING` to `ARTIFACT_READY` remains
 * the binder's sole authority.
 *
 * Concurrency contract, matching the binder's so the two cannot deadlock: lock
 * the authoritative `ot_order` row FOR UPDATE first, then the `ot_fulfillment`
 * row, and re-verify both inside that lock. Every claimant for one order
 * therefore serialises on the same lock in the same order, and a concurrent
 * refund or terminal transition that wins the lock is visible before a lease
 * can be taken.
 *
 * The lease DECISION is not reimplemented here: [[evaluateLease]] owns it, so
 * partial or malformed lease metadata stays fail-closed exactly as it does
 * everywhere else.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateLease, type LeaseSnapshot } from "@/lib/fulfillment/lease";

export type T2ArtifactLeaseClaim = {
  orderId: string;
  fulfillmentId: string;
  owner: string;
  token: string;
  /** Strict RFC3339 UTC instant; the same instant the expiry is measured from. */
  now: string;
  expiresAt: Date;
};

export type T2ArtifactLeaseRelease = {
  fulfillmentId: string;
  owner: string;
  token: string;
};

export interface T2ArtifactOrchestrationStore {
  /** True only if this caller now holds the lease on that exact row. */
  claim(input: T2ArtifactLeaseClaim): Promise<boolean>;
  /** Compare-and-set release. False when the lease was not ours to clear. */
  release(input: T2ArtifactLeaseRelease): Promise<boolean>;
}

type OrderRow = { id: string; status: string; tier: string };
type FulfillmentRow = {
  id: string;
  order_id: string;
  kind: string;
  status: string;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
};

/**
 * The narrow slice of the Prisma client this store uses. Exported so a test can
 * build a correctly typed fake instead of casting a whole client.
 */
export type T2ArtifactOrchestrationTransaction = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};
export type T2ArtifactOrchestrationClient = {
  $transaction<T>(
    work: (tx: T2ArtifactOrchestrationTransaction) => Promise<T>,
  ): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

/**
 * A wholly absent lease is `null`; anything else is handed to `evaluateLease`
 * as-is, including partial rows. A null owner or token, or an expiry that is
 * not a strict UTC instant, is INVALID there and therefore not reclaimable.
 */
function leaseSnapshot(row: FulfillmentRow): LeaseSnapshot {
  if (
    row.lease_owner === null &&
    row.lease_token === null &&
    row.lease_expires_at === null
  ) {
    return null;
  }
  return {
    owner: row.lease_owner as string,
    token: row.lease_token as string,
    expiresAt:
      row.lease_expires_at instanceof Date
        ? row.lease_expires_at.toISOString()
        : (row.lease_expires_at as unknown as string),
  };
}

export function createPrismaT2ArtifactOrchestrationStore(
  client: T2ArtifactOrchestrationClient,
): T2ArtifactOrchestrationStore {
  return {
    async claim(input) {
      return client.$transaction(async (tx) => {
        const orders = await tx.$queryRaw<OrderRow[]>(
          Prisma.sql`SELECT "id", "status", "tier" FROM "ot_order" WHERE "id" = ${input.orderId} FOR UPDATE`,
        );
        const order = orders[0];
        if (order?.status !== "PAID" || order.tier !== "T2") return false;

        const rows = await tx.$queryRaw<FulfillmentRow[]>(
          Prisma.sql`SELECT "id", "order_id", "kind"::text AS "kind", "status"::text AS "status",
                            "lease_owner", "lease_token", "lease_expires_at"
                     FROM "ot_fulfillment" WHERE "id" = ${input.fulfillmentId} FOR UPDATE`,
        );
        const row = rows[0];
        if (
          !row ||
          row.order_id !== input.orderId ||
          row.kind !== "T2_APPEAL_EVIDENCE" ||
          row.status !== "ARTIFACT_PENDING"
        ) {
          return false;
        }

        const { decision } = evaluateLease({
          lease: leaseSnapshot(row),
          now: input.now,
          requester: input.owner,
          requesterToken: input.token,
        });
        if (decision !== "CLAIMABLE" && decision !== "EXPIRED_RECLAIMABLE") {
          return false;
        }

        // The status predicate is repeated in the write so the claim is still
        // conditional even if a future edit weakens the read above.
        const updated = await tx.$executeRaw(
          Prisma.sql`UPDATE "ot_fulfillment"
                     SET "lease_owner" = ${input.owner}, "lease_token" = ${input.token},
                         "lease_expires_at" = ${input.expiresAt}
                     WHERE "id" = ${input.fulfillmentId} AND "status"::text = 'ARTIFACT_PENDING'`,
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
  };
}

export const prismaT2ArtifactOrchestrationStore =
  createPrismaT2ArtifactOrchestrationStore(
    prisma as unknown as T2ArtifactOrchestrationClient,
  );
