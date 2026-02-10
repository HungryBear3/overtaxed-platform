import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib"

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
    /** When we have both County and Realie and they differ, PDF can show both. */
    livingAreaCounty?: number | null
    livingAreaRealie?: number | null
    yearBuiltCounty?: number | null
    yearBuiltRealie?: number | null
    bedroomsCounty?: number | null
    bedroomsRealie?: number | null
    bathroomsCounty?: number | null
    bathroomsRealie?: number | null
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
    neighborhood: string | null
    buildingClass: string | null
    bedrooms: number | null
    bathrooms: number | null
    salePrice: number | null
    saleDate: string | null
    livingArea: number | null
    yearBuilt: number | null
    pricePerSqft: number | null
    assessedMarketValue: number | null
    assessedMarketValuePerSqft: number | null
    distanceFromSubject: number | null
    /** When true, comp has both County + Realie (prioritized). */
    inBothSources?: boolean
    livingAreaRealie?: number | null
    yearBuiltRealie?: number | null
    bedroomsRealie?: number | null
    bathroomsRealie?: number | null
  }>
  /** Optional: static map PNG (subject + comp markers) for PDF */
  mapImagePng?: Uint8Array
  /** Optional: subject property Street View JPEG for PDF */
  subjectStreetViewJpeg?: Uint8Array
  /** Optional: comp Street View JPEGs (same order as comps, null if unavailable) */
  compStreetViewJpegs?: (Uint8Array | null)[]
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

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export async function generateAppealSummaryPdf(data: AppealSummaryData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage() // pdf-lib starts with 0 pages; getPage(0) requires at least one page
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const size = 11
  const baseLineHeight = 14
  // Use line height that scales with font size so larger text doesn't overlap (screenshot: 14pt was too small)
  const lineHeightFor = (fontSize: number) => Math.max(baseLineHeight, Math.ceil(fontSize * 1.4))
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
  const subjectSqft =
    data.property.livingArea != null &&
    data.property.livingArea > 0 &&
    data.property.currentAssessmentValue != null
      ? data.property.currentAssessmentValue / data.property.livingArea
      : null

  // Wrap text to maxWidth so we can advance y by lineHeight per line (avoids overlap)
  const wrapLines = (text: string, f: PDFFont, fs: number): string[] => {
    const words = text.split(/\s+/)
    if (words.length === 0) return [""]
    const lines: string[] = []
    let current = ""
    for (const word of words) {
      const candidate = current ? current + " " + word : word
      const w = f.widthOfTextAtSize(candidate, fs)
      if (w > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) {
      lines.push(current)
    }
    return lines
  }

  const drawText = (
    text: string,
    opts?: { bold?: boolean; fontSize?: number; x?: number }
  ) => {
    const f = opts?.bold ? fontBold : font
    const fs = opts?.fontSize ?? size
    const x = opts?.x ?? margin
    const lineHeight = lineHeightFor(fs)
    const lines = wrapLines(text, f, fs)
    for (const line of lines) {
      if (y < 50) {
        doc.addPage()
        y = 750
      }
      const page = doc.getPage(doc.getPageCount() - 1)
      page.drawText(line, {
        x,
        y,
        size: fs,
        font: f,
        color: rgb(0.1, 0.1, 0.1),
      })
      y -= lineHeight
    }
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
    y -= lineHeightFor(size)
  }

  const tableFontSize = 9
  const defaultCellMaxChars = 18
  const firstColumnMaxChars = 22 // formatted PIN e.g. 14-08-211-050-1001
  const drawTableRow = (
    cells: string[],
    columnXs: number[],
    bold = false,
    firstColMax = firstColumnMaxChars
  ) => {
    if (y < 50) {
      doc.addPage()
      y = 750
    }
    const page = doc.getPage(doc.getPageCount() - 1)
    const f = bold ? fontBold : font
    for (let i = 0; i < cells.length; i++) {
      const maxLen = i === 0 ? firstColMax : defaultCellMaxChars
      const cell = (cells[i] ?? "").slice(0, maxLen)
      page.drawText(cell, {
        x: columnXs[i] ?? margin,
        y,
        size: tableFontSize,
        font: f,
        color: rgb(0.1, 0.1, 0.1),
      })
    }
    y -= lineHeightFor(tableFontSize)
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
  // Rule 15 compliance and no cherry-picking
  if (data.comps.length > 0) {
    const salesN = salesComps.length
    const equityN = equityComps.length
    drawText(
      `This submission includes ${salesN > 0 ? salesN + " sales comp(s)" : ""}${salesN > 0 && equityN > 0 ? " and " : ""}${equityN > 0 ? equityN + " equity comp(s)" : ""} from the same neighborhood and building class, consistent with Rule 15. All comparables are identified by Cook County PIN for verification. Comparables were selected by proximity, same neighborhood and class, and similar living area; no cherry-picking.`
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
  if (subjectSqft != null)
    drawText(`Subject assessed $/sq ft: ${formatCurrencySqft(subjectSqft)}`)
  drawLine()

  // —— Subject vs comparables table (one place to compare) ——
  if (data.comps.length > 0) {
    drawText("Subject vs Comparables", { bold: true, fontSize: 13 })
    // Column X positions: Property/PIN needs room for formatted PIN (e.g. 14-08-211-050-1001)
    const colXs = [margin, 158, 193, 228, 303, 383, 458]
    drawTableRow(
      ["Property", "Sq ft", "Yr", "B/B", "Sale/Val", "$/sqft", "Dist"],
      colXs,
      true
    )
    const subjectBath =
      data.property.bathrooms != null ? Number(data.property.bathrooms) : null
    const subjectSqftCell =
      data.property.livingAreaCounty != null && data.property.livingAreaRealie != null && data.property.livingAreaCounty !== data.property.livingAreaRealie
        ? `${data.property.livingAreaCounty} / ${data.property.livingAreaRealie}`
        : (data.property.livingArea != null ? String(data.property.livingArea) : "—")
    const subjectYrCell =
      data.property.yearBuiltCounty != null && data.property.yearBuiltRealie != null && data.property.yearBuiltCounty !== data.property.yearBuiltRealie
        ? `${data.property.yearBuiltCounty} / ${data.property.yearBuiltRealie}`
        : (data.property.yearBuilt != null ? String(data.property.yearBuilt) : "—")
    const subjectBbStr = [data.property.bedrooms ?? "—", subjectBath != null ? subjectBath.toFixed(1) : "—"].join("/")
    drawTableRow(
      [
        "Subject",
        subjectSqftCell,
        subjectYrCell,
        subjectBbStr,
        formatCurrency(data.property.currentAssessmentValue),
        subjectSqft != null ? formatCurrencySqft(subjectSqft).replace("/sq ft", "") : "—",
        "—",
      ],
      colXs
    )
    for (const c of data.comps) {
      const saleOrVal =
        c.compType === "SALES"
          ? formatCurrency(c.salePrice)
          : formatCurrency(c.assessedMarketValue)
      const sqftVal =
        c.compType === "SALES"
          ? (c.pricePerSqft != null ? formatCurrencySqft(c.pricePerSqft).replace("/sq ft", "") : "—")
          : (c.assessedMarketValuePerSqft != null ? formatCurrencySqft(c.assessedMarketValuePerSqft).replace("/sq ft", "") : "—")
      const distStr =
        c.distanceFromSubject != null ? `${Number(c.distanceFromSubject).toFixed(2)} mi` : "—"
      const baths = c.bathrooms != null ? Number(c.bathrooms).toFixed(1) : "—"
      const sqftCell =
        c.livingArea != null && c.livingAreaRealie != null && c.livingArea !== c.livingAreaRealie
          ? `${c.livingArea} / ${c.livingAreaRealie}`
          : (c.livingArea != null ? String(c.livingArea) : (c.livingAreaRealie != null ? String(c.livingAreaRealie) : "—"))
      const yrCell =
        c.yearBuilt != null && c.yearBuiltRealie != null && c.yearBuilt !== c.yearBuiltRealie
          ? `${c.yearBuilt} / ${c.yearBuiltRealie}`
          : (c.yearBuilt != null ? String(c.yearBuilt) : (c.yearBuiltRealie != null ? String(c.yearBuiltRealie) : "—"))
      const bbRe = c.bathroomsRealie != null ? Number(c.bathroomsRealie).toFixed(1) : "—"
      const bbCell =
        c.bedrooms != null && c.bedroomsRealie != null && (c.bedrooms !== c.bedroomsRealie || c.bathrooms !== c.bathroomsRealie)
          ? `${c.bedrooms ?? "—"}/${baths} / ${c.bedroomsRealie ?? "—"}/${bbRe}`
          : `${c.bedrooms ?? "—"}/${baths}`
      drawTableRow(
        [
          (c as { inBothSources?: boolean }).inBothSources ? `${c.pin} *` : c.pin,
          sqftCell,
          yrCell,
          bbCell,
          saleOrVal,
          sqftVal,
          distStr,
        ],
        colXs
      )
    }
    if (data.comps.some((c) => (c as { inBothSources?: boolean }).inBothSources))
      drawText(" * = in both County & Realie (prioritized)", { fontSize: 9 })
    drawLine()
  }

  // —— Map & property photos (when images provided) ——
  const hasMap = data.mapImagePng && data.mapImagePng.length > 0
  const hasSubjectPhoto = data.subjectStreetViewJpeg && data.subjectStreetViewJpeg.length > 0
  const hasCompPhotos =
    data.compStreetViewJpegs && data.compStreetViewJpegs.some((b) => b != null && b.length > 0)
  if (hasMap || hasSubjectPhoto || hasCompPhotos) {
    const minYForImages = 420
    if (y < minYForImages) {
      doc.addPage()
      y = 750
    }
    drawText("Map & Property Photos", { bold: true, fontSize: 13 })
    y -= 6

    const mapDrawWidth = maxWidth
    const mapDrawHeight = 280

    if (hasMap && data.mapImagePng) {
      try {
        const img = await doc.embedPng(data.mapImagePng)
        const scale = Math.min(mapDrawWidth / img.width, mapDrawHeight / img.height)
        const w = img.width * scale
        const h = img.height * scale
        const currentPage = doc.getPage(doc.getPageCount() - 1)
        currentPage.drawImage(img, { x: margin, y: y - h, width: w, height: h })
        y -= h + 10
      } catch {
        // ignore embed failure
      }
    }

    if (hasSubjectPhoto && data.subjectStreetViewJpeg) {
      try {
        drawText("Subject property", { bold: true, fontSize: 11 })
        y -= 4
        const img = await doc.embedJpg(data.subjectStreetViewJpeg)
        const w = 280
        const h = (img.height / img.width) * w
        if (y - h < 50) {
          doc.addPage()
          y = 750
        }
        const currentPage = doc.getPage(doc.getPageCount() - 1)
        currentPage.drawImage(img, { x: margin, y: y - h, width: w, height: h })
        y -= h + 12
      } catch {
        // ignore embed failure
      }
    }

    if (hasCompPhotos && data.compStreetViewJpegs) {
      const compImages = data.compStreetViewJpegs.filter((b) => b != null && b.length > 0) as Uint8Array[]
      if (compImages.length > 0) {
        drawText("Comparable properties", { bold: true, fontSize: 11 })
        y -= 4
        const cols = 3
        const cellW = 120
        const cellH = 90
        let col = 0
        for (let i = 0; i < compImages.length; i++) {
          if (y - cellH < 50) {
            doc.addPage()
            y = 750
          }
          try {
            const img = await doc.embedJpg(compImages[i]!)
            const scale = Math.min(cellW / img.width, cellH / img.height)
            const w = img.width * scale
            const h = img.height * scale
            const x = margin + col * (cellW + 8)
            const currentPage = doc.getPage(doc.getPageCount() - 1)
            currentPage.drawImage(img, { x, y: y - h, width: w, height: h })
            currentPage.drawText(`Comp ${i + 1}`, {
              x,
              y: y - h - 12,
              size: 8,
              font,
              color: rgb(0.3, 0.3, 0.3),
            })
            col += 1
            if (col >= cols) {
              col = 0
              y -= cellH + 20
            }
          } catch {
            // skip failed embed
          }
        }
        if (col > 0) y -= cellH + 20
        y -= 8
      }
    }
    drawLine()
  }

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
    const salesDates = salesComps
      .map((c) => (c.saleDate ? new Date(c.saleDate).getTime() : null))
      .filter((t): t is number => t != null)
    const dateRangeStr =
      salesDates.length > 0
        ? `Sales occurred between ${new Date(Math.min(...salesDates)).toLocaleDateString("en-US", { month: "short", year: "numeric" })} and ${new Date(Math.max(...salesDates)).toLocaleDateString("en-US", { month: "short", year: "numeric" })}. `
        : ""
    drawText(
      dateRangeStr +
        "The following recent arm's-length sales of similar properties in the same neighborhood and building class support a lower market value for the subject."
    )
    const salesPrices = salesComps.map((c) => c.salePrice).filter((v): v is number => v != null && v > 0)
    const salesPricePerSqft = salesComps
      .map((c) => (c.pricePerSqft != null && c.livingArea != null && c.livingArea > 0 ? c.pricePerSqft : null))
      .filter((v): v is number => v != null)
    const medianSale = salesPrices.length > 0 ? median(salesPrices) : null
    const medianSqft = salesPricePerSqft.length > 0 ? median(salesPricePerSqft) : null
    if (medianSale != null || medianSqft != null) {
      const parts: string[] = []
      if (medianSale != null) parts.push(`Median sale price: ${formatCurrency(medianSale)}`)
      if (medianSqft != null) parts.push(`Median $/sq ft: ${formatCurrencySqft(medianSqft)}`)
      drawText(parts.join(". "))
    }
    y -= 4
    for (let i = 0; i < salesComps.length; i++) {
      const c = salesComps[i]
      drawText(`${i + 1}. ${c.address || `PIN ${c.pin}`}`, { bold: true })
      drawText(
        `   PIN: ${c.pin}  |  Sale: ${formatCurrency(c.salePrice)}  |  ${formatDate(c.saleDate)}  |  ` +
          `$/sq ft: ${formatCurrencySqft(c.pricePerSqft)}  |  Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`
      )
      if (c.neighborhood || c.buildingClass != null || c.bedrooms != null || c.bathrooms != null) {
        const parts: string[] = []
        if (c.neighborhood) parts.push(`Neighborhood: ${c.neighborhood}`)
        if (c.buildingClass != null) parts.push(`Class: ${c.buildingClass}`)
        if (c.bedrooms != null || c.bathrooms != null)
          parts.push(`Beds/baths: ${c.bedrooms ?? "—"} / ${c.bathrooms ?? "—"}`)
        if (parts.length > 0) drawText(`   ${parts.join("  |  ")}`)
      }
      if (c.distanceFromSubject != null)
        drawText(`   Distance from subject: ${Number(c.distanceFromSubject).toFixed(2)} mi`)
      const simParts: string[] = []
      if (data.property.neighborhood && c.neighborhood && data.property.neighborhood === c.neighborhood)
        simParts.push("same neighborhood")
      if (data.property.buildingClass != null && c.buildingClass != null && data.property.buildingClass === c.buildingClass)
        simParts.push("same class")
      if (data.property.livingArea != null && c.livingArea != null && data.property.livingArea > 0) {
        const ratio = c.livingArea / data.property.livingArea
        if (ratio >= 0.8 && ratio <= 1.2) simParts.push("within 20% living area")
      }
      if (c.distanceFromSubject != null) simParts.push(`${Number(c.distanceFromSubject).toFixed(2)} mi from subject`)
      if (simParts.length > 0) drawText(`   Similarity: ${simParts.join("; ")}.`)
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
      if (c.neighborhood || c.buildingClass != null || c.bedrooms != null || c.bathrooms != null) {
        const parts: string[] = []
        if (c.neighborhood) parts.push(`Neighborhood: ${c.neighborhood}`)
        if (c.buildingClass != null) parts.push(`Class: ${c.buildingClass}`)
        if (c.bedrooms != null || c.bathrooms != null)
          parts.push(`Beds/baths: ${c.bedrooms ?? "—"} / ${c.bathrooms ?? "—"}`)
        if (parts.length > 0) drawText(`   ${parts.join("  |  ")}`)
      }
      if (c.distanceFromSubject != null)
        drawText(`   Distance from subject: ${Number(c.distanceFromSubject).toFixed(2)} mi`)
      const simPartsEq: string[] = []
      if (data.property.neighborhood && c.neighborhood && data.property.neighborhood === c.neighborhood)
        simPartsEq.push("same neighborhood")
      if (data.property.buildingClass != null && c.buildingClass != null && data.property.buildingClass === c.buildingClass)
        simPartsEq.push("same class")
      if (data.property.livingArea != null && c.livingArea != null && data.property.livingArea > 0) {
        const ratio = c.livingArea / data.property.livingArea
        if (ratio >= 0.8 && ratio <= 1.2) simPartsEq.push("within 20% living area")
      }
      if (c.distanceFromSubject != null) simPartsEq.push(`${Number(c.distanceFromSubject).toFixed(2)} mi from subject`)
      if (simPartsEq.length > 0) drawText(`   Similarity: ${simPartsEq.join("; ")}.`)
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
      if (c.neighborhood || c.buildingClass != null || c.bedrooms != null || c.bathrooms != null) {
        const parts: string[] = []
        if (c.neighborhood) parts.push(`Neighborhood: ${c.neighborhood}`)
        if (c.buildingClass != null) parts.push(`Class: ${c.buildingClass}`)
        if (c.bedrooms != null || c.bathrooms != null)
          parts.push(`Beds/baths: ${c.bedrooms ?? "—"} / ${c.bathrooms ?? "—"}`)
        if (parts.length > 0) drawText(`   ${parts.join("  |  ")}`)
      }
      if (c.livingArea != null || c.yearBuilt != null)
        drawText(`   Living area: ${c.livingArea ?? "—"} sq ft  |  Year built: ${c.yearBuilt ?? "—"}`)
    }
    drawLine()
  } else if (data.comps.length === 0) {
    drawText("Comparable Properties", { bold: true, fontSize: 13 })
    drawText("No comparable properties added yet. Add sales and equity comps to strengthen your appeal.")
    drawLine()
  }

  // —— Subject vs comp $/sq ft (when we have both) ——
  const compSqftValues = [
    ...salesComps.map((c) => c.pricePerSqft).filter((v): v is number => v != null),
    ...equityComps.map((c) => c.assessedMarketValuePerSqft).filter((v): v is number => v != null),
  ]
  const compMedianSqftAll = compSqftValues.length > 0 ? median(compSqftValues) : null
  if (subjectSqft != null && compMedianSqftAll != null && compMedianSqftAll > 0) {
    const pctAbove = ((subjectSqft - compMedianSqftAll) / compMedianSqftAll) * 100
    drawText(
      `Subject assessed $/sq ft (${formatCurrencySqft(subjectSqft)}) is ${pctAbove >= 0 ? formatPct(pctAbove) + " above" : formatPct(-pctAbove) + " below"} the median comparable $/sq ft (${formatCurrencySqft(compMedianSqftAll)}), supporting a reduction.`
    )
    drawLine()
  }

  // —— Photo / Rule 15 note ——
  drawText(
    "Photo attachments for the subject property and comparables may be submitted separately to the Assessor per Rule 15 where applicable."
  )
  drawLine()

  // —— Filing instructions (Task 8.8) ——
  drawText("Filing: File this packet with the Cook County Assessor via SmartFile (online) or attach to your paper appeal form. See cookcountyassessor.com/file-appeal for deadlines and submission.")
  drawLine()

  // —— Conclusion (compelling closing for assessors) ——
  drawText("Conclusion", { bold: true, fontSize: 13 })
  if (requestedValue != null && data.comps.length > 0) {
    const salesN = salesComps.length
    const equityN = equityComps.length
    const marketEst = requestedValue * 10
    drawText(
      `Sales analysis and uniformity comps support a fair market value (and thus assessed value) of ${formatCurrency(requestedValue)}. ` +
        `Requested assessed value reflects an estimated market value of ${formatCurrency(marketEst)} (10% assessment ratio). `
    )
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
