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
    const { id } = await params
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

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

    if (!appeal.property) {
      return NextResponse.json(
        { error: "Property data missing for this appeal" },
        { status: 500 }
      )
    }

    // Validation: requested value required for a complete appeal packet (Task 8.6)
    if (appeal.requestedAssessmentValue == null || appeal.requestedAssessmentValue <= 0) {
      return NextResponse.json(
        { error: "Set a requested assessment value on this appeal before downloading the summary." },
        { status: 400 }
      )
    }

    const salesCount = appeal.compsUsed.filter((c) => c.compType === "SALES").length
    const equityCount = appeal.compsUsed.filter((c) => c.compType === "EQUITY").length
    const warnComps =
      salesCount < 3 || equityCount < 5
        ? `Rule 15 recommends at least 3 sales comps and 5 equity comps (you have ${salesCount} sales, ${equityCount} equity).`
        : null

    const safeFormatPIN = (pin: string | null | undefined) => formatPIN(String(pin ?? ""))

    const data = {
      property: {
        address: appeal.property.address ?? "",
        city: appeal.property.city ?? "",
        state: appeal.property.state ?? "IL",
        zipCode: appeal.property.zipCode ?? "",
        pin: safeFormatPIN(appeal.property.pin),
        county: appeal.property.county,
        neighborhood: appeal.property.neighborhood,
        subdivision: appeal.property.subdivision,
        block: appeal.property.block,
        buildingClass: appeal.property.buildingClass,
        cdu: appeal.property.cdu,
        livingArea: appeal.property.livingArea,
        landSize: appeal.property.landSize,
        yearBuilt: appeal.property.yearBuilt,
        bedrooms: appeal.property.bedrooms,
        bathrooms: appeal.property.bathrooms
          ? Number(appeal.property.bathrooms)
          : null,
        currentAssessmentValue: appeal.property.currentAssessmentValue
          ? Number(appeal.property.currentAssessmentValue)
          : null,
        currentLandValue: appeal.property.currentLandValue
          ? Number(appeal.property.currentLandValue)
          : null,
        currentImprovementValue: appeal.property.currentImprovementValue
          ? Number(appeal.property.currentImprovementValue)
          : null,
        currentMarketValue: appeal.property.currentMarketValue
          ? Number(appeal.property.currentMarketValue)
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
        pin: safeFormatPIN(c.pin),
        address: c.address ?? "",
        compType: c.compType,
        neighborhood: c.neighborhood ?? null,
        buildingClass: c.buildingClass ?? null,
        bedrooms: c.bedrooms ?? null,
        bathrooms: c.bathrooms != null ? Number(c.bathrooms) : null,
        salePrice: c.salePrice ? Number(c.salePrice) : null,
        saleDate: c.saleDate?.toISOString() ?? null,
        livingArea: c.livingArea,
        yearBuilt: c.yearBuilt,
        pricePerSqft: c.pricePerSqft ? Number(c.pricePerSqft) : null,
        assessedMarketValue: c.assessedMarketValue ? Number(c.assessedMarketValue) : null,
        assessedMarketValuePerSqft: c.assessedMarketValuePerSqft
          ? Number(c.assessedMarketValuePerSqft)
          : null,
        distanceFromSubject: c.distanceFromSubject ? Number(c.distanceFromSubject) : null,
      })),
    }

    const pdfBytes = await generateAppealSummaryPdf(data)
    const pinRaw = String(appeal.property.pin ?? "").replace(/\D/g, "").slice(-6)
    const filename = `overtaxed-appeal-${appeal.taxYear}-${pinRaw || "summary"}.pdf`
    const buf = typeof Buffer !== "undefined" ? Buffer.from(pdfBytes) : new Uint8Array(pdfBytes)

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    }
    if (warnComps) headers["X-Appeal-Warning"] = warnComps

    return new NextResponse(buf, {
      status: 200,
      headers,
    })
  } catch (error) {
    const err = error as Error
    console.error("Error generating appeal summary PDF:", error)
    return NextResponse.json(
      { error: "Failed to generate PDF", details: err?.message ?? String(error) },
      { status: 500 }
    )
  }
}
