// GET /api/appeals/[id]/download-summary - Generate and download appeal summary PDF
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { formatPIN } from "@/lib/cook-county"
import { generateAppealSummaryPdf } from "@/lib/document-generation/appeal-summary"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    const appeal = await prisma.appeal.findFirst({
      where: { id, userId: session.user.id },
      include: {
        property: true,
        compsUsed: { orderBy: { createdAt: "asc" } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    const data = {
      property: {
        address: appeal.property.address,
        city: appeal.property.city,
        state: appeal.property.state,
        zipCode: appeal.property.zipCode,
        pin: formatPIN(appeal.property.pin),
        county: appeal.property.county,
        neighborhood: appeal.property.neighborhood,
        buildingClass: appeal.property.buildingClass,
        livingArea: appeal.property.livingArea,
        yearBuilt: appeal.property.yearBuilt,
        currentAssessmentValue: appeal.property.currentAssessmentValue
          ? Number(appeal.property.currentAssessmentValue)
          : null,
      },
      appeal: {
        taxYear: appeal.taxYear,
        appealType: appeal.appealType,
        status: appeal.status,
        originalAssessmentValue: Number(appeal.originalAssessmentValue),
        requestedAssessmentValue: appeal.requestedAssessmentValue
          ? Number(appeal.requestedAssessmentValue)
          : null,
        filingDeadline: appeal.filingDeadline.toISOString(),
        noticeDate: appeal.noticeDate?.toISOString() ?? null,
      },
      comps: appeal.compsUsed.map((c) => ({
        pin: formatPIN(c.pin),
        address: c.address,
        compType: c.compType,
        salePrice: c.salePrice ? Number(c.salePrice) : null,
        saleDate: c.saleDate?.toISOString() ?? null,
        livingArea: c.livingArea,
        yearBuilt: c.yearBuilt,
      })),
    }

    const pdfBytes = await generateAppealSummaryPdf(data)
    const buf = Buffer.from(pdfBytes)
    const filename = `overtaxed-appeal-${appeal.taxYear}-${appeal.property.pin.replace(/\D/g, "").slice(-6)}.pdf`

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    })
  } catch (error) {
    console.error("Error generating appeal summary PDF:", error)
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 }
    )
  }
}
