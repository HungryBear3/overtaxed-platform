/** @jest-environment node */

/**
 * Old-writer compatibility contract for the Phase 1 confirmation-evidence
 * migration: strictly additive nullable columns on ot_order, so the currently
 * deployed writer (which never mentions these columns) keeps inserting and
 * updating rows unchanged, and no historical financial state is rewritten.
 */

import { readFileSync } from "fs"
import path from "path"

const MIGRATION_DIR = "20260831120000_add_ot_confirmation_email_evidence"
const EVIDENCE_COLUMNS = [
  "confirmationEmailStatus",
  "confirmationEmailAttemptedAt",
  "confirmationEmailSentAt",
  "confirmationEmailMessageId",
  "confirmationEmailErrorClass",
]

function migrationSql(): string {
  return readFileSync(
    path.join(process.cwd(), "prisma", "migrations", MIGRATION_DIR, "migration.sql"),
    "utf8",
  )
}

function schemaSource(): string {
  return readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8")
}

describe("confirmation-evidence migration is additive and old-writer compatible", () => {
  it("only ADDs nullable columns to ot_order", () => {
    const sql = migrationSql()
    expect(sql).toContain('ALTER TABLE "ot_order"')
    for (const column of EVIDENCE_COLUMNS) {
      expect(sql).toContain(`ADD COLUMN "${column}"`)
    }
    // Nothing destructive and no rewrite of existing rows.
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/\bNOT NULL\b/i)
    expect(sql).not.toMatch(/\bDEFAULT\b/i)
    expect(sql).not.toMatch(/\bUPDATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\b/i)
    expect(sql).not.toMatch(/ALTER COLUMN/i)
    // Only the ot_order table is touched.
    const alteredTables = [...sql.matchAll(/ALTER TABLE\s+"([^"]+)"/gi)].map((m) => m[1])
    expect(new Set(alteredTables)).toEqual(new Set(["ot_order"]))
  })

  it("declares every evidence field optional on the OTOrder model", () => {
    const schema = schemaSource()
    const model = schema.slice(schema.indexOf("model OTOrder {"), schema.indexOf("model Referral {"))
    for (const column of EVIDENCE_COLUMNS) {
      const line = model.split("\n").find((l) => l.trim().startsWith(column))
      expect(line).toBeDefined()
      expect(line).toMatch(/(String|DateTime)\?/)
    }
  })
})
