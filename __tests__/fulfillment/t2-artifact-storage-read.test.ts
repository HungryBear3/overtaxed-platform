/** @jest-environment node */
import { readFileSync } from "node:fs"
import { get, put } from "@vercel/blob"
import * as storage from "@/lib/fulfillment-runtime/t2-artifact-storage"
import { readT2ArtifactBytes } from "@/lib/fulfillment-runtime/t2-artifact-storage"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"
jest.mock("server-only", () => ({}))
jest.mock("@vercel/blob", () => ({ get: jest.fn(), put: jest.fn() }))
const getMock = jest.mocked(get)
const bytes = Buffer.from("%PDF-1.7 synthetic private artifact")
const locator = contentAddressedT2ArtifactLocator(computeArtifactSha256(bytes))
const failure = { name: "T2ArtifactStorageUnavailableError", message: "T2_ARTIFACT_STORAGE_UNAVAILABLE" }
function response(chunks: Uint8Array[] = [bytes], metadata: Record<string, unknown> = {}) {
  return {
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({ start(c) { for (const part of chunks) c.enqueue(part); c.close() } }),
    blob: { pathname: locator, size: bytes.length, contentType: "application/pdf", ...metadata },
  } as Awaited<ReturnType<typeof get>>
}
beforeEach(() => {
  jest.resetAllMocks()
  process.env.OT_T2_PRIVATE_STORAGE_ENABLED = "true"
  getMock.mockResolvedValue(response())
})
afterEach(() => { delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED })
test.each([undefined, "", "false", "TRUE", "True", "1", "yes", "true ", " true"])("flag %s refuses before provider access", async flag => {
  if (flag === undefined) delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED
  else process.env.OT_T2_PRIVATE_STORAGE_ENABLED = flag
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled()
})
test.each(["", "https://example.com/file.pdf", "../file.pdf", locator.toUpperCase(), locator + "?x=1", locator + "\n", locator.replace(".pdf", ".PDF")])("noncanonical locator refuses: %s", async bad => {
  await expect(readT2ArtifactBytes({ locator: bad })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled()
})
test("authenticated private uncached read verifies exact bytes and returns no URL", async () => {
  getMock.mockResolvedValue(response([bytes.subarray(0, 5), bytes.subarray(5)]))
  await expect(readT2ArtifactBytes({ locator })).resolves.toEqual(bytes)
  expect(get).toHaveBeenCalledWith(locator, { access: "private", useCache: false })
  expect(put).not.toHaveBeenCalled()
})
test.each([
  { pathname: locator + "x" }, { contentType: "text/plain" }, { size: 0 }, { size: -1 },
  { size: NaN }, { size: 1.5 }, { size: MAX_ARTIFACT_BYTES + 1 }, { size: bytes.length + 1 },
])("invalid metadata refuses %j", async metadata => {
  getMock.mockResolvedValue(response([bytes], metadata))
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
})
test.each([null, { statusCode: 304, stream: null, blob: {} }, { statusCode: 200, stream: null, blob: {} }])("missing content refuses %j", async result => {
  getMock.mockResolvedValue(result as never)
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
})
test("digest mismatch refuses", async () => {
  getMock.mockResolvedValue(response([Buffer.alloc(bytes.length)]))
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
})
test("oversized stream cancels before buffering beyond advertised size", async () => {
  const cancel = jest.fn()
  getMock.mockResolvedValue({ ...response(), stream: new ReadableStream({
    start(c) { c.enqueue(bytes); c.enqueue(Buffer.from("extra")) }, cancel,
  }) } as never)
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
  expect(cancel).toHaveBeenCalledTimes(1)
})
test("malformed stream chunks refuse", async () => {
  getMock.mockResolvedValue(response(["not bytes" as never]))
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
})
test.each(["private access on a public store", "synthetic provider secret detail"])("provider errors are fixed and never fall back: %s", async detail => {
  getMock.mockRejectedValue(new Error(detail))
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
  expect(get).toHaveBeenCalledTimes(1)
  expect(put).not.toHaveBeenCalled()
})
test("stream errors are sanitized", async () => {
  getMock.mockResolvedValue({ ...response(), stream: new ReadableStream({ start(c) { c.error(new Error("private detail")) } }) } as never)
  await expect(readT2ArtifactBytes({ locator })).rejects.toMatchObject(failure)
})
test("the storage module exposes no delete or orphan-cleanup capability", () => {
  // Orphan handling moved to durable quarantine recording, which has no provider
  // reach. This module must stay unable to remove a content object: the same
  // content address may already be bound by another fulfillment.
  expect(Object.keys(storage).sort()).toEqual(["readT2ArtifactBytes", "uploadT2Artifact"])
  const source = readFileSync(require.resolve("@/lib/fulfillment-runtime/t2-artifact-storage"), "utf8")
  expect(source).not.toMatch(/\bdel\b|\bdelete\(|copy\(/)
  expect(computeArtifactSha256(bytes)).toMatch(/^[0-9a-f]{64}$/)
})

test("matching plain-text digest and PDF metadata do not substitute for a PDF header", async () => {
  const text = Buffer.from("plain text report")
  const textLocator = contentAddressedT2ArtifactLocator(computeArtifactSha256(text))
  getMock.mockResolvedValue(response([text], { pathname: textLocator, size: text.length }))
  await expect(readT2ArtifactBytes({ locator: textLocator })).rejects.toMatchObject(failure)
})
