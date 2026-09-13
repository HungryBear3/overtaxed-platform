import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"

import {
  decodeInformationalSnapshot,
} from "./informational-snapshot"
import type { OfficialDeadlineSnapshot } from "./official-source-state"

export const MAX_COMMERCE_CAPTURE_LENGTH = 800_000
const enabled = () => process.env.OT_COMMERCE_DEADLINE_SNAPSHOT_ENABLED === "true"

type Reader = { $queryRaw<T>(sql: Prisma.Sql): Promise<T> }
type Transaction = Reader & { $executeRaw(sql: Prisma.Sql): Promise<number> }
export type CommerceSnapshotClient = Reader & {
  $transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>
}
type Stored = { id: string; value: string }
type StoredCapture = { snapshot: OfficialDeadlineSnapshot; sourceBodyBase64: string }

const readSql = () => Prisma.sql`SELECT "id", left("capture_json", ${MAX_COMMERCE_CAPTURE_LENGTH + 1}) AS "value"
  FROM "ot_commerce_deadline_capture" ORDER BY "retrieved_at" DESC, "id" DESC LIMIT 1`

function decodeCapture(raw: string, now: Date): StoredCapture | null {
  try {
    if (raw.length > MAX_COMMERCE_CAPTURE_LENGTH) return null
    const input = JSON.parse(raw) as StoredCapture
    const snapshotRaw = JSON.stringify(input.snapshot)
    const snapshot = decodeInformationalSnapshot(snapshotRaw, now)
    const body = Buffer.from(input.sourceBodyBase64, "base64")
    const expected = snapshot?.sources.assessor?.contentSha256
    if (!snapshot || !expected || body.length === 0) return null
    if (createHash("sha256").update(body).digest("hex") !== expected) return null
    return { snapshot, sourceBodyBase64: input.sourceBodyBase64 }
  } catch {
    return null
  }
}

/** Dedicated, server-only authority backed only by protected immutable captures. */
export function createCommerceSnapshotStore(client: CommerceSnapshotClient) {
  return {
    async read(now: Date): Promise<OfficialDeadlineSnapshot | null> {
      if (!enabled()) return null
      try {
        const rows = await client.$queryRaw<Stored[]>(readSql())
        return rows[0] ? decodeCapture(rows[0].value, now)?.snapshot ?? null : null
      } catch {
        return null
      }
    },
    async publish(snapshot: OfficialDeadlineSnapshot, sourceBody: Buffer, now: Date) {
      if (!enabled() || sourceBody.length === 0) return "REFUSED" as const
      const source = snapshot.sources.assessor
      if (!source || createHash("sha256").update(sourceBody).digest("hex") !== source.contentSha256) {
        return "REFUSED" as const
      }
      const value = JSON.stringify({ snapshot, sourceBodyBase64: sourceBody.toString("base64") })
      try {
        return await client.$transaction(async tx => {
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('ot:commerce-assessor:2026:v1'))::text AS locked`)
          if (!enabled() || !decodeCapture(value, now)) return "REFUSED" as const
          const prior = (await tx.$queryRaw<Stored[]>(readSql()))[0]
          if (prior) {
            const decodedPrior = decodeCapture(prior.value, new Date(JSON.parse(prior.value).snapshot.sources.assessor.retrievedAt))
            const priorAt = decodedPrior?.snapshot.sources.assessor?.retrievedAt
            if (!priorAt || Date.parse(source.retrievedAt) <= Date.parse(priorAt)) return "REFUSED" as const
          }
          await tx.$executeRaw(Prisma.sql`INSERT INTO "ot_commerce_deadline_capture"
            ("id", "retrieved_at", "content_sha256", "capture_json", "source_body")
            VALUES (${randomUUID()}, ${new Date(source.retrievedAt)}, ${source.contentSha256}, ${value}, ${sourceBody})`)
          return "PUBLISHED" as const
        })
      } catch {
        return "REFUSED" as const
      }
    },
  }
}

export async function commerceSnapshotStore() {
  if (!enabled()) return null
  try {
    const { prisma } = await import("@/lib/db")
    return createCommerceSnapshotStore(prisma as unknown as CommerceSnapshotClient)
  } catch {
    return null
  }
}
