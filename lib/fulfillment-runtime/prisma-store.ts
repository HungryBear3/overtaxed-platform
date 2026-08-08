import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type {
  T2FulfillmentKickoffInput,
  T2FulfillmentKickoffStore,
} from "@/lib/fulfillment-runtime/kickoff";
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types";

type FulfillmentRow = {
  id: string;
  status: string;
};

type AuthoritativeOrderRow = {
  id: string;
  status: string;
  tier: string;
};

type PrismaFulfillmentDelegate = {
  upsert(input: unknown): Promise<FulfillmentRow>;
  findUnique(input: unknown): Promise<FulfillmentRow | null>;
};

type PrismaTransactionLike = {
  $queryRaw<T>(query: unknown): Promise<T>;
  oTFulfillment: PrismaFulfillmentDelegate;
};

type PrismaLike = {
  $transaction<T>(
    work: (transaction: PrismaTransactionLike) => Promise<T>,
  ): Promise<T>;
};

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function result(row: FulfillmentRow) {
  return { id: row.id, status: row.status as OTFulfillmentStatus };
}

export function createPrismaT2FulfillmentKickoffStore(
  client: PrismaLike,
): T2FulfillmentKickoffStore {
  return {
    async ensureInitial(input: T2FulfillmentKickoffInput) {
      return client.$transaction(async (transaction) => {
        // Lock the parent row and evaluate its current state in the same
        // transaction as the create-only upsert. A concurrent terminal update
        // that wins the lock is therefore visible before evidence can be made.
        const orders = await transaction.$queryRaw<AuthoritativeOrderRow[]>(
          Prisma.sql`SELECT "id", "status", "tier" FROM "ot_order" WHERE "id" = ${input.orderId} FOR UPDATE`,
        );
        const order = orders[0];
        if (order?.status !== "PAID" || order.tier !== "T2") return null;

        const identity = {
          orderId_kind: {
            orderId: input.orderId,
            kind: input.kind,
          },
        };

        try {
          const row = await transaction.oTFulfillment.upsert({
            where: identity,
            create: {
              orderId: input.orderId,
              kind: input.kind,
              status: input.status,
              lastReasonCode: input.reasonCode,
            },
            update: {},
            select: { id: true, status: true },
          });
          return result(row);
        } catch (error) {
          if (!isPrismaUniqueError(error)) throw error;

          // Treat a uniqueness race as convergence only after reading the exact
          // compound-key winner inside this same transaction.
          const winner = await transaction.oTFulfillment.findUnique({
            where: identity,
            select: { id: true, status: true },
          });
          if (!winner) throw error;
          return result(winner);
        }
      });
    },
  };
}

export const prismaT2FulfillmentKickoffStore =
  createPrismaT2FulfillmentKickoffStore(prisma as unknown as PrismaLike);
