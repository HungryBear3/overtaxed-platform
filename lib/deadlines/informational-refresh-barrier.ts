import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { InformationalSnapshotClient } from "./informational-snapshot-store";
const enabled = () => process.env.OT_INFORMATIONAL_DEADLINE_REFRESH_ENABLED === "true";
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
type Marker = { id: string; state: "pending" | "ready"; digest: string | null };
function decode(raw: string): Marker | null {
  try {
    const value = JSON.parse(raw);
    return value && Object.keys(value).sort().join() === "digest,id,state" &&
      typeof value.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) &&
      ((value.state === "pending" && value.digest === null) || (value.state === "ready" && typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest))) ? value : null;
  } catch { return null; }
}
/** A failed attempt stays pending. Only that attempt can bind the persisted complete snapshot. */
export function createInformationalRefreshBarrier(client: InformationalSnapshotClient, snapshotKey: string) {
  const key = `${snapshotKey}:attempt`;
  const read = () => Prisma.sql`SELECT left("value", 300) AS value FROM "SystemConfig" WHERE "key" = ${key} LIMIT 1`;
  const lock = () => Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${snapshotKey}))`;
  return {
    async begin(): Promise<string | null> {
      if (!enabled()) return null;
      const id = randomUUID();
      try {
        return await client.$transaction(async tx => {
          await tx.$queryRaw(lock()); if (!enabled()) return null;
          const raw = JSON.stringify({ id, state: "pending", digest: null });
          await tx.$executeRaw(Prisma.sql`INSERT INTO "SystemConfig" ("id", "key", "value", "createdAt", "updatedAt")
            VALUES (${randomUUID()}, ${key}, ${raw}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`);
          return id;
        });
      } catch { return null; }
    },
    async complete(id: string, raw: string): Promise<boolean> {
      if (!enabled()) return false;
      try {
        return await client.$transaction(async tx => {
          await tx.$queryRaw(lock());
          const marker = decode((await tx.$queryRaw<{ value: string }[]>(read()))[0]?.value);
          if (!enabled() || marker?.id !== id || marker.state !== "pending") return false;
          const actual = (await tx.$queryRaw<{ value: string }[]>(Prisma.sql`SELECT left("value", 100001) AS value
            FROM "SystemConfig" WHERE "key" = ${snapshotKey} LIMIT 1`))[0]?.value;
          if (actual !== raw || !enabled()) return false;
          await tx.$executeRaw(Prisma.sql`UPDATE "SystemConfig" SET "value" = ${JSON.stringify({ id, state: "ready", digest: digest(raw) })},
            "updatedAt" = CURRENT_TIMESTAMP WHERE "key" = ${key}`);
          return true;
        });
      } catch { return false; }
    },
    async permits(raw: string): Promise<boolean> {
      if (!enabled()) return false;
      try {
        const marker = decode((await client.$queryRaw<{ value: string }[]>(read()))[0]?.value);
        return enabled() && marker?.state === "ready" && marker.digest === digest(raw);
      } catch { return false; }
    },
  };
}
