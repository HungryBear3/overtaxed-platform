/** @jest-environment node */

const bindMock = jest.fn()
const transactionMock = jest.fn()
const readBackMock = jest.fn()

jest.mock("@/lib/fulfillment-runtime/t2-artifact-storage", () => ({
  readT2ArtifactBytes: (...args: unknown[]) => readBackMock(...args),
}))

jest.mock("@/lib/fulfillment-runtime/artifact-binding-store", () => ({
  prismaArtifactBindingStore: { bind: (...args: unknown[]) => bindMock(...args) },
  createPrismaArtifactBindingStore: (client: { $transaction: typeof transactionMock }) => ({
    bind: async () => {
      if (process.env.OT_T2_ARTIFACT_BINDING_ENABLED !== "true") {
        return { ok: false, blocker: "FLAG_DISABLED" }
      }
      return client.$transaction()
    },
  }),
}))

import { bindT2Artifact, type BindT2ArtifactCommand } from "@/lib/fulfillment-runtime/bind-artifact"
import { createPrismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store"
import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest"

const bytes = Buffer.from("%PDF-1.7 hardened binding\n")
const sha = computeArtifactSha256(bytes)

function command(): BindT2ArtifactCommand {
  return {
    orderId: "ord_modern",
    fulfillmentId: "ful_modern",
    bytes,
    provenance: {
      sourceOrderId: "ord_modern",
      propertyPin: "09000000000000",
      propertyAddress: "123 Main St",
      generatorVersion: "t2-generator-v1",
      templateVersion: "t2-template-v1",
      generatedAt: "2026-08-10T12:00:00.000Z",
    },
  }
}

describe("production artifact binder activation boundary", () => {
  const prior = process.env.OT_T2_ARTIFACT_BINDING_ENABLED

  beforeEach(() => {
    bindMock.mockReset()
    transactionMock.mockReset()
    readBackMock.mockReset()
    readBackMock.mockResolvedValue(bytes)
    delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
  })

  afterAll(() => {
    if (prior === undefined) delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
    else process.env.OT_T2_ARTIFACT_BINDING_ENABLED = prior
  })

  it.each([undefined, "", "false", "TRUE", "1", " true "])(
    "uses only the strict ambient flag and makes zero store calls for %p",
    async (value) => {
      if (value === undefined) delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      else process.env.OT_T2_ARTIFACT_BINDING_ENABLED = value
      await expect(bindT2Artifact(command())).resolves.toEqual({
        outcome: "DISABLED",
        blocker: "FLAG_DISABLED",
      })
      expect(bindMock).not.toHaveBeenCalled()
    },
  )

  it("cannot be enabled by the already-live Phase 1 evidence flag", async () => {
    process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED = "true"
    await expect(bindT2Artifact(command())).resolves.toEqual({
      outcome: "DISABLED",
      blocker: "FLAG_DISABLED",
    })
    expect(bindMock).not.toHaveBeenCalled()
    delete process.env.OT_T2_FULFILLMENT_EVIDENCE_ENABLED
  })

  it("calls the fixed production store when the ambient flag is exactly true", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    bindMock.mockResolvedValue({ ok: true, created: true, artifactId: "art_1", artifactSha256: sha })
    await expect(bindT2Artifact(command())).resolves.toEqual({
      outcome: "BOUND",
      created: true,
      artifactId: "art_1",
      artifactSha256: sha,
    })
    expect(bindMock).toHaveBeenCalledWith(command())
  })

  it("passes a store refusal through as a bounded blocker", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    bindMock.mockResolvedValue({ ok: false, blocker: "INELIGIBLE_SETTLEMENT" })
    await expect(bindT2Artifact(command())).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "INELIGIBLE_SETTLEMENT",
    })
  })

  it("strips caller-smuggled activation, clock, locator, and digest fields", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    bindMock.mockResolvedValue({ ok: true, created: true, artifactId: "art_1", artifactSha256: sha })
    const hostile = {
      ...command(),
      flagEnabled: true,
      trustedNow: "2099-01-01T00:00:00.000Z",
      storageLocator: "attacker/path.pdf",
      assertedSha256: "f".repeat(64),
    } as BindT2ArtifactCommand

    await bindT2Artifact(hostile)
    expect(bindMock).toHaveBeenCalledWith({
      orderId: command().orderId,
      fulfillmentId: command().fulfillmentId,
      bytes,
      provenance: command().provenance,
    })
  })

  it("verifies the exact content-addressed stored bytes before the store call", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    bindMock.mockResolvedValue({ ok: true, created: true, artifactId: "art_1", artifactSha256: sha })
    await bindT2Artifact(command())
    expect(readBackMock).toHaveBeenCalledWith({ locator: `t2-artifacts/sha256/${sha}.pdf` })
    expect(readBackMock.mock.invocationCallOrder[0]).toBeLessThan(bindMock.mock.invocationCallOrder[0])
  })

  it("refuses stored-byte mismatch before the store or transaction", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    readBackMock.mockResolvedValue(Buffer.from("different persisted bytes"))
    await expect(bindT2Artifact(command())).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "STORED_BYTES_MISMATCH",
    })
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("refuses before the store when activation is withdrawn during read-back", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    readBackMock.mockImplementation(async () => {
      delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      return bytes
    })
    await expect(bindT2Artifact(command())).resolves.toEqual({
      outcome: "DISABLED",
      blocker: "FLAG_DISABLED",
    })
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("does not expose caller-controlled env/store options", () => {
    const source = require("node:fs").readFileSync(
      require.resolve("@/lib/fulfillment-runtime/bind-artifact"),
      "utf8",
    )
    expect(source).not.toMatch(/env\?\s*:/)
    expect(source).not.toMatch(/store\?\s*:/)
    expect(source).not.toMatch(/options\.env|options\.store/)
  })

  it("does not accept a caller-supplied storage locator", () => {
    expect(Object.keys(command())).not.toContain("storageLocator")
  })
})

describe("production Prisma store factory", () => {
  beforeEach(() => {
    transactionMock.mockReset()
    delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
  })

  it("has no exported enablement injection and opens zero transactions when ambient flag is off", async () => {
    const client = { $transaction: transactionMock }
    const store = createPrismaArtifactBindingStore(client as never)
    await expect(store.bind(command() as never)).resolves.toEqual({
      ok: false,
      blocker: "FLAG_DISABLED",
    })
    expect(transactionMock).not.toHaveBeenCalled()

    const source = require("node:fs").readFileSync(
      require.resolve("@/lib/fulfillment-runtime/artifact-binding-store"),
      "utf8",
    )
    expect(source).not.toMatch(/isBindingEnabled/)
  })
})
