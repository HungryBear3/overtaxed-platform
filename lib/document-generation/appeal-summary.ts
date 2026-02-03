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
    subdivision: string | null
    block: string | null
    buildingClass: string | null
    cdu: string | null
    livingArea: number | null
    landSize: number | null
    yearBuilt: number | null
    bedrooms: number | null
    bathrooms: number | null
    currentAssessmentValue: number | null
    currentLandValue: number | null
    currentImprovementValue: number | null
    currentMarketValue: number | null
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
    pricePerSqft: number | null
    assessedMarketValue: number | null
    assessedMarketValuePerSqft: number | null
    distanceFromSubject: number | null
  }>
}

function formatCurrency(n: number | null | unknown): string {
  if (n == null) return "—"
  const num = typeof n === "number" ? n : Number(n)
  if (Number.isNaN(num)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num)
}

function formatCurrencySqft(n: number | null | unknown): string {
  if (n == null) return "—"
  const num = typeof n === "number" ? n : Number(n)
  if (Number.isNaN(num)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(num) + "/sq ft"
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatPct(n: number | null | unknown): string {
  if (n == null || Number.isNaN(Number(n))) return "—"
  return `${Number(n).toFixed(1)}%`
}

export async function generateAppealSummaryPdf(data: AppealSummaryData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage() // pdf-lib starts with 0 pages; getPage(0) requires at least one page
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const size = 11
  const lineHeight = 14
  let y = 750
  const margin = 50
  const pageWidth = 612
  const maxWidth = pageWidth - 2 * margin

  const noticedValue = data.appeal.originalAssessmentValue
  const requestedValue = data.appeal.requestedAssessmentValue
  const reductionDollars = requestedValue != null && noticedValue != null ? noticedValue - requestedValue : null
  const reductionPct =
    reductionDollars != null && noticedValue != null && noticedValue > 0
      ? (reductionDollars / noticedValue) * 100
      : null

  const salesComps = data.comps.filter((c) => c.compType === "SALES")
  const equityComps = data.comps.filter((c) => c.compType === "EQUITY")

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

  // —— Title & generated date ——
  drawText("OverTaxed — Property Tax Appeal Summary", { bold: true, fontSize: 16 })
  y -= 4
  drawText(`Generated ${new Date().toLocaleDateString("en-US")}`)
  drawLine()

  // —— Executive summary (makes the case upfront for assessors) ——
  drawText("Summary of Request", { bold: true, fontSize: 13 })
  drawText(
    `Noticed/current assessed value: ${formatCurrency(noticedValue)}  |  ` +
      `Taxpayer's opinion of value (requested): ${formatCurrency(requestedValue)}`
  )
  if (reductionDollars != null && reductionDollars > 0 && reductionPct != null) {
    drawText(
      `Requested reduction: ${formatCurrency(reductionDollars)} (${formatPct(reductionPct)}). ` +
        "This summary presents comparable sales and uniformity evidence in support of the requested assessment."
    )
  } else if (data.comps.length > 0) {
    drawText(
      "The following comparable sales and uniformity analysis support a fair market value consistent with similar properties in the same neighborhood and building class."
    )
  }
  drawLine()

  // —— Subject property (expanded, like sample report) ——
  drawText("Subject Property", { bold: true, fontSize: 13 })
  drawText(`${data.property.address}`)
  drawText(`${data.property.city}, ${data.property.state} ${data.property.zipCode}`)
  drawText(`PIN: ${data.property.pin}  |  ${data.property.county} County`)
  if (data.property.neighborhood) drawText(`Neighborhood: ${data.property.neighborhood}`)
  if (data.property.subdivision) drawText(`Subdivision: ${data.property.subdivision}`)
  if (data.property.block) drawText(`Block: ${data.property.block}`)
  const subjectAttrs: string[] = []
  if (data.property.buildingClass != null) subjectAttrs.push(`Class ${data.property.buildingClass}`)
  if (data.property.cdu) subjectAttrs.push(`CDU ${data.property.cdu}`)
  if (data.property.livingArea != null) subjectAttrs.push(`${data.property.livingArea} sq ft`)
  if (data.property.yearBuilt != null) subjectAttrs.push(`Year built ${data.property.yearBuilt}`)
  if (data.property.bedrooms != null || data.property.bathrooms != null)
    subjectAttrs.push(`Beds/baths: ${data.property.bedrooms ?? "—"} / ${data.property.bathrooms ?? "—"}`)
  if (data.property.landSize != null) subjectAttrs.push(`Land: ${data.property.landSize} sq ft`)
  if (subjectAttrs.length > 0) drawText(subjectAttrs.join("  |  "))
  drawText(
    `Assessed value: ${formatCurrency(data.property.currentAssessmentValue)}  |  ` +
      `Land: ${formatCurrency(data.property.currentLandValue)}  |  ` +
      `Improvements: ${formatCurrency(data.property.currentImprovementValue)}`
  )
  if (data.property.currentMarketValue != null)
    drawText(`Noticed market value: ${formatCurrency(data.property.currentMarketValue)}`)
  drawLine()

  // —— Appeal details ——
  drawText("Appeal Details", { bold: true, fontSize: 13 })
  drawText(`Tax year: ${data.appeal.taxYear}  |  Type: ${data.appeal.appealType}  |  Status: ${data.appeal.status}`)
  drawText(`Original assessment: ${formatCurrency(data.appeal.originalAssessmentValue)}`)
  if (data.appeal.requestedAssessmentValue)
    drawText(`Requested assessment: ${formatCurrency(data.appeal.requestedAssessmentValue)}`)
  drawText(`Filing deadline: ${formatDate(data.appeal.filingDeadline)}`)
  if (data.appeal.noticeDate) drawText(`Notice date: ${formatDate(data.appeal.noticeDate)}`)
  drawLine()

  // —— Sales analysis (3+ sales comps per Cook County / sample) ——
  if (salesComps.length > 0) {
    drawText("Sales Analysis — Comparable Sales", { bold: true, fontSize: 13 })
    drawText(
      "The following recent arm's-length sales of similar properties in the same neighborhood and building class support a lower market value for the subject."
    )
    y -= 4
    for (let i = 0; i < salesComps.length; i++) {
      const c = salesComps[i]
      drawText(`${i + 1}. ${c.address || `PIN ${c.pin}`}`, { bold: true })
      drawText(
        `   PIN: ${c.pin}  |  Sale: ${formatCurrency(c.salePrice)}  |  ${formatDate(c.saleDate)}  |  ` +
          `$/sq ft: ${formatCurrencySqft(c.pricePerSqft)}  |  Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`
      )
      if (c.distanceFromSubject != null)
        drawText(`   Distance from subject: ${Number(c.distanceFromSubject).toFixed(2)} mi`)
    }
    drawLine()
  }

  // —— Lack of uniformity (equity comps) ——
  if (equityComps.length > 0) {
    drawText("Lack of Uniformity — Comparable Assessments", { bold: true, fontSize: 13 })
    drawText(
      "These comparable properties in the same neighborhood and class show similar assessed values per square foot. The subject is over-assessed relative to these peers."
    )
    y -= 4
    for (let i = 0; i < equityComps.length; i++) {
      const c = equityComps[i]
      drawText(`${i + 1}. ${c.address || `PIN ${c.pin}`}`, { bold: true })
      drawText(
        `   PIN: ${c.pin}  |  Assessed market value: ${formatCurrency(c.assessedMarketValue)}  |  ` +
          `$/sq ft: ${formatCurrencySqft(c.assessedMarketValuePerSqft)}  |  Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`
      )
      if (c.distanceFromSubject != null)
        drawText(`   Distance from subject: ${Number(c.distanceFromSubject).toFixed(2)} mi`)
    }
    drawLine()
  }

  // —— If no comps or mixed list without section headers ——
  if (data.comps.length > 0 && salesComps.length === 0 && equityComps.length === 0) {
    drawText("Comparable Properties", { bold: true, fontSize: 13 })
    for (let i = 0; i < data.comps.length; i++) {
      const c = data.comps[i]
      drawText(`${i + 1}. ${c.address || `PIN ${c.pin}`}`, { bold: true })
      drawText(
        `   PIN: ${c.pin}  |  ${c.compType}  |  Sale: ${formatCurrency(c.salePrice)}  |  ${formatDate(c.saleDate)}  |  ` +
          `Value: ${formatCurrency(c.assessedMarketValue)}  |  $/sq ft: ${formatCurrencySqft(c.pricePerSqft ?? c.assessedMarketValuePerSqft)}`
      )
      if (c.livingArea != null || c.yearBuilt != null)
        drawText(`   Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`)
    }
    drawLine()
  } else if (data.comps.length === 0) {
    drawText("Comparable Properties", { bold: true, fontSize: 13 })
    drawText("No comparable properties added yet. Add sales and equity comps to strengthen your appeal.")
    drawLine()
  }

  // —— Conclusion (compelling closing for assessors) ——
  drawText("Conclusion", { bold: true, fontSize: 13 })
  if (requestedValue != null && data.comps.length > 0) {
    const salesN = salesComps.length
    const equityN = equityComps.length
    const parts: string[] = []
    parts.push(
      `Based on the comparable sales and uniformity analysis above, the requested assessment of ${formatCurrency(requestedValue)} is supported by`
    )
    if (salesN > 0 && equityN > 0) parts.push(`${salesN} recent sales comp(s) and ${equityN} equity comp(s)`)
    else if (salesN > 0) parts.push(`${salesN} recent sales comp(s)`)
    else if (equityN > 0) parts.push(`${equityN} equity comp(s)`)
    parts.push("in the same neighborhood and building class. We respectfully request a reduction to the requested value.")
    drawText(parts.join(" "))
  } else if (requestedValue != null) {
    drawText(
      `The taxpayer respectfully requests a reduction in the assessed value to ${formatCurrency(requestedValue)}. ` +
        "Comparable evidence may be added and submitted separately before the filing deadline."
    )
  } else {
    drawText(
      "This appeal is in preparation. Once a requested value and comparable evidence are finalized, a complete summary will support the reduction request."
    )
  }

  return doc.save()
}
