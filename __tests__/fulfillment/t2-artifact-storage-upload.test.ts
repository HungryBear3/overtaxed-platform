/** @jest-environment node */
import { get, put } from "@vercel/blob"
import { uploadT2Artifact } from "@/lib/fulfillment-runtime/t2-artifact-storage"
import { computeArtifactSha256, contentAddressedT2ArtifactLocator } from "@/lib/fulfillment/artifact-digest"
import { MAX_ARTIFACT_BYTES } from "@/lib/fulfillment/types"
jest.mock("server-only", () => ({}))
jest.mock("@vercel/blob", () => ({ get: jest.fn(), put: jest.fn() }))
const getMock = jest.mocked(get), putMock = jest.mocked(put)
const bytes = Buffer.from("%PDF-1.7 immutable synthetic artifact")
const locator = contentAddressedT2ArtifactLocator(computeArtifactSha256(bytes))
const failure = { name: "T2ArtifactStorageUnavailableError", message: "T2_ARTIFACT_STORAGE_UNAVAILABLE" }
function existing(value = bytes) {
  return { statusCode: 200, blob: { pathname: locator, size: value.length, contentType: "application/pdf" },
    stream: new ReadableStream({ start(c) { c.enqueue(value); c.close() } }),
  } as Awaited<ReturnType<typeof get>>
}
beforeEach(() => {
  jest.resetAllMocks()
  process.env.OT_T2_PRIVATE_STORAGE_ENABLED = "true"
  getMock.mockResolvedValue(null)
  putMock.mockResolvedValue({ pathname: locator, contentType: "application/pdf", url: "https://private.invalid/never-return" } as never)
})
afterEach(() => { delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED })
test.each([undefined, "", "false", "TRUE", "True", "1", "yes", "true "])("flag %s prevents all provider access", async flag => {
  if (flag === undefined) delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED
  else process.env.OT_T2_PRIVATE_STORAGE_ENABLED = flag
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled()
})
test.each([Buffer.alloc(0), Buffer.alloc(MAX_ARTIFACT_BYTES + 1), Buffer.from("wrong bytes"), "not a buffer"])("invalid input never reaches provider: %#", async value => {
  await expect(uploadT2Artifact({ locator, bytes: value as Buffer })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled()
})
test.each([locator + "\n", locator + "?query", "https://private.invalid/file.pdf"])("bad locator refuses before access: %s", async bad => {
  await expect(uploadT2Artifact({ locator: bad, bytes })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled()
})
test("absent object permits only immutable private PDF put and no URL return", async () => {
  await expect(uploadT2Artifact({ locator, bytes })).resolves.toEqual({ locator, created: true })
  expect(get).toHaveBeenCalledWith(locator, { access: "private", useCache: false })
  expect(put).toHaveBeenCalledWith(locator, bytes, {
    access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/pdf",
  })
})
test("matching existing private bytes are reused without writing", async () => {
  getMock.mockResolvedValue(existing())
  await expect(uploadT2Artifact({ locator, bytes })).resolves.toEqual({ locator, created: false })
  expect(put).not.toHaveBeenCalled()
})
test("mismatching existing object cannot be overwritten", async () => {
  getMock.mockResolvedValue(existing(Buffer.from("different bytes")))
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(put).not.toHaveBeenCalled()
})
test.each([undefined, { statusCode: 304 }, "error"])("ambiguous existence %j cannot authorize put", async result => {
  if (result === "error") getMock.mockRejectedValue(new Error("synthetic private detail"))
  else getMock.mockResolvedValue(result as never)
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(put).not.toHaveBeenCalled()
})
test.each([null, undefined, { pathname: "wrong-path" }, { pathname: locator, contentType: "text/plain" }])("ambiguous put result %j throws", async result => {
  putMock.mockResolvedValue(result as never)
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(put).toHaveBeenCalledTimes(1)
})
test.each(["timeout after commit", "private access on a public store", "object already exists"])("unknown put outcome refuses without fallback: %s", async detail => {
  putMock.mockRejectedValue(new Error(detail))
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(put).toHaveBeenCalledTimes(1)
})
test("late disable during existence read prevents put", async () => {
  getMock.mockImplementationOnce(async () => { delete process.env.OT_T2_PRIVATE_STORAGE_ENABLED; return null })
  await expect(uploadT2Artifact({ locator, bytes })).rejects.toMatchObject(failure)
  expect(put).not.toHaveBeenCalled()
})
test("input bytes cannot drift while the existence read awaits", async () => {
  const mutable = Buffer.from(bytes)
  getMock.mockImplementationOnce(async () => { mutable.fill(0); return null })
  await expect(uploadT2Artifact({ locator, bytes: mutable })).resolves.toEqual({ locator, created: true })
  expect(putMock.mock.calls[0][1]).toEqual(bytes)
})
test("concurrent absent reads never overwrite, loser throws, later retry verifies existing bytes", async () => {
  let created = false
  putMock.mockImplementation(async (_path, _body, options) => {
    expect(options.allowOverwrite).toBe(false)
    if (created) throw new Error("already exists")
    created = true
    return { pathname: locator, contentType: "application/pdf" } as never
  })
  const results = await Promise.allSettled([uploadT2Artifact({ locator, bytes }), uploadT2Artifact({ locator, bytes })])
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: failure })
  getMock.mockResolvedValue(existing())
  await expect(uploadT2Artifact({ locator, bytes })).resolves.toEqual({ locator, created: false })
  expect(put).toHaveBeenCalledTimes(2)
})

test("plain text with its own valid digest cannot masquerade as PDF", async () => {
  const text = Buffer.from("plain text report")
  const textLocator = contentAddressedT2ArtifactLocator(computeArtifactSha256(text))
  await expect(uploadT2Artifact({ locator: textLocator, bytes: text })).rejects.toMatchObject(failure)
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled()
})

test("caller locator cannot drift while the existence read awaits", async () => {
  const input = { locator, bytes }
  getMock.mockImplementationOnce(async () => { input.locator = contentAddressedT2ArtifactLocator("0".repeat(64)); return null })
  await expect(uploadT2Artifact(input)).resolves.toEqual({ locator, created: true })
  expect(putMock.mock.calls[0][0]).toBe(locator)
})
