import "server-only";
import { createInformationalRefreshBarrier } from "./informational-refresh-barrier";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decodeInformationalSnapshot, MAX_INFORMATIONAL_SNAPSHOT_LENGTH } from "./informational-snapshot";

export const INFORMATIONAL_SNAPSHOT_KEY = "ot:informational-assessor:2026:v1";
const enabled = () => process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true";
type Reader = { $queryRaw<T>(sql: Prisma.Sql): Promise<T> };
type Transaction = Reader & { $executeRaw(sql: Prisma.Sql): Promise<number> };
export type InformationalSnapshotClient = Reader & {
  $transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
};
type Stored = { value: string };
const readSql = () => Prisma.sql`SELECT left("value", ${MAX_INFORMATIONAL_SNAPSHOT_LENGTH + 1}) AS value
  FROM "SystemConfig" WHERE "key" = ${INFORMATIONAL_SNAPSHOT_KEY} LIMIT 1`;

/** Dedicated informational namespace; never touches the bundled commerce snapshot. */
export function createInformationalSnapshotStore(client: InformationalSnapshotClient) {
  return {
    async read(now: Date) {
      if (!enabled()) return null;
      try {
        const rows = await client.$queryRaw<Stored[]>(readSql());
        return enabled() && rows[0] ? decodeInformationalSnapshot(rows[0].value, now) : null;
      } catch { return null; }
    },
    async publish(raw: string): Promise<"PUBLISHED" | "UNCHANGED" | "REFUSED"> {
      if (!enabled() || raw.length > MAX_INFORMATIONAL_SNAPSHOT_LENGTH) return "REFUSED";
      try {
        return await client.$transaction(async tx => {
          // Serialize this key even before its first row exists. All owned writers use this lock.
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${INFORMATIONAL_SNAPSHOT_KEY}))::text AS locked`);
          const clocks = await tx.$queryRaw<{ now: string }[]>(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now`);
          const snapshot = decodeInformationalSnapshot(raw, new Date(Number(clocks[0]?.now)));
          if (!enabled() || !snapshot) return "REFUSED";
          const canonical = JSON.stringify(snapshot);
          const previous = (await tx.$queryRaw<Stored[]>(readSql()))[0];
          if (previous) {
            // Validate old structure at its own retrieval instant, not by pretending it is fresh now.
            const priorTime = new Date(JSON.parse(previous.value)?.sources?.assessor?.retrievedAt);
            const prior = decodeInformationalSnapshot(previous.value, priorTime);
            if (!prior) return "REFUSED";
            const nextTime = Date.parse(snapshot.sources.assessor!.retrievedAt);
            if (nextTime < priorTime.getTime()) return "REFUSED";
            if (nextTime === priorTime.getTime()) return JSON.stringify(prior) === canonical ? "UNCHANGED" : "REFUSED";
          }
          if (!enabled()) return "REFUSED";
          await tx.$executeRaw(Prisma.sql`INSERT INTO "SystemConfig" ("id", "key", "value", "createdAt", "updatedAt")
            VALUES (${randomUUID()}, ${INFORMATIONAL_SNAPSHOT_KEY}, ${canonical}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`);
          return "PUBLISHED";
        });
      } catch { return "REFUSED"; }
    },
  };
}

export async function informationalSnapshotStore() {
  if (!enabled()) return null;
  try {
    const { prisma } = await import("@/lib/db");
    if (!enabled()) return null;
    const client = prisma as unknown as InformationalSnapshotClient;
    const store = createInformationalSnapshotStore(client);
    const barrier = createInformationalRefreshBarrier(client, INFORMATIONAL_SNAPSHOT_KEY);
    return { ...store, begin: barrier.begin, complete: barrier.complete, async read(now: Date) {
      const snapshot = await store.read(now);
      return snapshot && await barrier.permits(JSON.stringify(snapshot)) ? snapshot : null;
    } };
  } catch { return null; }
}
