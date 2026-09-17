/**
 * @jest-environment node
 *
 * Durable orphan quarantine: the pure record decision, and the store's real SQL
 * exercised through a fake Prisma adapter that implements the ON CONFLICT
 * semantics itself — so idempotency, the monotonic upload-outcome fold, and the
 * "never delete" contract are tested as behaviour rather than as a mock's
 * scripted answer.
 */
import type { Prisma } from "@prisma/client"
import {
  ARTIFACT_ORPHAN_BLOCKERS,
  ARTIFACT_ORPHAN_REASON_CODES,
  decideArtifactOrphanRecord,
  type ArtifactOrphanObservation,
} from "@/lib/fulfillment/artifact-orphan"
import {
  computeArtifactSha256,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import {
  createPrismaArtifactOrphanStore,
  type ArtifactOrphanStoreClient,
} from "@/lib/fulfillment-runtime/artifact-orphan-store"

const bytes = Buffer.from("%PDF-1.7 unbound evidence\n")
const sha = computeArtifactSha256(bytes)
const locator = contentAddressedT2ArtifactLocator(sha)
const NOW = "2026-09-12T12:00:00.000Z"

function observation(
  patch: Partial<ArtifactOrphanObservation> = {},
): ArtifactOrphanObservation {
  return {
    fulfillmentId: "ful_t2",
    sourceOrderId: "ord_paid_t2",
    storageLocator: locator,
    artifactSha256: sha,
    uploadOutcome: "CONFIRMED",
    reasonCode: "BIND_REFUSED",
    observedAt: NOW,
    ...patch,
  }
}

describe("the pure record decision", () => {
  it("always carries the expected content digest and the observed location", () => {
    expect(decideArtifactOrphanRecord(observation())).toEqual({
      ok: true,
      record: {
        fulfillmentId: "ful_t2",
        sourceOrderId: "ord_paid_t2",
        storageLocator: locator,
        artifactSha256: sha,
        uploadOutcome: "CONFIRMED",
        reasonCode: "BIND_REFUSED",
        observedAt: NOW,
      },
    })
  })

  it("records an unknown upload outcome as UNKNOWN, never rounded either way", () => {
    const decision = decideArtifactOrphanRecord(
      observation({ uploadOutcome: "UNKNOWN", reasonCode: "UPLOAD_OUTCOME_UNKNOWN" }),
    )
    expect(decision).toMatchObject({ ok: true, record: { uploadOutcome: "UNKNOWN" } })
  })

  it("accepts a locator that is NOT the content address, because that is where the bytes are", () => {
    // A provider that returned an unexpected locator put the object somewhere
    // else; recording that place alongside the expected digest is the point.
    expect(
      decideArtifactOrphanRecord(
        observation({ storageLocator: "t2-artifacts/provider/elsewhere.pdf" }),
      ),
    ).toMatchObject({ ok: true, record: { artifactSha256: sha } })
  })

  it.each([
    ["an empty fulfillment id", { fulfillmentId: "" }, "INVALID_FULFILLMENT_ID"],
    ["a newline-bearing fulfillment id", { fulfillmentId: "ful\n1" }, "INVALID_FULFILLMENT_ID"],
    ["an empty order id", { sourceOrderId: "" }, "INVALID_ORDER_ID"],
    ["a public bearer URL", { storageLocator: "https://blob.example/x.pdf" }, "INVALID_STORAGE_LOCATOR"],
    ["an absolute path", { storageLocator: "/x.pdf" }, "INVALID_STORAGE_LOCATOR"],
    ["a traversal segment", { storageLocator: "a/../b.pdf" }, "INVALID_STORAGE_LOCATOR"],
    ["an uppercase digest", { artifactSha256: sha.toUpperCase() }, "INVALID_ARTIFACT_SHA256"],
    ["a truncated digest", { artifactSha256: "abc" }, "INVALID_ARTIFACT_SHA256"],
    ["an invented upload outcome", { uploadOutcome: "PROBABLY" as never }, "INVALID_UPLOAD_OUTCOME"],
    ["free-form provider text as a reason", { reasonCode: "connection reset by peer" as never }, "INVALID_REASON_CODE"],
    ["a naive timestamp", { observedAt: "2026-09-12T12:00:00" }, "UNTRUSTED_CLOCK"],
    ["an empty clock", { observedAt: "" }, "UNTRUSTED_CLOCK"],
  ])("refuses %s", (_label, patch, blocker) => {
    expect(decideArtifactOrphanRecord(observation(patch))).toEqual({ ok: false, blocker })
  })

  it("keeps both persisted vocabularies closed and non-PII", () => {
    for (const code of [...ARTIFACT_ORPHAN_REASON_CODES, ...ARTIFACT_ORPHAN_BLOCKERS]) {
      expect(code).toMatch(/^[A-Z0-9_]+$/)
    }
  })
})

type QuarantineRow = {
  id: string
  storageLocator: string
  artifactSha256: string
  fulfillmentId: string
  sourceOrderId: string
  uploadOutcome: string
  firstReasonCode: string
  lastReasonCode: string
  observationCount: number
  firstObservedAt: Date
  lastObservedAt: Date
}

/**
 * A fake that implements the store's INSERT ... ON CONFLICT DO UPDATE for real,
 * keyed exactly as the unique index is.
 */
function fakeClient(state: { now: string; rows: QuarantineRow[]; sql: string[] }) {
  const client: ArtifactOrphanStoreClient = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      state.sql.push(sql)
      if (sql.includes("CURRENT_TIMESTAMP")) return [{ now: state.now }] as T
      if (sql.includes('INSERT INTO "ot_artifact_orphan_quarantine"')) {
        const [
          id,
          storageLocator,
          artifactSha256,
          fulfillmentId,
          sourceOrderId,
          uploadOutcome,
          firstReasonCode,
          lastReasonCode,
          firstObservedAt,
          lastObservedAt,
        ] = query.values as [string, string, string, string, string, string, string, string, Date, Date]

        const existing = state.rows.find(
          (row) =>
            row.fulfillmentId === fulfillmentId &&
            row.storageLocator === storageLocator &&
            row.artifactSha256 === artifactSha256,
        )
        if (!existing) {
          const row: QuarantineRow = {
            id,
            storageLocator,
            artifactSha256,
            fulfillmentId,
            sourceOrderId,
            uploadOutcome,
            firstReasonCode,
            lastReasonCode,
            observationCount: 1,
            firstObservedAt,
            lastObservedAt,
          }
          state.rows.push(row)
          return [
            { id: row.id, observationCount: 1, uploadOutcome: row.uploadOutcome },
          ] as T
        }
        existing.observationCount += 1
        existing.lastReasonCode = lastReasonCode
        existing.lastObservedAt =
          lastObservedAt > existing.lastObservedAt ? lastObservedAt : existing.lastObservedAt
        existing.uploadOutcome =
          existing.uploadOutcome === "CONFIRMED" ? "CONFIRMED" : uploadOutcome
        return [
          {
            id: existing.id,
            observationCount: existing.observationCount,
            uploadOutcome: existing.uploadOutcome,
          },
        ] as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  return client
}

function freshState() {
  return { now: NOW, rows: [] as QuarantineRow[], sql: [] as string[] }
}

describe("the durable quarantine store", () => {
  it("records a first observation with the expected digest", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    await expect(
      store.record({
        fulfillmentId: "ful_t2",
        sourceOrderId: "ord_paid_t2",
        storageLocator: locator,
        artifactSha256: sha,
        uploadOutcome: "UNKNOWN",
        reasonCode: "UPLOAD_OUTCOME_UNKNOWN",
      }),
    ).resolves.toEqual({
      ok: true,
      created: true,
      observationCount: 1,
      uploadOutcome: "UNKNOWN",
    })
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]).toMatchObject({
      artifactSha256: sha,
      storageLocator: locator,
      uploadOutcome: "UNKNOWN",
      firstReasonCode: "UPLOAD_OUTCOME_UNKNOWN",
    })
  })

  it("is idempotent: a repeat observation folds into one row", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    const command = {
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
      uploadOutcome: "CONFIRMED" as const,
      reasonCode: "BIND_REFUSED" as const,
    }
    await store.record(command)
    await expect(store.record(command)).resolves.toEqual({
      ok: true,
      created: false,
      observationCount: 2,
      uploadOutcome: "CONFIRMED",
    })
    expect(state.rows).toHaveLength(1)
  })

  it("preserves the first reason and first-seen time while tracking the latest", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    await store.record({
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
      uploadOutcome: "CONFIRMED",
      reasonCode: "STORAGE_READ_FAILED",
    })
    state.now = "2026-09-12T13:00:00.000Z"
    await store.record({
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
      uploadOutcome: "CONFIRMED",
      reasonCode: "BIND_OUTCOME_UNKNOWN",
    })
    expect(state.rows[0]).toMatchObject({
      firstReasonCode: "STORAGE_READ_FAILED",
      lastReasonCode: "BIND_OUTCOME_UNKNOWN",
      firstObservedAt: new Date(NOW),
      lastObservedAt: new Date("2026-09-12T13:00:00.000Z"),
    })
  })

  it("never lets an out-of-order observation move last-seen backwards", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    const command = {
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
      uploadOutcome: "CONFIRMED" as const,
      reasonCode: "BIND_REFUSED" as const,
    }
    await store.record(command)
    state.now = "2026-09-12T11:00:00.000Z"
    await store.record(command)
    expect(state.rows[0]?.lastObservedAt).toEqual(new Date(NOW))
  })

  it("folds the upload outcome monotonically towards certainty", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    const base = {
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
    }
    await store.record({ ...base, uploadOutcome: "CONFIRMED", reasonCode: "BIND_REFUSED" })
    // A later ambiguous observation must not downgrade a confirmed existence.
    await expect(
      store.record({ ...base, uploadOutcome: "UNKNOWN", reasonCode: "BIND_OUTCOME_UNKNOWN" }),
    ).resolves.toMatchObject({ uploadOutcome: "CONFIRMED" })
  })

  it("upgrades UNKNOWN to CONFIRMED once existence is observed", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    const base = {
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
    }
    await store.record({ ...base, uploadOutcome: "UNKNOWN", reasonCode: "UPLOAD_OUTCOME_UNKNOWN" })
    await expect(
      store.record({ ...base, uploadOutcome: "CONFIRMED", reasonCode: "BIND_REFUSED" }),
    ).resolves.toMatchObject({ uploadOutcome: "CONFIRMED" })
  })

  it("keeps a second location for the same digest as its own record", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    const base = {
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      artifactSha256: sha,
      uploadOutcome: "CONFIRMED" as const,
      reasonCode: "STORAGE_LOCATOR_MISMATCH" as const,
    }
    await store.record({ ...base, storageLocator: locator })
    await store.record({ ...base, storageLocator: "t2-artifacts/provider/elsewhere.pdf" })
    expect(state.rows).toHaveLength(2)
  })

  it("refuses a malformed observation without issuing a write", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    await expect(
      store.record({
        fulfillmentId: "ful_t2",
        sourceOrderId: "ord_paid_t2",
        storageLocator: "https://blob.example/leak.pdf",
        artifactSha256: sha,
        uploadOutcome: "CONFIRMED",
        reasonCode: "BIND_REFUSED",
      }),
    ).resolves.toEqual({ ok: false, blocker: "INVALID_STORAGE_LOCATOR" })
    expect(state.rows).toHaveLength(0)
    expect(state.sql.some((sql) => sql.includes("INSERT"))).toBe(false)
  })

  it("refuses rather than writing when the database clock is unusable", async () => {
    const state = freshState()
    const client = fakeClient(state)
    jest.spyOn(client, "$queryRaw").mockImplementation(async (query: Prisma.Sql) => {
      if (query.sql.includes("CURRENT_TIMESTAMP")) return [{ now: new Date() }] as never
      throw new Error("must not write")
    })
    const store = createPrismaArtifactOrphanStore(client)
    await expect(
      store.record({
        fulfillmentId: "ful_t2",
        sourceOrderId: "ord_paid_t2",
        storageLocator: locator,
        artifactSha256: sha,
        uploadOutcome: "CONFIRMED",
        reasonCode: "BIND_REFUSED",
      }),
    ).resolves.toEqual({ ok: false, blocker: "UNTRUSTED_CLOCK" })
  })

  it("issues no DELETE, UPDATE-of-storage, or provider call in any branch", async () => {
    const state = freshState()
    const store = createPrismaArtifactOrphanStore(fakeClient(state))
    await store.record({
      fulfillmentId: "ful_t2",
      sourceOrderId: "ord_paid_t2",
      storageLocator: locator,
      artifactSha256: sha,
      uploadOutcome: "UNKNOWN",
      reasonCode: "UPLOAD_OUTCOME_UNKNOWN",
    })
    for (const sql of state.sql) {
      expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i)
    }
  })

  it("treats a write that returns no row as unrecorded", async () => {
    const state = freshState()
    const client = fakeClient(state)
    jest.spyOn(client, "$queryRaw").mockImplementation(async (query: Prisma.Sql) => {
      if (query.sql.includes("CURRENT_TIMESTAMP")) return [{ now: NOW }] as never
      return [] as never
    })
    const store = createPrismaArtifactOrphanStore(client)
    await expect(
      store.record({
        fulfillmentId: "ful_t2",
        sourceOrderId: "ord_paid_t2",
        storageLocator: locator,
        artifactSha256: sha,
        uploadOutcome: "CONFIRMED",
        reasonCode: "BIND_REFUSED",
      }),
    ).rejects.toThrow("OT_ARTIFACT_ORPHAN_NOT_RECORDED")
  })
})
