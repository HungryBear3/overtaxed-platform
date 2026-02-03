// GET /api/appeals/[id]/download-summary - Generate and download appeal summary PDF
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { formatPIN } from "@/lib/cook-county"
import { generateAppealSummaryPdf } from "@/lib/document-generation/appeal-summary"

// #region agent log
const _log = (loc: string, msg: string, data: Record<string, unknown>) => {
  fetch('http://127.0.0.1:7242/ingest/fe1757a5-7593-4a4a-986a-25d9bd588e32',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:loc,message:msg,data,timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
};
// #endregion

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let appealId: string | null = null
  try {
    // #region agent log
    const { id } = await params
    appealId = id
    _log('download-summary:entry','GET download-summary',{appealId:id,hypothesisId:'H-entry'});
    // #endregion
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
      // #region agent log
      _log('download-summary:no-appeal','Appeal not found',{appealId:id,hypothesisId:'H-notfound'});
      // #endregion
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (!appeal.property) {
      // #region agent log
      _log('download-summary:no-property','Appeal has no property',{appealId:id,hypothesisId:'H-property'});
      // #endregion
      return NextResponse.json(
        { error: "Property data missing for this appeal" },
        { status: 500 }
      )
    }

    // #region agent log
    _log('download-summary:appeal-loaded','Appeal loaded',{appealId:id,hasProperty:!!appeal.property,propPinType:typeof appeal.property?.pin,propPinVal:appeal.property?.pin,filingDeadlineType:typeof appeal.filingDeadline,hypothesisId:'H-data'});
    // #endregion

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
        pin: safeFormatPIN(c.pin),
        address: c.address ?? "",
        compType: c.compType,
        salePrice: c.salePrice ? Number(c.salePrice) : null,
        saleDate: c.saleDate?.toISOString() ?? null,
        livingArea: c.livingArea,
        yearBuilt: c.yearBuilt,
      })),
    }

    // #region agent log
    _log('download-summary:before-pdf','About to generate PDF',{appealId:id,compsCount:data.comps.length,hypothesisId:'H-pdf'});
    // #endregion
    const pdfBytes = await generateAppealSummaryPdf(data)
    const pinRaw = String(appeal.property.pin ?? "").replace(/\D/g, "").slice(-6)
    const filename = `overtaxed-appeal-${appeal.taxYear}-${pinRaw || "summary"}.pdf`
    const buf = typeof Buffer !== "undefined" ? Buffer.from(pdfBytes) : new Uint8Array(pdfBytes)

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    })
  } catch (error) {
    const err = error as Error
    // #region agent log
    _log('download-summary:catch','PDF generation error',{appealId:appealId,errorName:err?.name,errorMessage:err?.message,errorStack:(err?.stack||'').slice(0,500),hypothesisId:'H-catch'});
    // #endregion
    console.error("Error generating appeal summary PDF:", error)
    return NextResponse.json(
      { error: "Failed to generate PDF", details: err?.message ?? String(error) },
      { status: 500 }
    )
  }
}
