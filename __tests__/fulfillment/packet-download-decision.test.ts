/** @jest-environment node */

import { createHash, randomBytes } from "node:crypto"
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import {
  DOWNLOADABLE_FULFILLMENT_STATUSES,
  PACKET_DOWNLOAD_BLOCKERS,
  PACKET_DOWNLOAD_CAPABILITY_LENGTH,
  decideCapabilityIssuance,
  decidePacketDownload,
  hashPacketDownloadCapability,
  isValidPacketDownloadCapability,
  type PacketDownloadInput,
} from "@/lib/fulfillment/packet-download"
import { FULFILLMENT_STATUSES, TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types"

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

function input(overrides: Partial<PacketDownloadInput> = {}): PacketDownloadInput {
  return {
    flagEnabled: true,
    trustedNow: NOW,
    capabilityHash: HASH,
    capability: {
      id: "cap_1",
      capabilityHash: HASH,
      fulfillmentId: FULFILLMENT_ID,
      artifactId: ARTIFACT_ID,
      artifactVersion: 1,
      artifactSha256: sha,
      sourceOrderId: ORDER_ID,
      propertyBindingFingerprint: fingerprint,
      expiresAt: "2026-09-19T12:00:00.000Z",
      maxUses: 5,
      useCount: 0,
      revokedAt: null,
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
    fulfillment: {
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      kind: "T2_APPEAL_EVIDENCE",
      status: "DELIVERED",
    },
    order: {
      id: ORDER_ID,
      tier: "T2",
      status: "PAID",
      propertyPin: PIN,
      propertyAddress: ADDRESS,
    },
    ...overrides,
  }
}

function capability(patch: Record<string, unknown>): Partial<PacketDownloadInput> {
  return { capability: { ...input().capability!, ...patch } }
}

describe("capability values are opaque, high-entropy, and never stored", () => {
  it("accepts exactly 43 base64url characters — 256 bits of entropy", () => {
    expect(VALUE).toHaveLength(PACKET_DOWNLOAD_CAPABILITY_LENGTH)
    expect(isValidPacketDownloadCapability(VALUE)).toBe(true)
  })

  it.each([
    ["empty", ""],
    ["short", randomBytes(16).toString("base64url")],
    ["padded base64", `${randomBytes(32).toString("base64")}`],
    ["hex digest", sha],
    ["whitespace-padded", ` ${VALUE}`],
    ["newline-bearing", `${VALUE}\n`],
    ["non-string", 12345],
    ["null", null],
  ])("rejects a %s capability without hashing it", (_label, value) => {
    expect(isValidPacketDownloadCapability(value)).toBe(false)
    expect(hashPacketDownloadCapability(value)).toBeNull()
  })

  it("hashes under its own domain, so a digest from another namespace never aliases", () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/)
    const undomained = createHash("sha256").update(VALUE, "utf8").digest("hex")
    expect(HASH).not.toBe(undomained)
    // Same value, stable key.
    expect(hashPacketDownloadCapability(VALUE)).toBe(HASH)
  })

  it("never returns the value from a decision", () => {
    const decision = decidePacketDownload(input())
    expect(JSON.stringify(decision)).not.toContain(VALUE)
  })
})

describe("an authorized download", () => {
  it("grants the exact bound artifact identity and one claimable use", () => {
    expect(decidePacketDownload(input())).toEqual({
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
  })

  it("carries no PIN, address, email or locator-derived URL", () => {
    const serialized = JSON.stringify(decidePacketDownload(input()))
    expect(serialized).not.toContain(PIN)
    expect(serialized).not.toContain(ADDRESS)
    expect(serialized).not.toContain(fingerprint)
    expect(serialized).not.toMatch(/https?:/)
  })
})

describe("activation and clock", () => {
  it.each([false, undefined, "true", 1])(
    "refuses everything unless the flag is exactly boolean true (%p)",
    (flagEnabled) => {
      expect(
        decidePacketDownload(
          input({ flagEnabled: flagEnabled as unknown as boolean }),
        ),
      ).toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    },
  )

  it.each(["", "not-a-time", "2026-09-12", "2026-09-12T12:00:00", 0])(
    "refuses an untrusted clock (%p) rather than falling back",
    (trustedNow) => {
      expect(
        decidePacketDownload(
          input({ trustedNow: trustedNow as unknown as string }),
        ),
      ).toEqual({ ok: false, blocker: "UNTRUSTED_CLOCK" })
    },
  )
})

describe("capability lifecycle", () => {
  it("refuses a capability that does not exist", () => {
    expect(decidePacketDownload(input({ capability: null }))).toEqual({
      ok: false,
      blocker: "CAPABILITY_NOT_FOUND",
    })
  })

  it("refuses a row whose hash is not the one that was looked up", () => {
    expect(
      decidePacketDownload(input(capability({ capabilityHash: "a".repeat(64) }))),
    ).toEqual({ ok: false, blocker: "CAPABILITY_NOT_FOUND" })
  })

  it("refuses a lookup key that is not a well-formed digest", () => {
    expect(decidePacketDownload(input({ capabilityHash: VALUE }))).toEqual({
      ok: false,
      blocker: "INVALID_CAPABILITY",
    })
  })

  it("reports revocation ahead of expiry", () => {
    expect(
      decidePacketDownload(
        input(capability({ revokedAt: "2026-09-11T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z" })),
      ),
    ).toEqual({ ok: false, blocker: "CAPABILITY_REVOKED" })
  })

  it.each([
    ["past", "2026-09-12T11:59:59.999Z"],
    ["exactly now", NOW],
    ["unparseable", "whenever"],
    ["absent", null],
  ])("refuses a %s expiry", (_label, expiresAt) => {
    expect(decidePacketDownload(input(capability({ expiresAt })))).toEqual({
      ok: false,
      blocker: "CAPABILITY_EXPIRED",
    })
  })

  it("refuses once the use budget is spent", () => {
    expect(
      decidePacketDownload(input(capability({ maxUses: 3, useCount: 3 }))),
    ).toEqual({ ok: false, blocker: "CAPABILITY_EXHAUSTED" })
  })

  it("authorizes the final use of the budget", () => {
    const decision = decidePacketDownload(
      input(capability({ maxUses: 3, useCount: 2 })),
    )
    expect(decision).toMatchObject({ ok: true, grant: { expectedUseCount: 2, nextUseCount: 3 } })
  })

  it.each([
    ["zero max", { maxUses: 0 }],
    ["absurd max", { maxUses: 10_000 }],
    ["fractional max", { maxUses: 1.5 }],
    ["negative count", { useCount: -1 }],
    ["non-numeric count", { useCount: "2" }],
  ])("refuses a malformed use budget (%s) rather than normalizing it", (_label, patch) => {
    expect(decidePacketDownload(input(capability(patch)))).toEqual({
      ok: false,
      blocker: "INVALID_CAPABILITY",
    })
  })
})

describe("binding: a capability can never cross packets, orders, or properties", () => {
  it("refuses when the fulfillment is missing", () => {
    expect(decidePacketDownload(input({ fulfillment: null }))).toEqual({
      ok: false,
      blocker: "FULFILLMENT_NOT_FOUND",
    })
  })

  it.each([
    ["a different fulfillment row", { fulfillment: { id: "ful_other", orderId: ORDER_ID, kind: "T2_APPEAL_EVIDENCE", status: "DELIVERED" } }],
    ["a non-T2 kind", { fulfillment: { id: FULFILLMENT_ID, orderId: ORDER_ID, kind: "T3_MANUAL", status: "DELIVERED" } }],
    ["a re-parented fulfillment", { fulfillment: { id: FULFILLMENT_ID, orderId: "ord_other", kind: "T2_APPEAL_EVIDENCE", status: "DELIVERED" } }],
  ])("refuses %s", (_label, overrides) => {
    expect(decidePacketDownload(input(overrides as Partial<PacketDownloadInput>))).toEqual({
      ok: false,
      blocker: "CAPABILITY_BINDING_MISMATCH",
    })
  })

  it("refuses a capability minted against a different order", () => {
    expect(
      decidePacketDownload(input(capability({ sourceOrderId: "ord_other" }))),
    ).toEqual({ ok: false, blocker: "CAPABILITY_BINDING_MISMATCH" })
  })

  it("refuses when the order is missing", () => {
    expect(decidePacketDownload(input({ order: null }))).toEqual({
      ok: false,
      blocker: "ORDER_NOT_FOUND",
    })
  })

  it("refuses when the artifact row is gone", () => {
    expect(decidePacketDownload(input({ artifact: null }))).toEqual({
      ok: false,
      blocker: "ARTIFACT_NOT_FOUND",
    })
  })

  it.each([
    ["a different artifact row id", { id: "art_other" }],
    ["a foreign fulfillment", { fulfillmentId: "ful_other" }],
    ["a superseded version", { version: 2 }],
    ["a different content digest", { artifactSha256: computeArtifactSha256(Buffer.from("other")) }],
    ["a malformed digest", { artifactSha256: "NOTHEX" }],
    ["a foreign source order", { sourceOrderId: "ord_other" }],
    ["a zero byte size", { byteSize: 0 }],
  ])("refuses %s", (_label, patch) => {
    expect(
      decidePacketDownload(input({ artifact: { ...input().artifact!, ...patch } })),
    ).toEqual({ ok: false, blocker: "ARTIFACT_IDENTITY_MISMATCH" })
  })

  it.each([
    ["a public bearer URL", "https://blob.example.com/packet.pdf"],
    ["an absolute path", "/t2-artifacts/x.pdf"],
    ["a signed query", "t2-artifacts/x.pdf?sig=abc"],
    ["a path that is not the content address", "t2-artifacts/sha256/other.pdf"],
  ])("refuses %s as a storage locator", (_label, storageLocator) => {
    expect(
      decidePacketDownload(input({ artifact: { ...input().artifact!, storageLocator } })),
    ).toEqual({ ok: false, blocker: "INVALID_STORAGE_LOCATOR" })
  })
})

describe("authoritative settlement is re-read on every use", () => {
  it.each([
    ["refunded", { status: "REFUNDED" }],
    ["cancelled", { status: "CANCELLED" }],
    ["pending", { status: "PENDING" }],
    ["recovery-required", { status: "PAID_RECOVERY_REQUIRED" }],
    ["flagged refunded", { refunded: true }],
    ["flagged disputed", { disputed: true }],
    ["non-T2 tier", { tier: "T3" }],
  ])("refuses a %s order even with a live capability", (_label, patch) => {
    expect(
      decidePacketDownload(input({ order: { ...input().order!, ...patch } })),
    ).toEqual({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
  })
})

describe("lifecycle: terminal outcomes are never resurrected", () => {
  const downloadable = [...DOWNLOADABLE_FULFILLMENT_STATUSES]

  it.each(downloadable)("authorizes a %s fulfillment", (status) => {
    expect(
      decidePacketDownload(input({ fulfillment: { ...input().fulfillment!, status } })),
    ).toMatchObject({ ok: true })
  })

  it("excludes every terminal-lock status by construction", () => {
    for (const status of TERMINAL_LOCK_STATUSES) {
      expect(DOWNLOADABLE_FULFILLMENT_STATUSES.has(status)).toBe(false)
    }
  })

  it.each(FULFILLMENT_STATUSES.filter((s) => !DOWNLOADABLE_FULFILLMENT_STATUSES.has(s)))(
    "refuses a %s fulfillment",
    (status) => {
      expect(
        decidePacketDownload(input({ fulfillment: { ...input().fulfillment!, status } })),
      ).toEqual({ ok: false, blocker: "FULFILLMENT_NOT_DOWNLOADABLE" })
    },
  )
})

describe("property binding must still describe this order's property", () => {
  it("refuses a packet whose fingerprint drifted from the order", () => {
    expect(
      decidePacketDownload(
        input({ order: { ...input().order!, propertyPin: "09000000000001" } }),
      ),
    ).toEqual({ ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" })
  })

  it.each([
    ["absent", null],
    ["empty", ""],
    ["malformed", "not-a-fingerprint"],
  ])("refuses a %s stored fingerprint", (_label, propertyBindingFingerprint) => {
    expect(
      decidePacketDownload(
        input({
          artifact: { ...input().artifact!, propertyBindingFingerprint },
          capability: { ...input().capability!, propertyBindingFingerprint: propertyBindingFingerprint as string },
        }),
      ),
    ).toEqual({ ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" })
  })

  it("refuses when the capability was minted against a different binding", () => {
    expect(
      decidePacketDownload(
        input(capability({ propertyBindingFingerprint: "b".repeat(64) })),
      ),
    ).toEqual({ ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" })
  })

  it("refuses when the order lacks the inputs needed to verify", () => {
    expect(
      decidePacketDownload(
        input({ order: { ...input().order!, propertyAddress: null } }),
      ),
    ).toEqual({ ok: false, blocker: "PROPERTY_BINDING_UNVERIFIED" })
  })
})

describe("issuance applies every download gate plus a bounded lifetime", () => {
  const issuance = {
    flagEnabled: true,
    trustedNow: NOW,
    capabilityHash: HASH,
    ttlSeconds: 7 * 24 * 60 * 60,
    maxUses: 5,
    artifact: input().artifact,
    fulfillment: input().fulfillment,
    order: input().order,
  }

  it("mints a durable row bound to the artifact, order and property", () => {
    expect(decideCapabilityIssuance(issuance)).toEqual({
      ok: true,
      capability: {
        capabilityHash: HASH,
        fulfillmentId: FULFILLMENT_ID,
        artifactId: ARTIFACT_ID,
        artifactVersion: 1,
        artifactSha256: sha,
        sourceOrderId: ORDER_ID,
        propertyBindingFingerprint: fingerprint,
        issuedAt: NOW,
        expiresAt: "2026-09-19T12:00:00.000Z",
        maxUses: 5,
      },
    })
  })

  it("never embeds the capability value in the durable row", () => {
    expect(JSON.stringify(decideCapabilityIssuance(issuance))).not.toContain(VALUE)
  })

  it.each([
    ["zero", 0],
    ["sub-minute", 59],
    ["beyond 30 days", 31 * 24 * 60 * 60],
    ["fractional", 90.5],
    ["non-numeric", "3600"],
  ])("refuses a %s TTL rather than clamping it", (_label, ttlSeconds) => {
    expect(
      decideCapabilityIssuance({ ...issuance, ttlSeconds: ttlSeconds as number }),
    ).toEqual({ ok: false, blocker: "INVALID_CAPABILITY" })
  })

  it("refuses to mint against a refunded order", () => {
    expect(
      decideCapabilityIssuance({
        ...issuance,
        order: { ...issuance.order!, status: "REFUNDED" },
      }),
    ).toEqual({ ok: false, blocker: "ORDER_NOT_ELIGIBLE" })
  })

  it("refuses to mint from a terminal fulfillment", () => {
    expect(
      decideCapabilityIssuance({
        ...issuance,
        fulfillment: { ...issuance.fulfillment!, status: "BOUNCED" },
      }),
    ).toEqual({ ok: false, blocker: "FULFILLMENT_NOT_DOWNLOADABLE" })
  })

  it("refuses when no artifact has been bound yet", () => {
    expect(decideCapabilityIssuance({ ...issuance, artifact: null })).toEqual({
      ok: false,
      blocker: "ARTIFACT_NOT_FOUND",
    })
  })
})

describe("refusal vocabulary", () => {
  it("is closed and non-PII", () => {
    for (const blocker of PACKET_DOWNLOAD_BLOCKERS) {
      expect(blocker).toMatch(/^[A-Z0-9_]+$/)
    }
  })

  it("names every blocker the decision can actually return", () => {
    const returned = new Set<string>()
    const cases: Array<Partial<PacketDownloadInput>> = [
      { flagEnabled: false },
      { capabilityHash: "nope" },
      { capability: null },
      capability({ revokedAt: NOW }),
      capability({ expiresAt: null }),
      capability({ maxUses: 1, useCount: 1 }),
      { fulfillment: null },
      { order: null },
      { artifact: null },
      { trustedNow: "" },
    ]
    for (const override of cases) {
      const decision = decidePacketDownload(input(override))
      if (!decision.ok) returned.add(decision.blocker)
    }
    for (const blocker of returned) {
      expect(PACKET_DOWNLOAD_BLOCKERS.has(blocker)).toBe(true)
    }
    expect(returned.size).toBeGreaterThanOrEqual(9)
  })
})
