/**
 * @jest-environment node
 *
 * Runtime store behaviour, exercised through a fake Prisma adapter that keeps a
 * small in-memory world and answers the store's real SQL. The fake is
 * deliberately literal: it records lock order, enforces the compare-and-set
 * predicates itself, and applies writes, so the assertions below are about the
 * store's own concurrency and lifecycle logic rather than about a mock's
 * scripted return values.
 */
import { randomBytes } from "node:crypto"
import type { Prisma } from "@prisma/client"
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import { hashPacketDownloadCapability } from "@/lib/fulfillment/packet-download"
import {
  createPrismaPacketDownloadStore,
  type PacketDownloadClient,
  type PacketDownloadTransaction,
} from "@/lib/fulfillment-runtime/packet-download-store"

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const ARTIFACT_ID = "art_v1"
const PIN = "09000000000000"
const ADDRESS = "123 Main St"

const bytes = Buffer.from("%PDF-1.7 bound evidence\n")
const sha = computeArtifactSha256(bytes)
const locator = contentAddressedT2ArtifactLocator(sha)
const fingerprint = computePropertyBindingFingerprint({
  orderId: ORDER_ID,
  propertyPin: PIN,
  propertyAddress: ADDRESS,
})

const VALUE = randomBytes(32).toString("base64url")
const HASH = hashPacketDownloadCapability(VALUE) as string
const NOW = "2026-09-12T12:00:00.000Z"

type CapabilityRow = {
  id: string
  capabilityHash: string
  fulfillmentId: string
  artifactId: string
  artifactVersion: number
  artifactSha256: string
  sourceOrderId: string
  propertyBindingFingerprint: string
  expiresAt: Date | null
  maxUses: number
  useCount: number
  revokedAt: Date | null
  revokedReasonCode: string | null
  lastUsedAt: Date | null
}

function liveCapability(patch: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "cap_1",
    capabilityHash: HASH,
    fulfillmentId: FULFILLMENT_ID,
    artifactId: ARTIFACT_ID,
    artifactVersion: 1,
    artifactSha256: sha,
    sourceOrderId: ORDER_ID,
    propertyBindingFingerprint: fingerprint,
    expiresAt: new Date("2026-09-19T12:00:00.000Z"),
    maxUses: 5,
    useCount: 0,
    revokedAt: null,
    revokedReasonCode: null,
    lastUsedAt: null,
    ...patch,
  }
}

type World = {
  now: string
  order: Record<string, unknown> | null
  fulfillment: Record<string, unknown> | null
  artifact: Record<string, unknown> | null
  historicalArtifact?: Record<string, unknown> | null
  capability: CapabilityRow | null
  locks: string[]
  inserted: Array<Record<string, unknown>>
  rolledBack: boolean
}

function world(patch: Partial<World> = {}): World {
  return {
    now: NOW,
    order: {
      id: ORDER_ID,
      tier: "T2",
      status: "PAID",
      propertyPin: PIN,
      propertyAddress: ADDRESS,
    },
    fulfillment: {
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      kind: "T2_APPEAL_EVIDENCE",
      status: "DELIVERED",
    },
    artifact: {
      id: ARTIFACT_ID,
      fulfillmentId: FULFILLMENT_ID,
      version: 1,
      artifactSha256: sha,
      byteSize: bytes.byteLength,
      storageLocator: locator,
      sourceOrderId: ORDER_ID,
      propertyBindingFingerprint: fingerprint,
    },
    capability: liveCapability(),
    locks: [],
    inserted: [],
    rolledBack: false,
    ...patch,
  }
}

/** A literal fake of the narrow Prisma surface the store uses. */
function fakeClient(
  state: World,
  hooks: { onClaim?: () => void; onOrderLock?: () => void } = {},
): PacketDownloadClient {
  const tx: PacketDownloadTransaction = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      if (sql.includes("clock_timestamp()")) return [{ now: state.now }] as T
      if (sql.includes('SELECT "source_order_id" AS "sourceOrderId"')) {
        return (state.capability
          ? [{ sourceOrderId: state.capability.sourceOrderId }]
          : []) as T
      }
      if (sql.includes('FROM "ot_order"')) {
        if (sql.includes("FOR UPDATE")) { state.locks.push("order"); hooks.onOrderLock?.() }
        return (state.order ? [state.order] : []) as T
      }
      if (sql.includes('FROM "ot_packet_download_capability"')) {
        if (sql.includes("FOR UPDATE")) state.locks.push("capability")
        return (state.capability ? [state.capability] : []) as T
      }
      if (sql.includes('FROM "ot_fulfillment_artifact"')) {
        const artifact = sql.includes('ORDER BY "version" DESC') ? state.artifact : (state.historicalArtifact ?? state.artifact)
        return (artifact ? [artifact] : []) as T
      }
      if (sql.includes('FROM "ot_fulfillment"')) {
        return (state.fulfillment ? [state.fulfillment] : []) as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const sql = query.sql
      if (sql.includes('INSERT INTO "ot_packet_download_capability"')) {
        state.inserted.push({ values: query.values })
        return 1
      }
      if (sql.includes('SET "use_count"')) {
        hooks.onClaim?.()
        const row = state.capability
        const expected = query.values[3] as number
        const next = query.values[0] as number
        if (
          !row ||
          row.useCount !== expected ||
          row.revokedAt !== null ||
          row.expiresAt === null ||
          row.expiresAt.getTime() <= new Date(state.now).getTime()
        ) {
          return 0
        }
        row.useCount = next
        row.lastUsedAt = new Date(state.now)
        return 1
      }
      if (sql.includes('SET "revoked_at"')) {
        const row = state.capability
        if (!row || row.revokedAt !== null) return 0
        row.revokedAt = query.values[0] as Date
        row.revokedReasonCode = query.values[1] as string
        return 1
      }
      throw new Error(`unexpected execute: ${sql}`)
    },
  }
  return {
    async $transaction<T>(
      work: (transaction: PacketDownloadTransaction) => Promise<T>,
    ): Promise<T> {
      try {
        return await work(tx)
      } catch (error) {
        // A real transaction rolls every write back when the callback throws.
        state.rolledBack = true
        throw error
      }
    },
  }
}

const PRIOR = process.env.OT_T2_PACKET_DOWNLOAD_ENABLED

beforeEach(() => {
  process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
})
afterAll(() => {
  if (PRIOR === undefined) delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
  else process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = PRIOR
})

describe("authorize claims exactly one use under the authoritative order lock", () => {
  it("locks the order before the capability, matching the binder's lock order", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await store.authorize({ capabilityHash: HASH })
    expect(state.locks).toEqual(["order", "capability"])
  })

  it("grants the bound artifact identity and spends one use", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: true,
      grant: {
        capabilityId: "cap_1",
        fulfillmentId: FULFILLMENT_ID,
        orderId: ORDER_ID,
        artifactId: ARTIFACT_ID,
        artifactVersion: 1,
        artifactSha256: sha,
        storageLocator: locator,
        byteSize: bytes.byteLength,
        expectedUseCount: 0,
        nextUseCount: 1,
      },
    })
    expect(state.capability?.useCount).toBe(1)
    expect(state.capability?.lastUsedAt).toEqual(new Date(NOW))
  })

  it("spends the budget exactly once per call and then refuses", async () => {
    const state = world({ capability: liveCapability({ maxUses: 2 }) })
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toMatchObject({ ok: true })
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toMatchObject({ ok: true })
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_EXHAUSTED",
    })
    expect(state.capability?.useCount).toBe(2)
  })

  it("refuses when a concurrent claimant wins the compare-and-set", async () => {
    const state = world()
    // Another request spends the use between our read and our claim.
    const store = createPrismaPacketDownloadStore(
      fakeClient(state, {
        onClaim: () => {
          if (state.capability) state.capability.useCount = 1
        },
      }),
    )
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_USE_NOT_CLAIMED",
    })
  })

  it("refuses when a concurrent revocation wins the compare-and-set", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(
      fakeClient(state, {
        onClaim: () => {
          if (state.capability) state.capability.revokedAt = new Date(NOW)
        },
      }),
    )
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_USE_NOT_CLAIMED",
    })
  })

  it("refuses an unknown capability without locking or claiming anything", async () => {
    const state = world({ capability: null })
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_NOT_FOUND",
    })
    expect(state.locks).toEqual([])
  })

  it.each([
    ["refunded order", { order: { id: ORDER_ID, tier: "T2", status: "REFUNDED", propertyPin: PIN, propertyAddress: ADDRESS } }, "ORDER_NOT_ELIGIBLE"],
    ["cancelled order", { order: { id: ORDER_ID, tier: "T2", status: "CANCELLED", propertyPin: PIN, propertyAddress: ADDRESS } }, "ORDER_NOT_ELIGIBLE"],
    ["terminal fulfillment", { fulfillment: { id: FULFILLMENT_ID, orderId: ORDER_ID, kind: "T2_APPEAL_EVIDENCE", status: "BOUNCED" } }, "FULFILLMENT_NOT_DOWNLOADABLE"],
    ["missing artifact", { artifact: null }, "ARTIFACT_NOT_FOUND"],
  ])("refuses a %s and spends no use", async (_label, patch, blocker) => {
    const state = world(patch as Partial<World>)
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker,
    })
    expect(state.capability?.useCount).toBe(0)
  })

  it("makes no database call at all when the flag is not exactly true", async () => {
    delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
    const state = world()
    const client = fakeClient(state)
    const transaction = jest.spyOn(client, "$transaction")
    const store = createPrismaPacketDownloadStore(client)
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "FLAG_DISABLED",
    })
    expect(transaction).not.toHaveBeenCalled()
  })

  it("rolls the claim back when activation is withdrawn mid-transaction", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(
      fakeClient(state, {
        onClaim: () => {
          delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
        },
      }),
    )
    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "FLAG_DISABLED",
    })
    expect(state.rolledBack).toBe(true)
  })
})

describe("reassert re-reads authority after the storage round trip", () => {
  async function claimed(state: World) {
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    const authorized = await store.authorize({ capabilityHash: HASH })
    if (!authorized.ok) throw new Error(`unexpected refusal ${authorized.blocker}`)
    return { store, grant: authorized.grant }
  }

  it("confirms an unchanged world, including on the FINAL use of the budget", async () => {
    const state = world({ capability: liveCapability({ maxUses: 1 }) })
    const { store, grant } = await claimed(state)
    expect(state.capability?.useCount).toBe(1)
    // Re-checking the post-claim count would refuse here — the claim consumed
    // the very budget it would be judged against.
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: true,
      grant,
    })
  })

  it("refuses when the order was refunded while storage was being read", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    state.order = { ...state.order!, status: "REFUNDED" }
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "ORDER_NOT_ELIGIBLE",
    })
  })

  it("refuses when the capability was revoked while storage was being read", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    state.capability!.revokedAt = new Date(NOW)
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_REVOKED",
    })
  })

  it("refuses when the fulfillment reached a terminal state mid-read", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    state.fulfillment = { ...state.fulfillment!, status: "COMPLAINED" }
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "FULFILLMENT_NOT_DOWNLOADABLE",
    })
  })

  it("refuses when the artifact identity changed under the grant", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    const other = computeArtifactSha256(Buffer.from("%PDF-1.7 different\n"))
    state.artifact = { ...state.artifact!, artifactSha256: other }
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "ARTIFACT_IDENTITY_MISMATCH",
    })
  })

  it("refuses when the capability row disappeared", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    state.capability = null
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_NOT_FOUND",
    })
  })

  it("refuses when our claim is no longer on record", async () => {
    const state = world()
    const { store, grant } = await claimed(state)
    state.capability!.useCount = 0
    await expect(store.reassert({ capabilityHash: HASH, grant })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_USE_NOT_CLAIMED",
    })
  })
})

describe("revocation", () => {
  it("ends access and is idempotent", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(
      store.revoke({ fulfillmentId: FULFILLMENT_ID, reasonCode: "REFUNDED" }),
    ).resolves.toEqual({ ok: true, revoked: 1 })
    expect(state.capability?.revokedReasonCode).toBe("REFUNDED")

    // A second call must not rewrite the original reason or timestamp.
    await expect(
      store.revoke({ fulfillmentId: FULFILLMENT_ID, reasonCode: "ADMIN_REVOKED" }),
    ).resolves.toEqual({ ok: true, revoked: 0 })
    expect(state.capability?.revokedReasonCode).toBe("REFUNDED")

    await expect(store.authorize({ capabilityHash: HASH })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_REVOKED",
    })
  })

  it("keeps working when the download surface is switched off", async () => {
    delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(
      store.revoke({ fulfillmentId: FULFILLMENT_ID, reasonCode: "DISPUTED" }),
    ).resolves.toEqual({ ok: true, revoked: 1 })
  })

  it("refuses a reason code outside the closed allowlist", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(
      store.revoke({
        fulfillmentId: FULFILLMENT_ID,
        reasonCode: "customer asked nicely" as never,
      }),
    ).resolves.toEqual({ ok: false, blocker: "INVALID_REASON_CODE" })
    expect(state.capability?.revokedAt).toBeNull()
  })
})

describe("issuance", () => {
  it("persists only the hash — never the capability value", async () => {
    const state = world({ capability: null })
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    const issued = await store.issue({
      capabilityHash: HASH,
      fulfillmentId: FULFILLMENT_ID,
      ttlSeconds: 604_800,
      maxUses: 5,
    })
    expect(issued).toMatchObject({
      ok: true,
      artifactId: ARTIFACT_ID,
      artifactSha256: sha,
      maxUses: 5,
    })
    const values = state.inserted[0]?.values as unknown[]
    expect(values).toContain(HASH)
    expect(values).not.toContain(VALUE)
    expect(JSON.stringify(values)).not.toContain(VALUE)
  })

  it("refuses to mint for a refunded order", async () => {
    const state = world({
      capability: null,
      order: { id: ORDER_ID, tier: "T2", status: "REFUNDED", propertyPin: PIN, propertyAddress: ADDRESS },
    })
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    await expect(
      store.issue({ capabilityHash: HASH, fulfillmentId: FULFILLMENT_ID, ttlSeconds: 3600, maxUses: 1 }),
    ).resolves.toEqual({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
    expect(state.inserted).toHaveLength(0)
  })

  it("makes no database call while the flag is not exactly true", async () => {
    delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
    const state = world({ capability: null })
    const client = fakeClient(state)
    const transaction = jest.spyOn(client, "$transaction")
    const store = createPrismaPacketDownloadStore(client)
    await expect(
      store.issue({ capabilityHash: HASH, fulfillmentId: FULFILLMENT_ID, ttlSeconds: 3600, maxUses: 1 }),
    ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe("fresh current-artifact authority", () => {
  it("refuses a superseded capability before consuming a use", async () => {
    const state = world()
    state.historicalArtifact = state.artifact
    state.artifact = { ...state.artifact, id: "art_v2", version: 2 }
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    expect(await store.authorize({ capabilityHash: HASH })).toMatchObject({ ok: false })
    expect(state.capability!.useCount).toBe(0)
  })
  it("refuses replacement during the asynchronous storage read", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state))
    const first = await store.authorize({ capabilityHash: HASH })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error("expected grant")
    state.historicalArtifact = state.artifact
    state.artifact = { ...state.artifact, id: "art_v2", version: 2 }
    expect(await store.reassert({ capabilityHash: HASH, grant: first.grant })).toMatchObject({ ok: false })
  })
  it("uses the post-lock clock when waiting crosses expiry", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state, {
      onOrderLock: () => { state.now = "2026-09-20T12:00:00.000Z" },
    }))
    expect(await store.authorize({ capabilityHash: HASH })).toMatchObject({ ok: false })
    expect(state.capability!.useCount).toBe(0)
  })
  it("rereads fulfillment after issuance waits on the order lock", async () => {
    const state = world()
    const store = createPrismaPacketDownloadStore(fakeClient(state, {
      onOrderLock: () => { state.fulfillment = null },
    }))
    expect(await store.issue({ capabilityHash: HASH, fulfillmentId: FULFILLMENT_ID, ttlSeconds: 60, maxUses: 1 })).toMatchObject({ ok: false })
    expect(state.inserted).toHaveLength(0)
  })
})
