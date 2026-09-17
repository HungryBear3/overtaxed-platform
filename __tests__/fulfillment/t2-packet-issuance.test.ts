/**
 * @jest-environment node
 *
 * Internal capability issuance: the piece the download surface never had.
 *
 * What is being protected:
 *   - 256 bits of real entropy, and only the DIGEST is ever handed to the store;
 *   - the attempt binding, the supersession of older credentials and the insert
 *     all commit together, so an attempt can never end up with two live codes;
 *   - a second issuance against the same attempt is refused, which is what makes
 *     "never re-mint under the same key" a database invariant.
 */
import type { Prisma } from "@prisma/client"
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import {
  hashPacketDownloadCapability,
  isValidPacketDownloadCapability,
} from "@/lib/fulfillment/packet-download"
import {
  createPrismaPacketDownloadStore,
  type PacketDownloadClient,
  type PacketDownloadTransaction,
} from "@/lib/fulfillment-runtime/packet-download-store"
import {
  issueT2PacketCapability,
  T2_PACKET_CAPABILITY_MAX_USES,
  T2_PACKET_CAPABILITY_TTL_SECONDS,
} from "@/lib/fulfillment-runtime/t2-packet-issuance"

jest.mock("server-only", () => ({}))

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const PIN = "09000000000000"
const ADDRESS = "123 Main St"
const NOW = "2026-09-12T12:00:00.000Z"

const bytes = Buffer.from("%PDF-1.7 bound evidence\n")
const sha = computeArtifactSha256(bytes)
const locator = contentAddressedT2ArtifactLocator(sha)
const fingerprint = computePropertyBindingFingerprint({
  orderId: ORDER_ID,
  propertyPin: PIN,
  propertyAddress: ADDRESS,
})

type Capability = {
  id: string
  capabilityHash: string
  fulfillmentId: string
  revokedAt: Date | null
  revokedReasonCode: string | null
}

type World = {
  now: string
  capabilities: Capability[]
  attempts: Array<{
    attemptNumber: number
    provider: string
    downloadCapabilityId: string | null
  }>
  locks: string[]
  rolledBack: boolean
}

function world(patch: Partial<World> = {}): World {
  return {
    now: NOW,
    capabilities: [],
    attempts: [{ attemptNumber: 1, provider: "resend", downloadCapabilityId: null }],
    locks: [],
    rolledBack: false,
    ...patch,
  }
}

function fakeClient(
  state: World,
  hooks: { afterInsert?: () => void } = {},
): PacketDownloadClient {
  const tx: PacketDownloadTransaction = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      if (sql.includes("clock_timestamp()")) return [{ now: state.now }] as T
      if (sql.includes('FROM "ot_order"')) {
        state.locks.push("order")
        return [{ id: ORDER_ID, tier: "T2", status: "PAID", propertyPin: PIN, propertyAddress: ADDRESS }] as T
      }
      if (sql.includes('FROM "ot_fulfillment_artifact"'))
        return [{
          id: "art_v1", fulfillmentId: FULFILLMENT_ID, version: 1,
          artifactSha256: sha, byteSize: bytes.byteLength, storageLocator: locator,
          sourceOrderId: ORDER_ID, propertyBindingFingerprint: fingerprint,
        }] as T
      if (sql.includes('FROM "ot_fulfillment"')) {
        if (sql.includes("FOR UPDATE")) state.locks.push("fulfillment")
        return [{ id: FULFILLMENT_ID, orderId: ORDER_ID, kind: "T2_APPEAL_EVIDENCE", status: "DELIVERY_PENDING" }] as T
      }
      if (sql.includes('FROM "ot_delivery_attempt"')) {
        state.locks.push("attempt")
        const number = query.values[1]
        return state.attempts.filter((a) => a.attemptNumber === number) as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const sql = query.sql
      if (sql.includes('INSERT INTO "ot_packet_download_capability"')) {
        const [id, capabilityHash] = query.values as [string, string]
        state.capabilities.push({
          id, capabilityHash, fulfillmentId: FULFILLMENT_ID,
          revokedAt: null, revokedReasonCode: null,
        })
        hooks.afterInsert?.()
        return 1
      }
      if (sql.includes('UPDATE "ot_packet_download_capability"')) {
        const [revokedAt, reason, , exceptId] = query.values as [Date, string, string, string]
        let revoked = 0
        for (const capability of state.capabilities) {
          if (capability.id !== exceptId && capability.revokedAt === null) {
            capability.revokedAt = revokedAt
            capability.revokedReasonCode = reason
            revoked += 1
          }
        }
        return revoked
      }
      if (sql.includes('UPDATE "ot_delivery_attempt"')) {
        const [capabilityId, , attemptNumber] = query.values as [string, string, number]
        const attempt = state.attempts.find(
          (a) => a.attemptNumber === attemptNumber && a.downloadCapabilityId === null,
        )
        if (!attempt) return 0
        attempt.downloadCapabilityId = capabilityId
        return 1
      }
      throw new Error(`unexpected execute: ${sql}`)
    },
  }
  return {
    async $transaction<T>(work: (t: PacketDownloadTransaction) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state)
      try {
        return await work(tx)
      } catch (error) {
        Object.assign(state, snapshot, { rolledBack: true })
        throw error
      }
    },
  }
}

const PRIOR = process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
beforeEach(() => { process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true" })
afterAll(() => {
  if (PRIOR === undefined) delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
  else process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = PRIOR
})

const issue = (state: World, patch: Record<string, unknown> = {}) =>
  issueT2PacketCapability(
    { fulfillmentId: FULFILLMENT_ID, attemptNumber: 1, provider: "resend", ...patch },
    { store: createPrismaPacketDownloadStore(fakeClient(state)) },
  )

describe("the value is high-entropy, and only its digest is stored", () => {
  it("mints a well-formed capability and persists the hash, never the value", async () => {
    const state = world()
    const result = await issue(state)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("unreachable")

    expect(isValidPacketDownloadCapability(result.issuance.value)).toBe(true)
    const digest = hashPacketDownloadCapability(result.issuance.value)
    expect(state.capabilities).toHaveLength(1)
    expect(state.capabilities[0].capabilityHash).toBe(digest)
    // The digest is not the value, and the value is nowhere in the world.
    expect(state.capabilities[0].capabilityHash).not.toBe(result.issuance.value)
    expect(JSON.stringify(state)).not.toContain(result.issuance.value)
  })

  it("produces a different value every time", async () => {
    const values = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const state = world()
      const result = await issue(state)
      if (result.ok) values.add(result.issuance.value)
    }
    expect(values.size).toBe(25)
  })

  it("fails closed rather than hashing a malformed generated value", async () => {
    const state = world()
    await expect(
      issueT2PacketCapability(
        { fulfillmentId: FULFILLMENT_ID, attemptNumber: 1, provider: "resend" },
        {
          store: createPrismaPacketDownloadStore(fakeClient(state)),
          randomValue: () => "too-short",
        },
      ),
    ).resolves.toEqual({ ok: false, blocker: "INVALID_CAPABILITY" })
    expect(state.capabilities).toEqual([])
  })

  it("carries a bounded lifetime and use budget", () => {
    expect(T2_PACKET_CAPABILITY_TTL_SECONDS).toBe(7 * 24 * 60 * 60)
    expect(T2_PACKET_CAPABILITY_MAX_USES).toBe(5)
  })
})

describe("issuance is atomic with the attempt binding", () => {
  it("locks order → fulfillment → attempt", async () => {
    const state = world()
    await issue(state)
    expect(state.locks).toEqual(["order", "fulfillment", "attempt"])
  })

  it("records the capability on the exact attempt", async () => {
    const state = world()
    const result = await issue(state)
    if (!result.ok) throw new Error("unreachable")
    expect(state.attempts[0].downloadCapabilityId).toBe(result.issuance.capabilityId)
  })

  it("supersedes every older live credential for the fulfillment", async () => {
    const state = world({
      capabilities: [
        { id: "cap_old", capabilityHash: "b".repeat(64), fulfillmentId: FULFILLMENT_ID, revokedAt: null, revokedReasonCode: null },
      ],
    })
    await issue(state)
    expect(state.capabilities[0]).toMatchObject({
      id: "cap_old",
      revokedReasonCode: "SUPERSEDED",
    })
    expect(state.capabilities[1].revokedAt).toBeNull()
  })

  it("refuses a second issuance against the same attempt, and writes nothing", async () => {
    const state = world()
    await issue(state)
    const capabilities = state.capabilities.length
    // A retry after an ambiguous send. The first value is deliberately not
    // recoverable, so a second mint could only mail a DIFFERENT code — a second
    // delivery wearing the first one's identity.
    await expect(issue(state)).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_BINDING_MISMATCH",
    })
    expect(state.capabilities).toHaveLength(capabilities)
  })

  it("rolls the capability back when the binding loses a race", async () => {
    const state = world()
    // A concurrent issuer claims the attempt after this one passed its
    // pre-check and inserted its row, but before the conditional binding write.
    const store = createPrismaPacketDownloadStore(
      fakeClient(state, {
        afterInsert: () => {
          state.attempts[0].downloadCapabilityId = "cap_concurrent"
        },
      }),
    )
    await expect(
      issueT2PacketCapability(
        { fulfillmentId: FULFILLMENT_ID, attemptNumber: 1, provider: "resend" },
        { store },
      ),
    ).resolves.toEqual({ ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" })
    // The whole transaction unwound, so the loser handed out nothing: both
    // callers cannot end up with a live value for one attempt.
    expect(state.rolledBack).toBe(true)
    expect(state.capabilities).toEqual([])
  })

  it("refuses an attempt recorded against another provider", async () => {
    const state = world({
      attempts: [{ attemptNumber: 1, provider: "postmark", downloadCapabilityId: null }],
    })
    await expect(issue(state)).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_BINDING_MISMATCH",
    })
    expect(state.capabilities).toEqual([])
  })

  it("refuses an attempt number that does not exist", async () => {
    const state = world()
    await expect(issue(state, { attemptNumber: 7 })).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_BINDING_MISMATCH",
    })
    expect(state.capabilities).toEqual([])
  })
})

describe("a disabled deployment mints nothing", () => {
  it.each([undefined, "", "false", "TRUE", "1", "true "])(
    "flag %j opens no transaction",
    async (flag) => {
      if (flag === undefined) delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
      else process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = flag
      const state = world()
      const client = fakeClient(state)
      const transaction = jest.spyOn(client, "$transaction")
      await expect(
        issueT2PacketCapability(
          { fulfillmentId: FULFILLMENT_ID, attemptNumber: 1, provider: "resend" },
          { store: createPrismaPacketDownloadStore(client) },
        ),
      ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
      expect(transaction).not.toHaveBeenCalled()
    },
  )
})
