/**
 * Fill the official Cook County Attorney/Representative Authorization form
 * with our captured data. Produces a single document for our records and Cook County.
 *
 * Form source: https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/attorneyrepresentativeauthorizationform.pdf
 * Field names from pdf-lib getForm().getFields()
 * Bundled copy at public/forms/cook-county-auth-form.pdf used when fetch fails (e.g. Vercel serverless)
 */
import { PDFDocument } from "pdf-lib"
import { readFileSync } from "fs"
import { join } from "path"

const OFFICIAL_FORM_URL =
  "https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/attorneyrepresentativeauthorizationform.pdf"

export interface FillOfficialAuthFormData {
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
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
}

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

/**
 * Fetch the official Cook County PDF and fill it with our data.
 * Returns the filled PDF bytes, or null if fetch/fill fails.
 */
async function loadOfficialFormPdf(): Promise<Uint8Array | null> {
  // Try fetch first (may fail in serverless due to network/403)
  try {
    const res = await fetch(OFFICIAL_FORM_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OverTaxed-IL/1.0)" },
      cache: "no-store",
    })
    if (res.ok) {
      return new Uint8Array(await res.arrayBuffer())
    }
  } catch (err) {
    console.warn("[fill-official-auth-form] Fetch failed, using bundled copy", err)
  }
  // Fallback: bundled copy (reliable in Vercel/serverless)
  try {
    const path = join(process.cwd(), "public", "forms", "cook-county-auth-form.pdf")
    const buf = readFileSync(path)
    return new Uint8Array(buf)
  } catch (err) {
    console.error("[fill-official-auth-form] Bundled PDF not found", err)
    return null
  }
}

export async function fillOfficialCookCountyAuthForm(
  data: FillOfficialAuthFormData
): Promise<Uint8Array | null> {
  try {
    const pdfBytes = await loadOfficialFormPdf()
    if (!pdfBytes || pdfBytes.length === 0) return null
    const doc = await PDFDocument.load(pdfBytes)
    const form = doc.getForm()

    const pinFormatted = data.propertyPin.replace(/\D/g, "")
    const pinDisplay =
      pinFormatted.length === 14
        ? `${pinFormatted.slice(0, 2)}-${pinFormatted.slice(2, 4)}-${pinFormatted.slice(4, 7)}-${pinFormatted.slice(7, 10)}-${pinFormatted.slice(10, 14)}`
        : data.propertyPin

    // Map our data to Cook County form fields (by exact name from getFields())
    const fieldMap: Record<string, string> = {
      "Appeal Year": fmt(data.taxYear),
      "Property Index Numbers": pinDisplay,
      "Property Index Numbers_2": pinDisplay,
      "Property Street Address": `${fmt(data.propertyAddress)}, ${fmt(data.propertyCity)} ${fmt(data.propertyState)} ${fmt(data.propertyZip)}`,
      City: fmt(data.propertyCity),
      Zip: fmt(data.propertyZip),
      "Owner I Taxpayer": fmt(data.ownerName),
      "Owners Mailing Address": fmt(data.ownerAddress),
      City_2: fmt(data.ownerCity),
      Zip_2: fmt(data.ownerZip),
      "Daytime Phone Number": fmt(data.ownerPhone),
      "Email Address": fmt(data.ownerEmail),
      "Print Name": fmt(data.ownerName),
      Date: fmtDate(data.signedAt),
    }

    for (const [name, value] of Object.entries(fieldMap)) {
      try {
        const field = form.getTextField(name)
        if (value) field.setText(value)
      } catch {
        // Field may not exist or have different type; skip
      }
    }

    // Check authorization declaration checkboxes (owner attests)
    for (let i = 8; i <= 11; i++) {
      try {
        const field = form.getCheckBox(`Check Box${i}`)
        field.check()
      } catch {
        // Skip if not found
      }
    }

    form.flatten()
    return doc.save()
  } catch (err) {
    console.error("[fill-official-auth-form]", err)
    return null
  }
}
