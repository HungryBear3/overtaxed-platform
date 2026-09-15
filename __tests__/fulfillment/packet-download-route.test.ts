/** @jest-environment node */

const authorizeMock = jest.fn()
const reassertMock = jest.fn()
const readBytesMock = jest.fn()

jest.mock("@/lib/fulfillment-runtime/packet-download-store", () => ({
  prismaPacketDownloadStore: {
    authorize: (...args: unknown[]) => authorizeMock(...args),
    reassert: (...args: unknown[]) => reassertMock(...args),
    issue: jest.fn(),
    revoke: jest.fn(),
  },
}))
jest.mock("@/lib/fulfillment-runtime/t2-artifact-storage", () => ({
  readT2ArtifactBytes: (...args: unknown[]) => readBytesMock(...args),
  uploadT2Artifact: jest.fn(),
}))

import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import { t2PacketDownloadEnabled } from "@/lib/fulfillment/flag"
import {
  decidePacketDownload,
  hashPacketDownloadCapability,
  type PacketDownloadCapabilityRow,
  type PacketDownloadFulfillmentRow,
  type PacketDownloadOrderRow,
} from "@/lib/fulfillment/packet-download"
import { readT2PacketForCapability } from "@/lib/fulfillment-runtime/packet-download"
import type { PacketDownloadStore } from "@/lib/fulfillment-runtime/packet-download-store"
import { GET, POST } from "@/app/api/ot/packet/download/route"

const bytes = Buffer.from("%PDF-1.7 bound evidence\n")
const sha = computeArtifactSha256(bytes)
const locator = contentAddressedT2ArtifactLocator(sha)
const VALUE = randomBytes(32).toString("base64url")
const HASH = hashPacketDownloadCapability(VALUE) as string

const grant = {
  capabilityId: "cap_1",
  fulfillmentId: "ful_t2",
  orderId: "ord_paid_t2",
  artifactId: "art_v1",
  artifactVersion: 1,
  artifactSha256: sha,
  storageLocator: locator,
  byteSize: bytes.byteLength,
  expectedUseCount: 0,
  nextUseCount: 1,
}

const PRIOR = process.env.OT_T2_PACKET_DOWNLOAD_ENABLED

beforeEach(() => {
  jest.clearAllMocks()
  process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
  authorizeMock.mockResolvedValue({ ok: true, grant })
  reassertMock.mockResolvedValue({ ok: true, grant })
  readBytesMock.mockResolvedValue(bytes)
})
afterAll(() => {
  if (PRIOR === undefined) delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
  else process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = PRIOR
})

const URL_BASE = "https://overtaxed.example/api/ot/packet/download"

function request(
  body: unknown = { capability: VALUE },
  headers: Record<string, string> = {},
  raw = false,
  url = URL_BASE,
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
}

/**
 * A request whose body arrives in chunks with NO `Content-Length`, which is what
 * a real chunked upload looks like. The bound has to hold for this shape too.
 */
function streamingRequest(
  chunks: string[],
  headers: Record<string, string> = {},
) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" }) as unknown as import("next/server").NextRequest
}

describe("the read path orders authorize -> storage -> re-read authority", () => {
  it("returns the exact bound bytes and re-reads authority before responding", async () => {
    const order: string[] = []
    authorizeMock.mockImplementation(async () => {
      order.push("authorize")
      return { ok: true, grant }
    })
    readBytesMock.mockImplementation(async () => {
      order.push("read")
      return bytes
    })
    reassertMock.mockImplementation(async () => {
      order.push("reassert")
      return { ok: true, grant }
    })

    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: true, bytes, artifactSha256: sha, byteSize: bytes.byteLength })
    expect(order).toEqual(["authorize", "read", "reassert"])
  })

  it("passes only the capability DIGEST to the store — never the value", async () => {
    await readT2PacketForCapability({ capabilityValue: VALUE })
    expect(authorizeMock).toHaveBeenCalledWith({ capabilityHash: HASH })
    expect(JSON.stringify(authorizeMock.mock.calls)).not.toContain(VALUE)
    expect(JSON.stringify(reassertMock.mock.calls)).not.toContain(VALUE)
  })

  it("reads private storage by content address, never by URL", async () => {
    await readT2PacketForCapability({ capabilityValue: VALUE })
    expect(readBytesMock).toHaveBeenCalledWith({ locator })
    expect(locator).not.toMatch(/https?:/)
  })

  it("refuses a malformed capability before any store call", async () => {
    await expect(
      readT2PacketForCapability({ capabilityValue: "too-short" }),
    ).resolves.toEqual({ ok: false, blocker: "INVALID_CAPABILITY" })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it("makes zero store calls while the flag is not exactly true", async () => {
    for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
      if (value === undefined) delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
      else process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = value
      await expect(
        readT2PacketForCapability({ capabilityValue: VALUE }),
      ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    }
    expect(authorizeMock).not.toHaveBeenCalled()
    expect(readBytesMock).not.toHaveBeenCalled()
  })

  it("never reads storage when authorization refuses", async () => {
    authorizeMock.mockResolvedValue({ ok: false, blocker: "CAPABILITY_REVOKED" })
    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: false, blocker: "CAPABILITY_REVOKED" })
    expect(readBytesMock).not.toHaveBeenCalled()
  })

  it("sanitizes a storage failure to a bounded code", async () => {
    readBytesMock.mockRejectedValue(new Error("private provider detail"))
    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: false, blocker: "STORAGE_READ_FAILED" })
    expect(reassertMock).not.toHaveBeenCalled()
  })

  it.each([
    ["different bytes at the content address", Buffer.from("%PDF-1.7 impostor\n")],
    ["a truncated object", bytes.subarray(0, 5)],
  ])("refuses %s rather than serving it", async (_label, stored) => {
    readBytesMock.mockResolvedValue(stored)
    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: false, blocker: "STORED_BYTES_MISMATCH" })
    expect(reassertMock).not.toHaveBeenCalled()
  })

  it("withholds bytes when authority lapsed during the storage read", async () => {
    reassertMock.mockResolvedValue({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
  })

  it("withholds bytes when activation is withdrawn during the storage read", async () => {
    readBytesMock.mockImplementation(async () => {
      delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
      return bytes
    })
    await expect(
      readT2PacketForCapability({ capabilityValue: VALUE }),
    ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    expect(reassertMock).not.toHaveBeenCalled()
  })
})

describe("the route boundary", () => {
  it("serves the packet with private, uncacheable headers", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="overtaxed-appeal-evidence.pdf"',
    )
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength))
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("cache-control")).toContain("private")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
  })

  it("never echoes the capability in a response header or body", async () => {
    const response = await POST(request())
    expect(JSON.stringify([...response.headers])).not.toContain(VALUE)
    const refused = await POST(request({ capability: "nope" }))
    expect(await refused.text()).not.toContain("nope")
  })

  it("refuses GET, so a capability can never travel in a URL", async () => {
    const response = await GET()
    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "METHOD_NOT_ALLOWED",
    })
  })

  it("is indistinguishable from a missing route while default-off", async () => {
    delete process.env.OT_T2_PACKET_DOWNLOAD_ENABLED
    const response = await POST(request())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "NOT_AVAILABLE" })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it.each([
    ["a non-JSON content type", { capability: VALUE }, { "content-type": "text/plain" }, 400, "INVALID_CONTENT_TYPE"],
    ["a malformed body", "{not json", {}, 400, "INVALID_REQUEST"],
    ["a missing capability", {}, {}, 400, "INVALID_REQUEST"],
    ["an extra field", { capability: VALUE, orderId: "ord_1" }, {}, 400, "INVALID_REQUEST"],
    ["a wrong-length capability", { capability: "abc" }, {}, 400, "INVALID_REQUEST"],
  ])("rejects %s", async (_label, body, headers, status, code) => {
    const response = await POST(
      request(body, headers as Record<string, string>, typeof body === "string"),
    )
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ ok: false, code })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it.each([
    ["CAPABILITY_EXPIRED", 410, "EXPIRED"],
    ["CAPABILITY_REVOKED", 410, "REVOKED"],
    ["CAPABILITY_EXHAUSTED", 410, "EXHAUSTED"],
    ["CAPABILITY_USE_NOT_CLAIMED", 410, "EXHAUSTED"],
    ["STORAGE_READ_FAILED", 503, "TEMPORARILY_UNAVAILABLE"],
    ["STORED_BYTES_MISMATCH", 503, "TEMPORARILY_UNAVAILABLE"],
  ])("maps %s to %i", async (blocker, status, code) => {
    authorizeMock.mockResolvedValue({ ok: false, blocker })
    const response = await POST(request())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ ok: false, code })
  })

  it.each([
    "CAPABILITY_NOT_FOUND",
    "CAPABILITY_BINDING_MISMATCH",
    "ARTIFACT_NOT_FOUND",
    "ARTIFACT_IDENTITY_MISMATCH",
    "ORDER_NOT_ELIGIBLE",
    "FULFILLMENT_NOT_DOWNLOADABLE",
    "PROPERTY_BINDING_UNVERIFIED",
  ])("collapses %s to an indistinguishable 404, revealing no oracle", async (blocker) => {
    authorizeMock.mockResolvedValue({ ok: false, blocker })
    const response = await POST(request())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "NOT_AVAILABLE" })
  })

  it("sanitizes an unexpected throw", async () => {
    authorizeMock.mockRejectedValue(new Error("private database detail"))
    const response = await POST(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "TEMPORARILY_UNAVAILABLE",
    })
  })

  it("logs a bounded code only, never a capability, digest or identifier", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    authorizeMock.mockResolvedValue({ ok: false, blocker: "CAPABILITY_NOT_FOUND" })
    await POST(request())
    expect(warn).toHaveBeenCalledWith(
      "[ot-packet-download] outcome=REFUSED code=CAPABILITY_NOT_FOUND",
    )
    const logged = warn.mock.calls.flat().join(" ")
    expect(logged).not.toContain(VALUE)
    expect(logged).not.toContain(HASH)
    expect(logged).not.toContain(grant.orderId)
    warn.mockRestore()
  })
})

describe("the request boundary is bounded and cannot carry a capability in a URL", () => {
  it("accepts a JSON media type with a charset parameter", async () => {
    const response = await POST(
      request({ capability: VALUE }, { "content-type": "application/json; charset=utf-8" }),
    )
    expect(response.status).toBe(200)
  })

  it("accepts a case-varied JSON media type", async () => {
    const response = await POST(
      request({ capability: VALUE }, { "content-type": "Application/JSON" }),
    )
    expect(response.status).toBe(200)
  })

  it.each([
    ["text/plain", "text/plain"],
    ["a JSON-suffixed but different type", "application/ld+json"],
    ["a form encoding", "application/x-www-form-urlencoded"],
    ["a missing type", ""],
  ])("refuses %s", async (_label, contentType) => {
    const response = await POST(request({ capability: VALUE }, { "content-type": contentType }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "INVALID_CONTENT_TYPE",
    })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it("refuses a POST that carries any query string, so no URL can bear a capability", async () => {
    const response = await POST(
      request({ capability: VALUE }, {}, false, `${URL_BASE}?capability=${VALUE}`),
    )
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ ok: false, code: "QUERY_NOT_ALLOWED" })
    expect(authorizeMock).not.toHaveBeenCalled()
    // The refusal never echoes the value it refused to read.
    expect(body).not.toContain(VALUE)
  })

  it("refuses an over-large body declared by Content-Length, without reading it", async () => {
    const padded = JSON.stringify({ capability: VALUE, pad: "x".repeat(4096) })
    const response = await POST(
      request(padded, { "content-length": String(Buffer.byteLength(padded)) }, true),
    )
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "REQUEST_TOO_LARGE",
    })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it("bounds a CHUNKED body that declares no length at all", async () => {
    // 64 KiB arriving in 64 chunks, no Content-Length. If the cap were enforced
    // on the header alone this would be buffered in full.
    const chunks = Array.from({ length: 64 }, () => "y".repeat(1024))
    const response = await POST(streamingRequest(['{"capability":"', ...chunks, '"}']))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "REQUEST_TOO_LARGE",
    })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it("still accepts a legitimate chunked body under the bound", async () => {
    const response = await POST(streamingRequest(['{"capability":', `"${VALUE}"`, "}"]))
    expect(response.status).toBe(200)
    expect(authorizeMock).toHaveBeenCalledWith({ capabilityHash: HASH })
  })

  it.each([
    ["a non-numeric Content-Length", "abc"],
    ["a negative Content-Length", "-1"],
  ])("refuses %s", async (_label, declared) => {
    const response = await POST(
      request(JSON.stringify({ capability: VALUE }), { "content-length": declared }, true),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "INVALID_REQUEST" })
    expect(authorizeMock).not.toHaveBeenCalled()
  })

  it("logs nothing at all for a rejected request, so no raw token can reach a log", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const log = jest.spyOn(console, "log").mockImplementation(() => {})
    const error = jest.spyOn(console, "error").mockImplementation(() => {})
    await POST(request({ capability: VALUE }, {}, false, `${URL_BASE}?capability=${VALUE}`))
    await POST(streamingRequest([`{"capability":"${VALUE}","pad":"${"z".repeat(4096)}"}`]))
    await POST(request({ capability: VALUE }, { "content-type": "text/plain" }))
    for (const spy of [warn, log, error]) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
})

describe("the read path against a real injected store", () => {
  const PIN = "12345678901234"
  const ADDRESS = "100 Evidence Lane, Chicago IL"
  const FINGERPRINT = computePropertyBindingFingerprint({
    orderId: "ord_paid_t2",
    propertyPin: PIN,
    propertyAddress: ADDRESS,
  })
  const SERVICE_NOW = "2026-09-12T12:00:00.000Z"

  type World = {
    now: string
    capability: PacketDownloadCapabilityRow | null
    artifact: {
      id: string
      fulfillmentId: string
      version: number
      artifactSha256: string
      byteSize: number
      storageLocator: string
      sourceOrderId: string | null
      propertyBindingFingerprint: string | null
    } | null
    fulfillment: PacketDownloadFulfillmentRow | null
    order: PacketDownloadOrderRow | null
  }

  function world(): World {
    return {
      now: SERVICE_NOW,
      capability: {
        id: "cap_1",
        capabilityHash: HASH,
        fulfillmentId: "ful_t2",
        artifactId: "art_v1",
        artifactVersion: 1,
        artifactSha256: sha,
        sourceOrderId: "ord_paid_t2",
        propertyBindingFingerprint: FINGERPRINT,
        expiresAt: "2026-09-13T12:00:00.000Z",
        maxUses: 3,
        useCount: 0,
        revokedAt: null,
      },
      artifact: {
        id: "art_v1",
        fulfillmentId: "ful_t2",
        version: 1,
        artifactSha256: sha,
        byteSize: bytes.byteLength,
        storageLocator: locator,
        sourceOrderId: "ord_paid_t2",
        propertyBindingFingerprint: FINGERPRINT,
      },
      fulfillment: {
        id: "ful_t2",
        orderId: "ord_paid_t2",
        kind: "T2_APPEAL_EVIDENCE",
        status: "PROVIDER_ACCEPTED",
      },
      order: {
        id: "ord_paid_t2",
        tier: "T2",
        status: "PAID",
        propertyPin: PIN,
        propertyAddress: ADDRESS,
      },
    }
  }

  /**
   * A store that runs the REAL decision against real rows and reproduces the
   * SQL store's semantics — the one-use compare-and-set, the flag rollback, and
   * the re-read judged against the count the grant was CLAIMED FROM.
   */
  function injectedStore(
    w: World,
    env: Record<string, string | undefined>,
  ): PacketDownloadStore {
    const rows = () => ({
      trustedNow: w.now,
      capability: w.capability,
      artifact: w.artifact,
      fulfillment: w.fulfillment,
      order: w.order,
    })
    return {
      issue: async () => {
        throw new Error("issuance is not exercised on the read path")
      },
      revoke: async () => {
        throw new Error("revocation is not exercised on the read path")
      },
      async authorize({ capabilityHash }) {
        if (!t2PacketDownloadEnabled(env)) return { ok: false, blocker: "FLAG_DISABLED" }
        const decision = decidePacketDownload({
          flagEnabled: t2PacketDownloadEnabled(env),
          capabilityHash,
          ...rows(),
        })
        if (!decision.ok) return decision
        const grant = decision.grant
        const capability = w.capability
        if (
          !capability ||
          capability.useCount !== grant.expectedUseCount ||
          capability.revokedAt !== null
        ) {
          return { ok: false, blocker: "CAPABILITY_USE_NOT_CLAIMED" }
        }
        capability.useCount = grant.nextUseCount
        if (!t2PacketDownloadEnabled(env)) {
          // The claim rolls back with the transaction; no use is spent.
          capability.useCount = grant.expectedUseCount
          return { ok: false, blocker: "FLAG_DISABLED" }
        }
        return { ok: true, grant }
      },
      async reassert({ capabilityHash, grant }) {
        if (!t2PacketDownloadEnabled(env)) return { ok: false, blocker: "FLAG_DISABLED" }
        const capability = w.capability
        if (!capability) return { ok: false, blocker: "CAPABILITY_NOT_FOUND" }
        const decision = decidePacketDownload({
          flagEnabled: t2PacketDownloadEnabled(env),
          capabilityHash,
          ...rows(),
          capability: { ...capability, useCount: grant.expectedUseCount },
        })
        if (!decision.ok) return decision
        if (capability.useCount < grant.nextUseCount)
          return { ok: false, blocker: "CAPABILITY_USE_NOT_CLAIMED" }
        return { ok: true, grant }
      },
    }
  }

  function run(
    w: World,
    env: Record<string, string | undefined>,
    readBytes: (input: { locator: string }) => Promise<Buffer>,
  ) {
    return readT2PacketForCapability(
      { capabilityValue: VALUE },
      { env, store: injectedStore(w, env), readBytes },
    )
  }

  const live = () => ({ OT_T2_PACKET_DOWNLOAD_ENABLED: "true" }) as Record<
    string,
    string | undefined
  >

  it("serves the packet and spends exactly one use", async () => {
    const w = world()
    await expect(run(w, live(), async () => bytes)).resolves.toEqual({
      ok: true,
      bytes,
      artifactSha256: sha,
      byteSize: bytes.byteLength,
    })
    expect(w.capability?.useCount).toBe(1)
  })

  it("withholds bytes when the capability is REVOKED during the storage read", async () => {
    const w = world()
    await expect(
      run(w, live(), async () => {
        if (w.capability) w.capability.revokedAt = "2026-09-12T12:00:01.000Z"
        return bytes
      }),
    ).resolves.toEqual({ ok: false, blocker: "CAPABILITY_REVOKED" })
  })

  it("withholds bytes when the order is REFUNDED during the storage read", async () => {
    const w = world()
    await expect(
      run(w, live(), async () => {
        if (w.order) w.order.status = "REFUNDED"
        return bytes
      }),
    ).resolves.toEqual({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
  })

  it("withholds bytes when the fulfillment goes terminal during the storage read", async () => {
    const w = world()
    await expect(
      run(w, live(), async () => {
        if (w.fulfillment) w.fulfillment.status = "BOUNCED"
        return bytes
      }),
    ).resolves.toEqual({ ok: false, blocker: "FULFILLMENT_NOT_DOWNLOADABLE" })
  })

  it("withholds bytes when the order's property drifts during the storage read", async () => {
    const w = world()
    await expect(
      run(w, live(), async () => {
        if (w.order) w.order.propertyPin = "99999999999999"
        return bytes
      }),
    ).resolves.toEqual({ ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" })
  })

  it.each([
    ["impostor bytes at the content address", Buffer.from("%PDF-1.7 impostor\n")],
    ["a truncated object", bytes.subarray(0, 5)],
  ])("refuses %s before authority is even re-read", async (_label, stored) => {
    const w = world()
    await expect(run(w, live(), async () => stored)).resolves.toEqual({
      ok: false,
      blocker: "STORED_BYTES_MISMATCH",
    })
    // The use was still spent: a claimed use is not refunded by a bad object.
    expect(w.capability?.useCount).toBe(1)
  })

  it("permits the FINAL use of a single-use capability, then exhausts it", async () => {
    const w = world()
    if (w.capability) w.capability.maxUses = 1
    const env = live()
    await expect(run(w, env, async () => bytes)).resolves.toMatchObject({ ok: true })
    expect(w.capability?.useCount).toBe(1)
    await expect(run(w, env, async () => bytes)).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_EXHAUSTED",
    })
  })

  it("refuses an expired capability against the store's own clock", async () => {
    const w = world()
    w.now = "2026-09-14T12:00:00.000Z"
    await expect(run(w, live(), async () => bytes)).resolves.toEqual({
      ok: false,
      blocker: "CAPABILITY_EXPIRED",
    })
  })

  it.each([
    ["before the authorize", "authorize"],
    ["during the storage read", "read"],
    ["during the re-read", "reassert"],
  ])(
    "cannot be bypassed by a flag withdrawal %s",
    async (_label, when) => {
      const w = world()
      const env = live()
      if (when === "authorize") delete env.OT_T2_PACKET_DOWNLOAD_ENABLED
      const store = injectedStore(w, env)
      const wrapped: PacketDownloadStore = {
        ...store,
        async reassert(input) {
          if (when === "reassert") delete env.OT_T2_PACKET_DOWNLOAD_ENABLED
          return store.reassert(input)
        },
      }
      await expect(
        readT2PacketForCapability(
          { capabilityValue: VALUE },
          {
            env,
            store: wrapped,
            readBytes: async () => {
              if (when === "read") delete env.OT_T2_PACKET_DOWNLOAD_ENABLED
              return bytes
            },
          },
        ),
      ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    },
  )

  it("re-checks activation AFTER the re-read, not only before it", async () => {
    const w = world()
    const env = live()
    const store = injectedStore(w, env)
    const wrapped: PacketDownloadStore = {
      ...store,
      async reassert(input) {
        // The re-read succeeds; the withdrawal lands as it returns.
        const result = await store.reassert(input)
        delete env.OT_T2_PACKET_DOWNLOAD_ENABLED
        return result
      },
    }
    await expect(
      readT2PacketForCapability(
        { capabilityValue: VALUE },
        { env, store: wrapped, readBytes: async () => bytes },
      ),
    ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
  })
})

describe("source contract: no URL-borne capability, no unverified ownership", () => {
  const ROOT = process.cwd()
  const routeSource = readFileSync(
    join(ROOT, "app/api/ot/packet/download/route.ts"),
    "utf8",
  )
  const serviceSource = readFileSync(
    join(ROOT, "lib/fulfillment-runtime/packet-download.ts"),
    "utf8",
  )
  const storeSource = readFileSync(
    join(ROOT, "lib/fulfillment-runtime/packet-download-store.ts"),
    "utf8",
  )

  it("never reads a capability from the URL, query string, or path params", () => {
    for (const source of [routeSource, serviceSource]) {
      expect(source).not.toMatch(/searchParams|nextUrl\.search|context\.params/)
    }
  })

  it("never derives ownership from an email, session, or customer identity", () => {
    for (const source of [routeSource, serviceSource, storeSource]) {
      expect(source.toLowerCase()).not.toMatch(
        /getsession|getserversession|auth\(\)|"email"|\.email\b/,
      )
    }
  })

  it("never constructs, signs, or returns a storage URL", () => {
    for (const source of [routeSource, serviceSource, storeSource]) {
      expect(source).not.toMatch(/getSignedUrl|createSignedUrl|blobUrl|publicUrl|@vercel\/blob/)
    }
  })

  it("keeps the capability value out of every persisted column", () => {
    // The store only ever handles `capabilityHash`.
    expect(storeSource).not.toMatch(/capabilityValue|capability_value/)
    expect(storeSource).toContain("capability_hash")
  })
})
