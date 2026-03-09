/**
 * List all form fields in the Cook County authorization PDF.
 * Run: npx tsx scripts/list-pdf-fields.ts
 */
import { PDFDocument } from "pdf-lib"
import { readFileSync } from "fs"
import { join } from "path"

async function main() {
  const filePath = join(process.cwd(), "public", "forms", "cook-county-auth-form.pdf")
  const buf = readFileSync(filePath)
  const doc = await PDFDocument.load(buf)
  const form = doc.getForm()
  const fields = form.getFields()

  console.log("=== PDF Form Fields ===\n")
  for (const field of fields) {
    const name = field.getName()
    const type = field.constructor.name
    console.log(`${type}: "${name}"`)
  }
}
main()
