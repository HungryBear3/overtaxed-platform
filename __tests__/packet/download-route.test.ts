/**
 * @jest-environment node
 *
 * Byte-level regression guard for GET /api/account/packets/[invoiceId]/download.
 *
 * The route hands packet bytes straight to `NextResponse`, so the body has to be
 * a standards-compatible `BodyInit` that carries *exactly* the bytes
 * `readPacketBytes` returned — no more, no fewer. Node routinely returns pooled
 * Buffers: a view at a non-zero `byteOffset` into a backing ArrayBuffer much
 * larger than the view. A body built from `buf.buffer` alone would still answer
 * 200 while serving the wrong bytes at the wrong length, so status assertions
 * cannot catch it. These tests compare the served bytes one by one.
 *
 * The auth cases are here because the same edit touches the only served route
 * in this slice: owner/admin gating and the storage read must stay exactly
 * where they are.
 */

import type { NextRequest } from "next/server"

interface InvoiceRow {
  userId: string
  invoiceType: string
  packetStatus: string
  packetPdfUrl: string | null
  packetPdfPath: string | null
  invoiceNumber: string
}

type Session = { user: { id: string; role?: string } } | null

const getSessionMock = jest.fn<Promise<Session>, [NextRequest | undefined]>()
const findUniqueMock = jest.fn<Promise<InvoiceRow | null>, [unknown]>()
const readPacketBytesMock = jest.fn<
  Promise<Buffer>,
  [{ pathname: string; publicUrl?: string | null }]
>()
const getPacketBlobAccessModeMock = jest.fn<"private" | "public", []>(() => "private")

jest.mock("@/lib/auth", () => ({
  getSession: (...args: [NextRequest | undefined]) => getSessionMock(...args),
}))
jest.mock("@/lib/db", () => ({
  prisma: { invoice: { findUnique: (...args: [unknown]) => findUniqueMock(...args) } },
}))
jest.mock("@/lib/packet/storage", () => ({
  getPacketBlobAccessMode: () => getPacketBlobAccessModeMock(),
  readPacketBytes: (...args: [{ pathname: string; publicUrl?: string | null }]) =>
    readPacketBytesMock(...args),
}))

import { NextRequest as NextRequestCtor } from "next/server"

import { GET } from "@/app/api/account/packets/[invoiceId]/download/route"

const INVOICE_ID = "inv_1"

// A payload with high bytes and a NUL, so any encoding round-trip shows up.
const PDF_BYTES = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0x25, 0x25,
  0x45, 0x4f, 0x46,
])

/**
 * Reproduce Node's pooled-Buffer shape: the returned Buffer is a window into a
 * larger ArrayBuffer whose surrounding bytes are NOT part of the packet.
 */
function pooledBuffer(bytes: Uint8Array): Buffer {
  const pool = new ArrayBuffer(bytes.byteLength + 128)
  new Uint8Array(pool).fill(0xab)
  const view = Buffer.from(pool, 64, bytes.byteLength)
  view.set(bytes)
  return view
}

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    userId: "user_owner",
    invoiceType: "COMPS_ONLY",
    packetStatus: "READY",
    packetPdfUrl: null,
    packetPdfPath: `packets/${INVOICE_ID}/appeal-packet.pdf`,
    invoiceNumber: "INV-1001",
    ...overrides,
  }
}

function request(): NextRequest {
  return new NextRequestCtor(
    `https://example.com/api/account/packets/${INVOICE_ID}/download`,
  )
}

function context() {
  return { params: Promise.resolve({ invoiceId: INVOICE_ID }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  getPacketBlobAccessModeMock.mockReturnValue("private")
  getSessionMock.mockResolvedValue({ user: { id: "user_owner" } })
  findUniqueMock.mockResolvedValue(invoice())
  readPacketBytesMock.mockResolvedValue(pooledBuffer(PDF_BYTES))
})

describe("GET /api/account/packets/[invoiceId]/download", () => {
  it("serves the packet bytes verbatim with the PDF download headers", async () => {
    const res = await GET(request(), context())

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="overtaxed-appeal-packet-INV-1001.pdf"',
    )
    expect(res.headers.get("content-length")).toBe(String(PDF_BYTES.byteLength))

    const served = new Uint8Array(await res.arrayBuffer())
    expect(served.byteLength).toBe(PDF_BYTES.byteLength)
    expect(Array.from(served)).toEqual(Array.from(PDF_BYTES))

    // The private path is read by pathname only — no URL is ever fetched.
    expect(readPacketBytesMock).toHaveBeenCalledTimes(1)
    expect(readPacketBytesMock.mock.calls[0]?.[0]).toEqual({
      pathname: `packets/${INVOICE_ID}/appeal-packet.pdf`,
      publicUrl: null,
    })
  })

  it("serves the same bytes to an admin who does not own the invoice", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user_admin", role: "ADMIN" } })

    const res = await GET(request(), context())

    expect(res.status).toBe(200)
    const served = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(served)).toEqual(Array.from(PDF_BYTES))
  })

  it("returns 401 without a session and never touches storage", async () => {
    getSessionMock.mockResolvedValue(null)

    const res = await GET(request(), context())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "Unauthorized" })
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(readPacketBytesMock).not.toHaveBeenCalled()
  })

  it("returns 404 for a signed-in non-owner and never touches storage", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user_stranger" } })

    const res = await GET(request(), context())

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not found" })
    expect(readPacketBytesMock).not.toHaveBeenCalled()
  })
})
