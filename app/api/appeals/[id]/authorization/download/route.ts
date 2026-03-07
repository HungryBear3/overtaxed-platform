// GET /api/appeals/[id]/authorization/download - Download authorization PDF
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { generateFilingAuthorizationPdf } from "@/lib/document-generation/filing-authorization"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: appealId } = await params

    const appeal = await prisma.appeal.findFirst({
      where: { id: appealId },
      include: {
        filingAuthorization: true,
        property: { select: { pin: true } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    const isAdmin = (session.user as { role?: string }).role === "ADMIN"
    const isOwner = appeal.userId === session.user.id

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (!appeal.filingAuthorization) {
      return NextResponse.json(
        { error: "No authorization on file for this appeal" },
        { status: 404 }
      )
    }

    const auth = appeal.filingAuthorization

    // Prefer uploaded official Cook County form when available
    if (auth.uploadedPdfUrl) {
      const res = await fetch(auth.uploadedPdfUrl)
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        const filename = `filing-authorization-official-${appeal.property.pin.replace(/\D/g, "")}-${appeal.taxYear}.pdf`
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(buffer.length),
          },
        })
      }
    }

    const pdfBytes = await generateFilingAuthorizationPdf({
      propertyAddress: auth.propertyAddress,
      propertyCity: auth.propertyCity,
      propertyState: auth.propertyState,
      propertyZip: auth.propertyZip,
      propertyPin: auth.propertyPin,
      ownerName: auth.ownerName,
      ownerEmail: auth.ownerEmail,
      ownerPhone: auth.ownerPhone,
      ownerAddress: auth.ownerAddress,
      ownerCity: auth.ownerCity,
      ownerState: auth.ownerState,
      ownerZip: auth.ownerZip,
      signedAt: auth.signedAt,
      taxYear: appeal.taxYear,
      appealId: appeal.id,
    })

    const filename = `filing-authorization-${appeal.property.pin.replace(/\D/g, "")}-${appeal.taxYear}.pdf`

    const buffer = Buffer.from(pdfBytes)
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBytes.length),
      },
    })
  } catch (error) {
    console.error("[authorization/download]", error)
    return NextResponse.json(
      { error: "Failed to generate authorization PDF" },
      { status: 500 }
    )
  }
}
