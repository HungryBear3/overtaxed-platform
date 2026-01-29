import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

export interface AppealSummaryData {
  property: {
    address: string
    city: string
    state: string
    zipCode: string
    pin: string
    county: string
    neighborhood: string | null
    buildingClass: string | null
    livingArea: number | null
    yearBuilt: number | null
    currentAssessmentValue: number | null
  }
  appeal: {
    taxYear: number
    appealType: string
    status: string
    originalAssessmentValue: number
    requestedAssessmentValue: number | null
    filingDeadline: string
    noticeDate: string | null
  }
  comps: Array<{
    pin: string
    address: string
    compType: string
    salePrice: number | null
    saleDate: string | null
    livingArea: number | null
    yearBuilt: number | null
  }>
}

function formatCurrency(n: number | null): string {
  if (n == null) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export async function generateAppealSummaryPdf(data: AppealSummaryData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const size = 11
  const lineHeight = 14
  let y = 750
  const margin = 50
  const pageWidth = 612
  const maxWidth = pageWidth - 2 * margin

  const drawText = (
    text: string,
    opts?: { bold?: boolean; fontSize?: number; x?: number }
  ) => {
    const f = opts?.bold ? fontBold : font
    const fs = opts?.fontSize ?? size
    const x = opts?.x ?? margin
    if (y < 50) {
      doc.addPage()
      y = 750
    }
    doc.getPage(doc.getPageCount() - 1).drawText(text, {
      x,
      y,
      size: fs,
      font: f,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth,
    })
    y -= lineHeight
  }

  const drawLine = () => {
    if (y < 50) {
      doc.addPage()
      y = 750
    }
    const page = doc.getPage(doc.getPageCount() - 1)
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    })
    y -= lineHeight
  }

  drawText("Overtaxed — Appeal Summary", { bold: true, fontSize: 16 })
  y -= 4
  drawText(`Generated ${new Date().toLocaleDateString("en-US")}`)
  drawLine()

  drawText("Subject Property", { bold: true, fontSize: 13 })
  drawText(`${data.property.address}`)
  drawText(`${data.property.city}, ${data.property.state} ${data.property.zipCode}`)
  drawText(`PIN: ${data.property.pin}  |  ${data.property.county} County`)
  if (data.property.neighborhood) drawText(`Neighborhood: ${data.property.neighborhood}`)
  drawText(
    `Assessment: ${formatCurrency(data.property.currentAssessmentValue)}  |  ` +
      `Living area: ${data.property.livingArea ?? "—"} sq ft  |  Year built: ${data.property.yearBuilt ?? "—"}`
  )
  drawLine()

  drawText("Appeal Details", { bold: true, fontSize: 13 })
  drawText(`Tax year: ${data.appeal.taxYear}  |  Type: ${data.appeal.appealType}  |  Status: ${data.appeal.status}`)
  drawText(`Original assessment: ${formatCurrency(data.appeal.originalAssessmentValue)}`)
  if (data.appeal.requestedAssessmentValue)
    drawText(`Requested assessment: ${formatCurrency(data.appeal.requestedAssessmentValue)}`)
  drawText(`Filing deadline: ${formatDate(data.appeal.filingDeadline)}`)
  if (data.appeal.noticeDate) drawText(`Notice date: ${formatDate(data.appeal.noticeDate)}`)
  drawLine()

  drawText("Comparable Properties", { bold: true, fontSize: 13 })
  if (data.comps.length === 0) {
    drawText("No comparable properties added yet.")
  } else {
    for (let i = 0; i < data.comps.length; i++) {
      const c = data.comps[i]
      drawText(`${i + 1}. ${c.address || `PIN ${c.pin}`}`, { bold: true })
      drawText(`   PIN: ${c.pin}  |  ${c.compType}  |  Sale: ${formatCurrency(c.salePrice)}  |  ${formatDate(c.saleDate)}`)
      if (c.livingArea != null || c.yearBuilt != null)
        drawText(`   Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`)
    }
  }

  return doc.save()
}
