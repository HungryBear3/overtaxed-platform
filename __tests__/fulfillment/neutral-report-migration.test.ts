import fs from "node:fs"
import path from "node:path"

test("neutral repository migration is schema-first, private, constrained and non-destructive", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260915143000_add_ot_neutral_report_repository/migration.sql"), "utf8")
  expect(sql).toContain('CREATE TABLE "ot_neutral_report_reservation"')
  expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
  expect(sql).toContain('REVOKE ALL')
  expect(sql).toContain('REFERENCES "ot_order"("id") ON DELETE NO ACTION')
  expect(sql).toContain('ot_neutral_state_shape')
  expect(sql).toContain('ot_neutral_blob_attempt')
  expect(sql).toContain('FORCE ROW LEVEL SECURITY')
  expect(sql).not.toMatch(/DROP\s|TRUNCATE\s|DELETE\s+FROM/i)
})

test("producer resolves PIN from authoritative order in production and flags are default-off", () => {
  const producer = fs.readFileSync(path.join(process.cwd(), "lib/fulfillment-runtime/neutral-report-producer.ts"), "utf8")
  expect(producer).toContain("resolveNeutralOrderAuthority(input.orderId)")
  expect(producer).not.toContain("propertyPin: input.propertyPin }, { active: true")
  expect(producer).toContain('OT_NEUTRAL_REPORT_ACTIVE !== "1"')
})
