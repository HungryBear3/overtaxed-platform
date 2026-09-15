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
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import { hashPacketDownloadCapability } from "@/lib/fulfillment/packet-download"
import { readT2PacketForCapability } from "@/lib/fulfillment-runtime/packet-download"
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

function request(
  body: unknown = { capability: VALUE },
  headers: Record<string, string> = {},
  raw = false,
) {
  return new Request("https://overtaxed.example/api/ot/packet/download", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest
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
