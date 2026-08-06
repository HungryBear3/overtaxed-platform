/**
 * @jest-environment node
 *
 * Matrix row 14: no PII / secrets / raw provider payloads may appear in the new
 * evidence schema fields or in the fulfillment library source. Content locators
 * must be private, never public bearer URLs.
 */
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const MARKER = "OT T2 DELIVERY-EVIDENCE"

// The additive block, comment lines stripped, lowercased. We scan actual schema
// content (enums, model fields) — not the documentation comments, which are free
// to describe the very things the fields must never contain ("no bearer URLs").
function newSchemaBlock(): string {
  const idx = SCHEMA.indexOf(MARKER)
  expect(idx).toBeGreaterThan(-1)
  return SCHEMA.slice(idx)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
    .join("\n")
    .toLowerCase()
}

describe("new evidence schema carries no PII / secrets / payloads / public URLs", () => {
  // Field-name substrings that would indicate PII, a secret, a raw payload, raw
  // artifact bytes, or a public URL leaking into the durable evidence. A byte
  // *size* count (byteSize) is required by the spec and is intentionally allowed;
  // only raw-*bytes* storage names are forbidden.
  const forbidden = [
    "email",
    "address",
    "pin",
    "url",
    "pdfbytes",
    "rawbytes",
    "artifactbytes",
    "filebytes",
    "rawpayload",
    "payload",
    "secret",
    "bearer",
    "downloadtoken",
    "authtoken",
    "reviewtoken",
    "stacktrace",
    "firstname",
    "lastname",
  ]

  it.each(forbidden)("does not reference %s in any new model field", (word) => {
    expect(newSchemaBlock().includes(word)).toBe(false)
  })

  it("stores a private storage locator, not a public blob URL", () => {
    const block = newSchemaBlock()
    expect(block.includes("storagelocator")).toBe(true)
    expect(block.includes("bloburl")).toBe(false)
    expect(block.includes("pdfurl")).toBe(false)
  })

  it("stores a lowercase SHA-256 field for content addressing", () => {
    expect(newSchemaBlock().includes("artifactsha256")).toBe(true)
  })
})

describe("fulfillment library is pure — no side-effecting imports", () => {
  const dir = join(ROOT, "lib/fulfillment")
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"))
  const sideEffectImports = [
    "@/lib/db",
    "@prisma/client",
    "next/server",
    "stripe",
    "resend",
    "nodemailer",
    "@vercel/blob",
  ]

  it("has source files", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(sideEffectImports)("no fulfillment source imports %s", (mod) => {
    // Match real static/dynamic import + require forms (including `export … from`
    // and submodule paths like "resend/x"), so a module name mentioned in a comment
    // (e.g. an "e.g. resend" example) is not a false positive but a genuine
    // side-effecting import in any form is caught.
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const importRe = new RegExp(`(?:from|import\\(|require\\()\\s*["']${escaped}(?:/[^"']*)?["']`)
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8")
      expect(importRe.test(src)).toBe(false)
    }
  })
})
