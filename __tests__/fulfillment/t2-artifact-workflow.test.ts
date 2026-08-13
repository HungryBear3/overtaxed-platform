/** @jest-environment node */

const generateMock = jest.fn()
const uploadMock = jest.fn()
const readBackMock = jest.fn()
const reconcileMock = jest.fn()
const bindMock = jest.fn()

jest.mock("@/lib/fulfillment-runtime/t2-artifact-producer", () => ({
  generateT2Artifact: (...args: unknown[]) => generateMock(...args),
}))
jest.mock("@/lib/fulfillment-runtime/t2-artifact-storage", () => ({
  uploadT2Artifact: (...args: unknown[]) => uploadMock(...args),
  readT2ArtifactBytes: (...args: unknown[]) => readBackMock(...args),
  reconcileUnboundT2Artifact: (...args: unknown[]) => reconcileMock(...args),
}))
jest.mock("@/lib/fulfillment-runtime/bind-artifact", () => ({
  bindT2Artifact: (...args: unknown[]) => bindMock(...args),
}))

import { runT2ArtifactBindingWorkflow } from "@/lib/fulfillment-runtime/t2-artifact-workflow"
import { computeArtifactSha256 } from "@/lib/fulfillment/artifact-digest"
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"

const bytes = Buffer.from("%PDF-1.7 genuine T2 bytes\n")
const sha = computeArtifactSha256(bytes)
const locator = `t2-artifacts/sha256/${sha}.pdf`
const provenance = {
  sourceOrderId: "ord_1",
  propertyPin: "09000000000000",
  propertyAddress: "123 Main St",
  generatorVersion: "t2-generator-v1",
  templateVersion: "t2-template-v1",
  generatedAt: "2026-08-10T12:00:00.000Z",
}

function generated() {
  generateMock.mockResolvedValue({ ok: true, bytes, provenance })
  uploadMock.mockResolvedValue({ locator, created: true })
  readBackMock.mockResolvedValue(bytes)
  bindMock.mockResolvedValue({
    outcome: "BOUND",
    created: true,
    artifactId: "art_1",
    artifactSha256: sha,
  })
}

describe("server-only T2 artifact workflow", () => {
  const prior = process.env.OT_T2_ARTIFACT_BINDING_ENABLED

  beforeEach(() => {
    for (const mock of [generateMock, uploadMock, readBackMock, reconcileMock, bindMock]) {
      mock.mockReset()
    }
    delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
  })

  afterAll(() => {
    if (prior === undefined) delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
    else process.env.OT_T2_ARTIFACT_BINDING_ENABLED = prior
  })

  it.each([undefined, "", "false", "TRUE", "1", " true "])(
    "makes zero generation/storage/bind calls while ambient flag is %p",
    async (value) => {
      if (value === undefined) delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      else process.env.OT_T2_ARTIFACT_BINDING_ENABLED = value
      await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
        outcome: "DISABLED",
        blocker: "FLAG_DISABLED",
      })
      expect(generateMock).not.toHaveBeenCalled()
      expect(uploadMock).not.toHaveBeenCalled()
      expect(readBackMock).not.toHaveBeenCalled()
      expect(bindMock).not.toHaveBeenCalled()
      expect(reconcileMock).not.toHaveBeenCalled()
    },
  )

  it("preserves HOLD when the repository producer is explicitly unavailable", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generateMock.mockResolvedValue({ ok: false, blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE" })
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "UNAVAILABLE",
      blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE",
    })
    expect(uploadMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("bounds a producer exception as unavailable without opening storage", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generateMock.mockRejectedValue(new Error("private producer detail"))
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "UNAVAILABLE",
      blocker: "T2_ARTIFACT_PRODUCER_UNAVAILABLE",
    })
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it.each([
    ["empty", Buffer.alloc(0), "EMPTY_ARTIFACT"],
    ["oversized", Buffer.alloc(MAX_ARTIFACT_BYTES + 1), "ARTIFACT_TOO_LARGE"],
  ] as const)("refuses %s producer output before hashing/storage", async (_label, unsafeBytes, blocker) => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generateMock.mockResolvedValue({ ok: true, bytes: unsafeBytes, provenance })
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "REFUSED",
      blocker,
    })
    expect(uploadMock).not.toHaveBeenCalled()
    expect(readBackMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("stops before upload when activation is withdrawn during generation", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generateMock.mockImplementation(async () => {
      delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      return { ok: true, bytes, provenance }
    })

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "DISABLED",
      blocker: "FLAG_DISABLED",
    })
    expect(uploadMock).not.toHaveBeenCalled()
    expect(readBackMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("reconciles a newly uploaded orphan when activation is withdrawn during upload", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockImplementation(async () => {
      delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      return { locator, created: true }
    })

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "DISABLED",
      blocker: "FLAG_DISABLED",
    })
    expect(readBackMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).toHaveBeenCalledWith({ locator, sha256: sha })
  })

  it("reconciles a newly uploaded orphan when activation is withdrawn during read-back", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    readBackMock.mockImplementation(async () => {
      delete process.env.OT_T2_ARTIFACT_BINDING_ENABLED
      return bytes
    })

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "DISABLED",
      blocker: "FLAG_DISABLED",
    })
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).toHaveBeenCalledWith({ locator, sha256: sha })
  })

  it("orders generate -> content-addressed upload -> read-back -> bind and performs no delivery/email", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    const order: string[] = []
    generateMock.mockImplementation(async () => { order.push("generate"); return { ok: true, bytes, provenance } })
    uploadMock.mockImplementation(async () => { order.push("upload"); return { locator, created: true } })
    readBackMock.mockImplementation(async () => { order.push("read-back"); return bytes })
    bindMock.mockImplementation(async () => { order.push("bind"); return { outcome: "BOUND", created: true, artifactId: "art_1", artifactSha256: sha } })

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toMatchObject({ outcome: "BOUND" })
    expect(order).toEqual(["generate", "upload", "read-back", "bind"])
    expect(uploadMock).toHaveBeenCalledWith({ locator, bytes })
    expect(readBackMock).toHaveBeenCalledWith({ locator })
    expect(bindMock).toHaveBeenCalledWith({ orderId: "ord_1", fulfillmentId: "ful_1", bytes, provenance })

    const source = require("node:fs").readFileSync(require.resolve("@/lib/fulfillment-runtime/t2-artifact-workflow"), "utf8")
    expect(source).not.toMatch(/sendPacketReadyEmail|sendOrderConfirmation|lib\/email/)
  })

  it("rejects a storage locator that is not the exact content address and reconciles only a newly created upload", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockResolvedValue({ locator: "t2-artifacts/caller/value.pdf", created: true })
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "STORAGE_LOCATOR_MISMATCH",
    })
    expect(readBackMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).toHaveBeenCalledWith({ locator: "t2-artifacts/caller/value.pdf", sha256: sha })
  })

  it("bounds an ambiguous upload failure without deleting an unknown object", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockRejectedValue(new Error("private upload provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "RECONCILIATION_REQUIRED",
      blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED",
    })
    expect(readBackMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("reconciles a newly created orphan when read-back rejects and returns a bounded refusal", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    readBackMock.mockRejectedValue(new Error("private storage provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "STORAGE_READ_FAILED",
    })
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock).toHaveBeenCalledWith({ locator, sha256: sha })
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("returns reconciliation-required when read-back and cleanup both reject", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    readBackMock.mockRejectedValue(new Error("private storage provider detail"))
    reconcileMock.mockRejectedValue(new Error("private cleanup provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "RECONCILIATION_REQUIRED",
      blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED",
    })
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("does not reconcile a pre-existing object when read-back rejects", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockResolvedValue({ locator, created: false })
    readBackMock.mockRejectedValue(new Error("private storage provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "STORAGE_READ_FAILED",
    })
    expect(reconcileMock).not.toHaveBeenCalled()
    expect(bindMock).not.toHaveBeenCalled()
  })

  it("preserves storage on an ambiguous bind/commit exception and returns bounded reconciliation-required", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    bindMock.mockRejectedValue(new Error("private database/provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "RECONCILIATION_REQUIRED",
      blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED",
    })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("rejects persisted-byte SHA/size mismatch and reconciles the new orphan before bind", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    readBackMock.mockResolvedValue(Buffer.from("different stored bytes"))
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "REFUSED",
      blocker: "STORED_BYTES_MISMATCH",
    })
    expect(bindMock).not.toHaveBeenCalled()
    expect(reconcileMock).toHaveBeenCalledWith({ locator, sha256: sha })
  })

  it("surfaces cleanup failure as bounded reconciliation-required state", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    readBackMock.mockResolvedValue(Buffer.from("different stored bytes"))
    reconcileMock.mockRejectedValue(new Error("private provider detail"))

    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({
      outcome: "RECONCILIATION_REQUIRED",
      blocker: "UNBOUND_ARTIFACT_RECONCILIATION_REQUIRED",
    })
    expect(bindMock).not.toHaveBeenCalled()
  })

  it.each(["INELIGIBLE_SETTLEMENT", "INELIGIBLE_FULFILLMENT_STATUS"])(
    "reconciles only the newly uploaded unbound orphan when bind refuses %s mid-flight",
    async (blocker) => {
      process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
      generated()
      bindMock.mockResolvedValue({ outcome: "REFUSED", blocker })
      await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toEqual({ outcome: "REFUSED", blocker })
      expect(reconcileMock).toHaveBeenCalledWith({ locator, sha256: sha })
    },
  )

  it("never deletes or reconciles a pre-existing content object", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockResolvedValue({ locator, created: false })
    bindMock.mockResolvedValue({ outcome: "REFUSED", blocker: "INELIGIBLE_SETTLEMENT" })
    await runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("does not reconcile legitimate bound evidence on replay", async () => {
    process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
    generated()
    uploadMock.mockResolvedValue({ locator, created: false })
    bindMock.mockResolvedValue({ outcome: "BOUND", created: false, artifactId: "art_existing", artifactSha256: sha })
    await expect(runT2ArtifactBindingWorkflow({ orderId: "ord_1", fulfillmentId: "ful_1" })).resolves.toMatchObject({ outcome: "BOUND", created: false })
    expect(reconcileMock).not.toHaveBeenCalled()
  })
})
