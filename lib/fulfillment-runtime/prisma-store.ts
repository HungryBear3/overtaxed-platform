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

type PrismaFulfillmentDelegate = {
  upsert(input: unknown): Promise<FulfillmentRow>;
  findUnique(input: unknown): Promise<FulfillmentRow | null>;
};

type PrismaLike = {
  oTFulfillment: PrismaFulfillmentDelegate;
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
      const identity = {
        orderId_kind: {
          orderId: input.orderId,
          kind: input.kind,
        },
      };

      try {
        const row = await client.oTFulfillment.upsert({
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

        // PostgreSQL can surface P2002 when two create-only upserts race. Treat
        // it as convergence only after reading the exact compound-key winner.
        const winner = await client.oTFulfillment.findUnique({
          where: identity,
          select: { id: true, status: true },
        });
        if (!winner) throw error;
        return result(winner);
      }
    },
  };
}

export const prismaT2FulfillmentKickoffStore =
  createPrismaT2FulfillmentKickoffStore(prisma as unknown as PrismaLike);
