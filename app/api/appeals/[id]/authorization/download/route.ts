// GET /api/appeals/[id]/authorization/download - Download authorization PDF
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { fillOfficialCookCountyAuthForm } from "@/lib/document-generation/fill-official-auth-form"
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
        property: { select: { pin: true, township: true } },
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

    // Prefer uploaded/filled official Cook County form when available (single document for us + county)
    if (auth.uploadedPdfUrl) {
      try {
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
        console.error("[authorization/download] Blob fetch failed", res.status, auth.uploadedPdfUrl)
      } catch (err) {
        console.error("[authorization/download] Blob fetch error", err)
      }
      return NextResponse.json(
        { error: "Authorization form temporarily unavailable. Please try again or re-upload." },
        { status: 503 }
      )
    }

    // When no blob: try filling official Cook County form on-the-fly (e.g. BLOB not configured locally)
    const filledOfficial = await fillOfficialCookCountyAuthForm({
      propertyAddress: auth.propertyAddress,
      propertyCity: auth.propertyCity,
      propertyState: auth.propertyState,
      propertyZip: auth.propertyZip,
      propertyTownship: appeal.property?.township ?? null,
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
      affiantName: auth.ownerName,
      relationshipType: (auth as { relationshipType?: string }).relationshipType as "OWNER" | "LESSEE" | "TAX_BUYER" | "DULY_AUTHORIZED" | undefined,
      purchasedInPast3Years: (auth as { purchasedInPast3Years?: boolean }).purchasedInPast3Years,
      purchasedOrRefinanced: ((auth as { purchasedOrRefinanced?: string | null }).purchasedOrRefinanced ?? undefined) as "PURCHASED" | "REFINANCED" | undefined,
      purchasePrice: (auth as { purchasePrice?: string | null }).purchasePrice,
      dateOfPurchase: (auth as { dateOfPurchase?: Date | null }).dateOfPurchase,
      rateType: (auth as { rateType?: string | null }).rateType,
      interestRate: (auth as { interestRate?: string | null }).interestRate,
      ipAddress: auth.ipAddress ?? undefined,
      signatureImagePngBase64: (auth as { signatureImageData?: string | null }).signatureImageData ?? undefined,
    })
    if (filledOfficial && filledOfficial.length > 0) {
      const filename = `filing-authorization-official-${appeal.property.pin.replace(/\D/g, "")}-${appeal.taxYear}.pdf`
      return new NextResponse(Buffer.from(filledOfficial), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(filledOfficial.length),
        },
      })
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
