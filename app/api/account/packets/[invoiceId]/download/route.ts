// GET /api/account/packets/[invoiceId]/download
//
// This route is the real access-control boundary for packet PDFs. Owner or
// admin auth is required. Bytes are read server-side — in private mode via
// authenticated `get()` (the underlying URL is never surfaced or fetched);
// in public-fallback mode via the path-allowlisted public URL.
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { validatePacketDownload } from "@/lib/packet/download-allowlist"
import { getPacketBlobAccessMode, readPacketBytes } from "@/lib/packet/storage"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const session = await getSession(request)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { invoiceId } = await context.params
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      userId: true,
      invoiceType: true,
      packetStatus: true,
      packetPdfUrl: true,
      packetPdfPath: true,
      invoiceNumber: true,
    },
  })
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const role = (session.user as { role?: string }).role
  const isAdmin = role === "ADMIN"
  const isOwner = invoice.userId === session.user.id
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (invoice.invoiceType !== "COMPS_ONLY") {
    return NextResponse.json({ error: "Invoice has no packet" }, { status: 400 })
  }
  if (invoice.packetStatus !== "READY" && invoice.packetStatus !== "DELIVERED") {
    return NextResponse.json({ error: "Packet not ready" }, { status: 409 })
  }

  // Path allowlist still applies — defense in depth so even an admin DB edit
  // cannot point this route at an arbitrary blob path. In private mode the
  // URL field is empty by design, so we relax the URL portion of the check
  // and require only a clean path.
  const accessMode = getPacketBlobAccessMode()
  if (!invoice.packetPdfPath) {
    console.error(`[packet-download] rejected invoice=${invoiceId} reason=missing_path`)
    return NextResponse.json({ error: "Packet temporarily unavailable" }, { status: 502 })
  }
  if (!invoice.packetPdfPath.startsWith(`packets/${invoiceId}/`) ||
      invoice.packetPdfPath.includes("..") ||
      invoice.packetPdfPath.includes("//")) {
    console.error(`[packet-download] rejected invoice=${invoiceId} reason=path_mismatch`)
    return NextResponse.json({ error: "Packet temporarily unavailable" }, { status: 502 })
  }

  if (accessMode === "public") {
    // In public-fallback mode we still validate the stored URL via the
    // existing allowlist before fetching. Closes the poisoned-URL branch.
    const allow = validatePacketDownload({
      invoiceId,
      packetPdfPath: invoice.packetPdfPath,
      packetPdfUrl: invoice.packetPdfUrl,
    })
    if (!allow.ok) {
      console.error(`[packet-download] rejected invoice=${invoiceId} reason=${allow.reason}`)
      return NextResponse.json({ error: "Packet temporarily unavailable" }, { status: 502 })
    }
  }

  let buf: Buffer
  try {
    buf = await readPacketBytes({
      pathname: invoice.packetPdfPath,
      publicUrl: accessMode === "public" ? invoice.packetPdfUrl : null,
    })
  } catch (err) {
    console.error(`[packet-download] read failed for invoice=${invoiceId}:`, err)
    return NextResponse.json({ error: "Packet temporarily unavailable" }, { status: 502 })
  }

  const filename = `overtaxed-appeal-packet-${invoice.invoiceNumber}.pdf`
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.byteLength),
    },
  })
}
