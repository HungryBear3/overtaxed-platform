/** @jest-environment node */

import { readFileSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const MIGRATION = join(
  ROOT,
  "prisma/migrations/20260808173000_add_ot_fulfillment_admin_events/migration.sql",
)

function model(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  expect(start).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf("\n}", start)
  return SCHEMA.slice(start, end)
}

describe("OT fulfillment actor-attributed admin audit schema", () => {
  it("adds the mapped append-only model and fulfillment relation", () => {
    const audit = model("OTFulfillmentAdminEvent")
    expect(audit).toContain('@@map("ot_fulfillment_admin_event")')
    expect(audit).toMatch(/actorUserId\s+String\s+@map\("actor_user_id"\)/)
    expect(audit).toMatch(/@@unique\(\[fulfillmentId,\s*toRevision\]\)/)
    expect(audit).toMatch(/@@index\(\[fulfillmentId,\s*createdAt\]\)/)
    expect(audit).toMatch(/onDelete:\s*Cascade/)
    expect(model("OTFulfillment")).toMatch(
      /adminEvents\s+OTFulfillmentAdminEvent\[\]/,
    )
  })

  it("ships a timestamped additive migration with narrow database checks", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    expect(sql).toContain('CREATE TABLE "ot_fulfillment_admin_event"')
    expect(sql).toMatch(/CHECK \("action" = 'ENTER_MANUAL_REVIEW'\)/)
    expect(sql).toMatch(/CHECK \("to_status" = 'MANUAL_REVIEW'\)/)
    expect(sql).toMatch(/CHECK \("reason_code" = 'MANUAL_REVIEW'\)/)
    for (const status of [
      "NOT_STARTED",
      "NEEDS_RECONCILIATION",
      "INCOMPLETE_INPUT",
      "ARTIFACT_PENDING",
      "ARTIFACT_READY",
    ]) expect(sql).toContain(`'${status}'`)
    expect(sql).toMatch(/"from_revision" >= 0/)
    expect(sql).toMatch(/"to_revision" = "from_revision" \+ 1/)
    expect(sql).toMatch(/char_length\("actor_user_id"\) BETWEEN 1 AND 128/i)
    expect(sql).not.toMatch(/ALTER TABLE "ot_(order|fulfillment|delivery_attempt|delivery_event|fulfillment_artifact)"/)
    expect(sql).not.toMatch(/\bDROP\b|^\s*(INSERT|UPDATE|DELETE)\s/im)
  })
})

describe("manual-review runtime wiring guard", () => {
  it.each([
    "app/api/admin/evidence/[orderId]/manual-review/route.ts",
    "lib/fulfillment-runtime/manual-review-store.ts",
  ])("%s cannot reach downstream side-effect modules", (relativePath) => {
    const source = readFileSync(join(ROOT, relativePath), "utf8").toLowerCase()
    for (const forbidden of [
      "fulfillment-runtime/kickoff",
      "fulfillment/retry",
      "packet/",
      "email/",
      "stripe/",
      "webhook",
      "generate-and-deliver",
    ]) expect(source).not.toContain(forbidden)
  })
})
