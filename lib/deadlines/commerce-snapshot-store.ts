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
type Stored = {
  id: string
  retrieved_at: Date | string
  content_sha256: string
  source_body: Uint8Array
  value: string
}
type StoredCapture = { snapshot: OfficialDeadlineSnapshot; sourceBodyBase64: string }

const readSql = () => Prisma.sql`SELECT "id", "retrieved_at", "content_sha256", "source_body",
  left("capture_json", ${MAX_COMMERCE_CAPTURE_LENGTH + 1}) AS "value"
  FROM "ot_commerce_deadline_capture" ORDER BY "retrieved_at" DESC, "id" DESC LIMIT 1`

function decodeCapture(row: Stored, now: Date): StoredCapture | null {
  try {
    if (row.value.length > MAX_COMMERCE_CAPTURE_LENGTH) return null
    const input = JSON.parse(row.value) as StoredCapture
    const snapshotRaw = JSON.stringify(input.snapshot)
    const snapshot = decodeInformationalSnapshot(snapshotRaw, now)
    const body = Buffer.from(input.sourceBodyBase64, "base64")
    const source = snapshot?.sources.assessor
    const storedBody = Buffer.from(row.source_body)
    const storedAt = new Date(row.retrieved_at)
    if (!source || body.length === 0 || !Number.isFinite(storedAt.getTime())) return null
    if (storedAt.getTime() !== Date.parse(source.retrievedAt)) return null
    if (row.content_sha256 !== source.contentSha256) return null
    if (!storedBody.equals(body)) return null
    if (createHash("sha256").update(storedBody).digest("hex") !== row.content_sha256) return null
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
        return rows[0] ? decodeCapture(rows[0], now)?.snapshot ?? null : null
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
          const next = decodeInformationalSnapshot(JSON.stringify(snapshot), now)
          if (!enabled() || !next) return "REFUSED" as const
          const prior = (await tx.$queryRaw<Stored[]>(readSql()))[0]
          if (prior) {
            const embeddedAt = new Date(JSON.parse(prior.value).snapshot.sources.assessor.retrievedAt)
            const decodedPrior = decodeCapture(prior, embeddedAt)
            const priorAt = decodedPrior?.snapshot.sources.assessor?.retrievedAt
            if (!priorAt) return "REFUSED" as const
            const order = Date.parse(source.retrievedAt) - Date.parse(priorAt)
            if (order < 0) return "REFUSED" as const
            if (order === 0) {
              return prior.value === value && Buffer.from(prior.source_body).equals(sourceBody)
                ? "UNCHANGED" as const
                : "REFUSED" as const
            }
          }
          await tx.$executeRaw(Prisma.sql`SELECT "ot_publish_commerce_deadline_capture"(
            ${randomUUID()}, ${new Date(source.retrievedAt)}, ${source.contentSha256}, ${value}, ${sourceBody})`)
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
