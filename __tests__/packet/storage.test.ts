/**
 * @jest-environment node
 *
 * Packet storage abstraction — private vs public-fallback access modes.
 */

const putMock = jest.fn(async (_pathname: string, _bytes: Buffer, opts: { access: string }) => ({
  url: `https://store.${opts.access}.blob.vercel-storage.com/${_pathname}`,
  pathname: _pathname,
}))
const getMock = jest.fn()
jest.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => putMock(...(args as Parameters<typeof putMock>)),
  get: (...args: unknown[]) => getMock(...args),
}))

import {
  getPacketBlobAccessMode,
  readPacketBytes,
  storePacket,
  PacketStorageMisconfiguredError,
} from "@/lib/packet/storage"

beforeEach(() => {
  putMock.mockClear()
  getMock.mockClear()
  process.env.BLOB_READ_WRITE_TOKEN = "test_token"
  delete process.env.OT_PACKET_BLOB_ACCESS
})

describe("getPacketBlobAccessMode", () => {
  it("defaults to 'private' when env unset", () => {
    expect(getPacketBlobAccessMode()).toBe("private")
  })
  it("respects OT_PACKET_BLOB_ACCESS=public", () => {
    process.env.OT_PACKET_BLOB_ACCESS = "public"
    expect(getPacketBlobAccessMode()).toBe("public")
  })
  it("respects OT_PACKET_BLOB_ACCESS=private explicitly", () => {
    process.env.OT_PACKET_BLOB_ACCESS = "private"
    expect(getPacketBlobAccessMode()).toBe("private")
  })
  it("ignores unknown values, defaults to private", () => {
    process.env.OT_PACKET_BLOB_ACCESS = "yolo"
    expect(getPacketBlobAccessMode()).toBe("private")
  })
})

describe("storePacket", () => {
  it("private mode: writes with access='private', returns url=null", async () => {
    const r = await storePacket({ pathname: "packets/inv1/x.pdf", bytes: Buffer.from("a") })
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(putMock.mock.calls[0]?.[2]?.access).toBe("private")
    expect(r.access).toBe("private")
    expect(r.url).toBeNull()
    expect(r.pathname).toBe("packets/inv1/x.pdf")
  })

  it("public-fallback mode: writes with access='public', returns the URL", async () => {
    process.env.OT_PACKET_BLOB_ACCESS = "public"
    const r = await storePacket({ pathname: "packets/inv1/x.pdf", bytes: Buffer.from("a") })
    expect(putMock.mock.calls[0]?.[2]?.access).toBe("public")
    expect(putMock.mock.calls[0]?.[2]?.addRandomSuffix).toBe(true)
    expect(r.access).toBe("public")
    expect(r.url).toMatch(/public\.blob\.vercel-storage\.com/)
  })

  it("throws PacketStorageMisconfiguredError when blob token missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    await expect(
      storePacket({ pathname: "packets/inv1/x.pdf", bytes: Buffer.from("a") }),
    ).rejects.toBeInstanceOf(PacketStorageMisconfiguredError)
  })

  it("translates store-mode mismatch error into PacketStorageMisconfiguredError", async () => {
    putMock.mockImplementationOnce(async () => {
      throw new Error("BlobError: Cannot use private access on a public store")
    })
    await expect(
      storePacket({ pathname: "packets/inv1/x.pdf", bytes: Buffer.from("a") }),
    ).rejects.toBeInstanceOf(PacketStorageMisconfiguredError)
  })
})

describe("readPacketBytes", () => {
  it("private mode: uses authenticated get(), never fetches a URL", async () => {
    getMock.mockResolvedValueOnce({
      stream: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3]))
          c.close()
        },
      }),
    })
    const buf = await readPacketBytes({ pathname: "packets/inv1/x.pdf" })
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock.mock.calls[0]?.[1]?.access).toBe("private")
    expect(buf).toEqual(Buffer.from([1, 2, 3]))
  })

  it("public-fallback mode: fetches the supplied URL", async () => {
    process.env.OT_PACKET_BLOB_ACCESS = "public"
    const fetchMock = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    }))
    ;(global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    const buf = await readPacketBytes({
      pathname: "packets/inv1/x.pdf",
      publicUrl: "https://store.public.blob.vercel-storage.com/packets/inv1/x.pdf",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(buf).toEqual(Buffer.from([9, 9, 9]))
  })

  it("public-fallback mode: throws when publicUrl missing", async () => {
    process.env.OT_PACKET_BLOB_ACCESS = "public"
    await expect(readPacketBytes({ pathname: "packets/inv1/x.pdf" })).rejects.toThrow(
      /requires a stored publicUrl/,
    )
  })

  it("throws PacketStorageMisconfiguredError when blob token missing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    await expect(readPacketBytes({ pathname: "packets/inv1/x.pdf" })).rejects.toBeInstanceOf(
      PacketStorageMisconfiguredError,
    )
  })
})
