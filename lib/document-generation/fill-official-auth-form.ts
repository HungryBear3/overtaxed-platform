/**
 * Fill the official Cook County Attorney/Representative Authorization form
 * with our captured data. Produces a single document for our records and Cook County.
 *
 * Uses bundled copy at public/forms/cook-county-auth-form.pdf (official form from Cook County Assessor).
 * Field names from pdf-lib getForm().getFields()
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { readFileSync, existsSync, appendFileSync } from "fs"
import { join } from "path"

// #region agent log
function _dbg(id: string, msg: string, data: Record<string, unknown>) {
  const payload = { sessionId: "355d64", hypothesisId: id, location: "fill-official-auth-form.ts", message: msg, data, timestamp: Date.now() }
  fetch("http://127.0.0.1:7242/ingest/48622b90-a5ef-4d61-bef0-d727777ab56e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "355d64" },
    body: JSON.stringify(payload),
  }).catch(() => {})
  try {
    const logPath = join(process.cwd(), "..", "debug-355d64.log")
    appendFileSync(logPath, JSON.stringify(payload) + "\n")
  } catch (_) {}
}
// #endregion

/** Owner signature line position on page 2 (PDF coords: origin bottom-left, points). Higher y = higher on page. */
const SIG_LINE_X = 80
const SIG_LINE_Y = 400
const SIG_LINE_W = 180
const SIG_LINE_H = 45

/** OverTaxed IL as appointed representative (Cook County form page 2) */
export const REP_FIRM_NAME = "OverTaxed IL"
export const REP_STREET = "1028 W Leland Ave"
export const REP_CITY = "Chicago"
export const REP_STATE = "IL"
export const REP_ZIP = "60640"
export const REP_PHONE = "support@overtaxed-il.com"
export const REP_SIGNER = "OverTaxed IL"

/** Relationship type for Cook County form — only one checkbox checked */
export type AuthRelationshipType = "OWNER" | "LESSEE" | "TAX_BUYER" | "DULY_AUTHORIZED"

export interface FillOfficialAuthFormData {
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  propertyTownship: string | null
  propertyPin: string
  ownerName: string
  ownerEmail: string
  ownerPhone: string | null
  ownerAddress: string
  ownerCity: string
  ownerState: string
  ownerZip: string
  signedAt: Date
  taxYear: number
  /** Affiant = person signing. Owner name for owner. */
  affiantName?: string
  /** Relationship: only one checkbox (owner, lessee, tax buyer, duly authorized) */
  relationshipType?: AuthRelationshipType
  /** Q3: purchased/refinanced in past 3 years */
  purchasedInPast3Years?: boolean
  /** When purchasedInPast3Years: PURCHASED | REFINANCED — maps to Check Box 12/13 */
  purchasedOrRefinanced?: "PURCHASED" | "REFINANCED" | null
  purchasePrice?: string | null
  dateOfPurchase?: Date | null
  /** FIXED | VARIABLE — maps to Check Box 14/15 */
  rateType?: "FIXED" | "VARIABLE" | string | null
  interestRate?: string | null
  /** IP address at time of e-signature (audit record) */
  ipAddress?: string | null
  /** Drawn signature: base64 PNG (data URL or raw base64) for embedding in Print Name field */
  signatureImagePngBase64?: string | null
}

/** Terms the user agreed to when e-signing (shown on page 3) */
const E_SIGN_TERMS = `I authorize OverTaxed IL to act as my representative and file this property tax appeal with the Cook County Assessor on my behalf. I certify that I am the property owner or authorized to act for the owner, and that the information provided is accurate. By checking this box and saving, I am electronically signing the official authorization form. Electronic signatures are accepted by Cook County per the Illinois Electronic Commerce Security Act (5 ILCS 175).`

function fmt(v: string | number | null | undefined): string {
  if (v == null || v === "") return ""
  return String(v).trim()
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  })
}

/** Load the bundled official Cook County Attorney/Representative Authorization form. */
function loadOfficialFormPdf(): Uint8Array | null {
  const filePath = join(process.cwd(), "public", "forms", "cook-county-auth-form.pdf")
  // #region agent log
  _dbg("H1", "loadOfficialFormPdf entry", { filePath, cwd: process.cwd(), exists: existsSync(filePath) })
  // #endregion
  try {
    const buf = readFileSync(filePath)
    const result = new Uint8Array(buf)
    // #region agent log
    _dbg("H1", "loadOfficialFormPdf success", { byteLength: result.length })
    // #endregion
    return result
  } catch (err) {
    // #region agent log
    _dbg("H1", "loadOfficialFormPdf failed", { error: String(err) })
    // #endregion
    console.error("[fill-official-auth-form] Bundled PDF not found", err)
    return null
  }
}

export async function fillOfficialCookCountyAuthForm(
  data: FillOfficialAuthFormData
): Promise<Uint8Array | null> {
  // #region agent log
  _dbg("H2", "fillOfficialCookCountyAuthForm entry", { ownerName: data.ownerName?.slice(0, 5), taxYear: data.taxYear })
  // #endregion
  try {
    const pdfBytes = loadOfficialFormPdf()
    if (!pdfBytes || pdfBytes.length === 0) {
      // #region agent log
      _dbg("H2", "fillOfficialCookCountyAuthForm load null", { hadBytes: !!pdfBytes, len: pdfBytes?.length ?? 0 })
      // #endregion
      return null
    }
    const doc = await PDFDocument.load(pdfBytes)
    const form = doc.getForm()

    const pinFormatted = data.propertyPin.replace(/\D/g, "")
    const pinDisplay =
      pinFormatted.length === 14
        ? `${pinFormatted.slice(0, 2)}-${pinFormatted.slice(2, 4)}-${pinFormatted.slice(4, 7)}-${pinFormatted.slice(7, 10)}-${pinFormatted.slice(10, 14)}`
        : data.propertyPin

    // Map our data to Cook County form fields (by exact name from getFields())
    // PIN: fill only once (Property Index Numbers); _2 is duplicate, leave empty
    const fieldMap: Record<string, string> = {
      "Appeal Year": fmt(data.taxYear),
      "Property Index Numbers": pinDisplay,
      "Property Index Numbers_2": "", // Duplicate - leave empty
      "Property Street Address": `${fmt(data.propertyAddress)}, ${fmt(data.propertyCity)} ${fmt(data.propertyState)} ${fmt(data.propertyZip)}`,
      City: fmt(data.propertyCity),
      Zip: fmt(data.propertyZip),
      Township: fmt(data.propertyTownship),
      // State fields (try common names; form may use Text2/Text3 etc.)
      State: fmt(data.propertyState),
      State_2: fmt(data.ownerState),
      "Owner I Taxpayer": fmt(data.ownerName),
      "Owners Mailing Address": fmt(data.ownerAddress),
      City_2: fmt(data.ownerCity),
      Zip_2: fmt(data.ownerZip),
      "Daytime Phone Number": fmt(data.ownerPhone),
      "Email Address": fmt(data.ownerEmail),
      // Print Name: always text (name); drawn signature goes on signature line via drawImage
      "Print Name": `/s/ ${fmt(data.ownerName)}`,
      Date: fmtDate(data.signedAt),
      // Affiant = person swearing (owner/authorized signer)
      "being first duly sworn on oath state": fmt(data.affiantName ?? data.ownerName),
      // Q3: purchase/refinance in past 3 years (only when yes)
      "Purchase Price": data.purchasedInPast3Years ? fmt(data.purchasePrice) : "",
      "Date of Purchase": data.purchasedInPast3Years && data.dateOfPurchase ? fmtDate(data.dateOfPurchase) : "",
      "corporationpartnership which owns the property described above": "", // N/A for individuals
      // Do NOT fill Text2–Text7: they map to State, tax buyer, page 2 — interest rate drawn separately below
      // Page 2: Appointed representative (OverTaxed IL)
      "Firm Name": REP_FIRM_NAME,
      "Street Address": REP_STREET,
      City_3: REP_CITY,
      "Daytime Phone Number_3": REP_PHONE,
      Zip_3: REP_ZIP,
      "Print Name_2": REP_SIGNER,
      Date_2: fmtDate(data.signedAt),
      "whose name appears on the appeal form to represent me before the Assessor relative to the": REP_FIRM_NAME,
    }

    for (const [name, value] of Object.entries(fieldMap)) {
      try {
        const field = form.getTextField(name)
        field.setText(value ?? "")
      } catch {
        // Field may not exist or have different type; skip
      }
    }

    // Draw signature image on signature line (page 2)
    if (data.signatureImagePngBase64) {
      try {
        const base64 = data.signatureImagePngBase64.replace(/^data:image\/png;base64,/, "")
        const pngBytes = Buffer.from(base64, "base64")
        const pngImage = await doc.embedPng(pngBytes)
        const pages = doc.getPages()
        const page2 = pages[1]
        if (page2) {
          page2.drawImage(pngImage, {
            x: SIG_LINE_X,
            y: SIG_LINE_Y,
            width: SIG_LINE_W,
            height: SIG_LINE_H,
          })
        }
      } catch (err) {
        console.error("[fill-official-auth-form] Failed to draw signature image", err)
      }
    }

    // Relationship checkboxes: only ONE of owner/lessee/tax buyer/duly authorized
    // 8=owner, 9=lessee, 10=tax buyer, 11=duly authorized officer/agent
    const relMap: Record<AuthRelationshipType, number> = {
      OWNER: 8,
      LESSEE: 9,
      TAX_BUYER: 10,
      DULY_AUTHORIZED: 11,
    }
    const rel = (data.relationshipType ?? "OWNER") as AuthRelationshipType
    for (let i = 8; i <= 11; i++) {
      try {
        const field = form.getCheckBox(`Check Box${i}`)
        field.uncheck()
      } catch {
        /* skip */
      }
    }
    try {
      const idx = relMap[rel] ?? 8
      form.getCheckBox(`Check Box${idx}`).check()
    } catch {
      form.getCheckBox("Check Box8").check() // fallback owner
    }

    // Q3: Purchased OR Refinanced — Check Box 12=Purchased, 13=Refinanced
    for (let i = 12; i <= 13; i++) {
      try {
        form.getCheckBox(`Check Box${i}`).uncheck()
      } catch {
        /* skip */
      }
    }
    const pr = data.purchasedOrRefinanced?.toUpperCase()
    if (data.purchasedInPast3Years && (pr === "PURCHASED" || pr === "PURCHASE")) {
      try {
        form.getCheckBox("Check Box12").check()
      } catch {
        /* skip */
      }
    } else if (data.purchasedInPast3Years && (pr === "REFINANCED" || pr === "REFINANCE")) {
      try {
        form.getCheckBox("Check Box13").check()
      } catch {
        /* skip */
      }
    }

    // Type of rate — Check Box 14=Variable, 15=Fixed (per Cook County form layout)
    for (let i = 14; i <= 15; i++) {
      try {
        form.getCheckBox(`Check Box${i}`).uncheck()
      } catch {
        /* skip */
      }
    }
    const rate = String(data.rateType ?? "").toUpperCase()
    if (data.purchasedInPast3Years && (rate === "FIXED" || rate === "FIXED RATE")) {
      try {
        form.getCheckBox("Check Box15").check()
      } catch {
        /* skip */
      }
    } else if (data.purchasedInPast3Years && (rate === "VARIABLE" || rate === "ADJUSTABLE" || rate === "ADJUSTABLE RATE" || rate === "ARM")) {
      try {
        form.getCheckBox("Check Box14").check()
      } catch {
        /* skip */
      }
    }

    // Draw interest rate number only (no "Fixed"/"Variable" word) — to the right of "Interest Rate" label, before % sign
    if (data.purchasedInPast3Years && fmt(data.interestRate)) {
      try {
        const pages = doc.getPages()
        const page1 = pages[0]
        if (page1) {
          const font = await doc.embedFont(StandardFonts.Helvetica)
          page1.drawText(fmt(data.interestRate), {
            x: 365,
            y: 72,
            size: 10,
            font,
            color: rgb(0, 0, 0),
          })
        }
      } catch (err) {
        console.error("[fill-official-auth-form] Failed to draw interest rate", err)
      }
    }

    form.flatten()

    // Add page 3: Electronic authorization record (IP, terms, audit trail)
    const page = doc.addPage([612, 792])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const margin = 50
    const maxWidth = 512
    let y = 750

    const wrapLines = (text: string, fontSize: number): string[] => {
      const words = text.split(/\s+/)
      const lines: string[] = []
      let line = ""
      for (const w of words) {
        const test = line ? `${line} ${w}` : w
        const ww = font.widthOfTextAtSize(test, fontSize)
        if (ww > maxWidth && line) {
          lines.push(line)
          line = w
        } else {
          line = test
        }
      }
      if (line) lines.push(line)
      return lines
    }

    page.drawText("Electronic Authorization Record", {
      x: margin,
      y,
      size: 14,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= 24

    page.drawText("This page is attached to the Cook County Attorney/Representative Authorization form as an audit record of the electronic signature.", {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
      maxWidth,
    })
    y -= 36

    page.drawText("Signer:", { x: margin, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
    y -= 14
    page.drawText(fmt(data.ownerName), { x: margin, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) })
    y -= 14
    page.drawText(`Date and time: ${data.signedAt.toLocaleString("en-US")}`, { x: margin, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) })
    y -= 20

    if (data.ipAddress) {
      page.drawText("IP address (at time of signing):", { x: margin, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
      y -= 14
      page.drawText(data.ipAddress, { x: margin, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) })
      y -= 20
    }

    page.drawText("Terms agreed to:", { x: margin, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) })
    y -= 14
    for (const line of wrapLines(E_SIGN_TERMS, 9)) {
      page.drawText(line, { x: margin, y, size: 9, font, color: rgb(0.2, 0.2, 0.2) })
      y -= 12
    }
    y -= 16

    page.drawText("OverTaxed IL — Electronic signature record. Generated for audit purposes.", {
      x: margin,
      y,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    })

    const saved = await doc.save()
    // #region agent log
    _dbg("H2", "fillOfficialCookCountyAuthForm success", { savedLength: saved.length })
    // #endregion
    return saved
  } catch (err) {
    // #region agent log
    _dbg("H2", "fillOfficialCookCountyAuthForm throw", { error: String(err) })
    // #endregion
    console.error("[fill-official-auth-form]", err)
    return null
  }
}
