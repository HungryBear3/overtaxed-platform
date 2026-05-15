/**
 * Allowlist tests for the packet download route.
 *
 * Threat: a poisoned `Invoice.packetPdfUrl` (DB compromise, manual edit,
 * migration bug) must not let the auth-gated route fetch arbitrary URLs.
 */

import { validatePacketDownload } from "@/lib/packet/download-allowlist"

const INVOICE = "inv_abc123"
const GOOD_PATH = `packets/${INVOICE}/overtaxed-appeal-2025-007123.pdf`
const GOOD_URL =
  `https://abc123store.public.blob.vercel-storage.com/${GOOD_PATH}-randSuffix.pdf`

describe("validatePacketDownload", () => {
  it("accepts a well-formed prefix-anchored path on a trusted blob host", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: GOOD_URL,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects a poisoned path that does not start with packets/<invoiceId>/", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: `packets/SOMEONE_ELSE/file.pdf`,
      packetPdfUrl: GOOD_URL,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("path_mismatch")
  })

  it("rejects path traversal attempts", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: `packets/${INVOICE}/../other/file.pdf`,
      packetPdfUrl: GOOD_URL,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("path_mismatch")
  })

  it("rejects a missing path", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: null,
      packetPdfUrl: GOOD_URL,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("missing_path")
  })

  it("rejects a missing URL", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("missing_url")
  })

  it("rejects a URL on an untrusted host", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: `https://evil.example.com/${GOOD_PATH}`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("untrusted_host")
  })

  it("rejects an http URL even on the right blob host", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: `http://abc.public.blob.vercel-storage.com/${GOOD_PATH}`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("untrusted_host")
  })

  it("rejects a URL that points at a different path than the stored path", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: `https://abc.public.blob.vercel-storage.com/packets/SOMEONE_ELSE/file.pdf`,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("path_mismatch")
  })

  it("rejects a malformed URL", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: "not-a-url",
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("untrusted_host")
  })

  it("returns the validated URL for the route to fetch", () => {
    const r = validatePacketDownload({
      invoiceId: INVOICE,
      packetPdfPath: GOOD_PATH,
      packetPdfUrl: GOOD_URL,
    })
    if (r.ok) {
      expect(r.safeUrl).toBe(GOOD_URL)
      expect(r.safePath).toBe(GOOD_PATH)
    }
  })
})
