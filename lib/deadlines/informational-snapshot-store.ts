import "server-only";
import { createInformationalRefreshBarrier, createInformationalRefreshBarrierReader } from "./informational-refresh-barrier";
import { informationalReadEnabled, informationalRefreshEnabled as enabled } from "./informational-flags";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { decodeInformationalSnapshot, MAX_INFORMATIONAL_SNAPSHOT_LENGTH } from "./informational-snapshot";

export const INFORMATIONAL_SNAPSHOT_KEY = "ot:informational-assessor:2026:v1";
/** SELECT-only capability: no transaction, execute or lock surface. */
export type InformationalSnapshotReadClient = { $queryRaw<T>(sql: Prisma.Sql): Promise<T> };
type Reader = InformationalSnapshotReadClient;
type Transaction = Reader & { $executeRaw(sql: Prisma.Sql): Promise<number> };
export type InformationalSnapshotClient = Reader & {
  $transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
};
type Stored = { value: string };
const readSql = () => Prisma.sql`SELECT left("value", ${MAX_INFORMATIONAL_SNAPSHOT_LENGTH + 1}) AS value
  FROM "SystemConfig" WHERE "key" = ${INFORMATIONAL_SNAPSHOT_KEY} LIMIT 1`;

/** Decoded read of the dedicated namespace; read-predicate gated and rechecked after the await. */
function createInformationalSnapshotRead(client: Reader) {
  return async (now: Date) => {
    if (!informationalReadEnabled()) return null;
    try {
      const rows = await client.$queryRaw<Stored[]>(readSql());
      return informationalReadEnabled() && rows[0] ? decodeInformationalSnapshot(rows[0].value, now) : null;
    } catch { return null; }
  };
}

/** Dedicated informational namespace; never touches the bundled commerce snapshot. */
export function createInformationalSnapshotStore(client: InformationalSnapshotClient) {
  return {
    read: createInformationalSnapshotRead(client),
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

/** Read-only capability: decoded snapshot only when the digest-ready barrier binds its exact bytes. */
function barrierCheckedRead(client: Reader) {
  const read = createInformationalSnapshotRead(client);
  const barrier = createInformationalRefreshBarrierReader(client, INFORMATIONAL_SNAPSHOT_KEY);
  return async (now: Date) => {
    const snapshot = await read(now);
    return snapshot && await barrier.permits(JSON.stringify(snapshot)) ? snapshot : null;
  };
}

/**
 * Public/detail read path. Exposes only `read`, over a client narrowed to
 * `$queryRaw` (SELECT statements built here). Allowed under the refresh flag or
 * Preview read-only; never offers publish, begin, complete or locks.
 */
export async function informationalSnapshotReader() {
  if (!informationalReadEnabled()) return null;
  try {
    const { prisma } = await import("@/lib/db");
    if (!informationalReadEnabled()) return null;
    const db = prisma as unknown as Reader;
    const client: Reader = { $queryRaw: sql => db.$queryRaw(sql) };
    return { read: barrierCheckedRead(client) };
  } catch { return null; }
}

/** Refresh (write) capability. Refused while Preview read-only is active. */
export async function informationalSnapshotStore() {
  if (!enabled()) return null;
  try {
    const { prisma } = await import("@/lib/db");
    if (!enabled()) return null;
    const client = prisma as unknown as InformationalSnapshotClient;
    const store = createInformationalSnapshotStore(client);
    const barrier = createInformationalRefreshBarrier(client, INFORMATIONAL_SNAPSHOT_KEY);
    return { ...store, begin: barrier.begin, complete: barrier.complete, read: barrierCheckedRead(client) };
  } catch { return null; }
}
