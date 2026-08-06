/**
 * @jest-environment node
 *
 * Remediation blockers A, B, C (schema): the durable evidence chain is structurally
 * enforceable. Because there is no DB in Phase 1, these assertions verify the
 * relational constraints in prisma/schema.prisma AND the generated review-only SQL,
 * which is the structural proxy for "the database rejects an orphaned/foreign row".
 */
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const SQL = readFileSync(join(ROOT, "prisma/migrations/add_ot_t2_fulfillment_evidence.sql"), "utf8")

function model(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  expect(start).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf("\n}", start)
  return SCHEMA.slice(start, end)
}

describe("A. attempt→artifact identity is relationally enforced (same fulfillment)", () => {
  const attempt = () => model("OTDeliveryAttempt")
  it("binds artifactVersion to an artifact via the shared fulfillmentId composite FK", () => {
    expect(attempt()).toMatch(
      /artifact\s+OTFulfillmentArtifact\s+@relation\(fields:\s*\[fulfillmentId,\s*artifactVersion\],\s*references:\s*\[fulfillmentId,\s*version\]/
    )
  })
  it("the referenced artifact key is unique", () => {
    expect(model("OTFulfillmentArtifact")).toMatch(/@@unique\(\[fulfillmentId,\s*version\]\)/)
  })
  it("the generated SQL emits the attempt→artifact foreign key", () => {
    expect(SQL).toMatch(
      /ALTER TABLE "ot_delivery_attempt"[\s\S]*FOREIGN KEY \("fulfillment_id", "artifact_version"\) REFERENCES "ot_fulfillment_artifact"\("fulfillment_id", "version"\)/
    )
  })
  it("removes the unenforceable current-artifact summary pointers", () => {
    expect(model("OTFulfillment")).not.toMatch(/currentArtifactVersion/)
    expect(model("OTFulfillment")).not.toMatch(/currentArtifactSha256/)
  })
})

describe("B. provider-message uniqueness has no NULL-provider hole", () => {
  const attempt = () => model("OTDeliveryAttempt")
  it("provider is required (non-nullable)", () => {
    expect(attempt()).toMatch(/\n\s*provider\s+String\s*\n/)
    expect(attempt()).not.toMatch(/provider\s+String\?/)
  })
  it("providerMessageId remains nullable so pending attempts are representable", () => {
    expect(attempt()).toMatch(/providerMessageId\s+String\?/)
  })
  it("(provider, providerMessageId) is unique", () => {
    expect(attempt()).toMatch(/@@unique\(\[provider,\s*providerMessageId\]\)/)
  })
})

describe("C. event→attempt binding and unique local sequence", () => {
  const event = () => model("OTDeliveryEvent")
  it("attemptNumber is required and bound to a real attempt of the same fulfillment", () => {
    expect(event()).toMatch(/\n\s*attemptNumber\s+Int\s/)
    expect(event()).not.toMatch(/attemptNumber\s+Int\?/)
    expect(event()).toMatch(
      /attempt\s+OTDeliveryAttempt\s+@relation\(fields:\s*\[fulfillmentId,\s*attemptNumber\],\s*references:\s*\[fulfillmentId,\s*attemptNumber\]/
    )
  })
  it("(fulfillmentId, sequence) is UNIQUE, not merely indexed", () => {
    expect(event()).toMatch(/@@unique\(\[fulfillmentId,\s*sequence\]\)/)
    expect(event()).not.toMatch(/@@index\(\[fulfillmentId,\s*sequence\]\)/)
  })
  it("(provider, providerEventId) remains the dedup identity", () => {
    expect(event()).toMatch(/@@unique\(\[provider,\s*providerEventId\]\)/)
  })
  it("the generated SQL emits the event→attempt FK and the unique sequence", () => {
    expect(SQL).toMatch(
      /ALTER TABLE "ot_delivery_event"[\s\S]*FOREIGN KEY \("fulfillment_id", "attempt_number"\) REFERENCES "ot_delivery_attempt"\("fulfillment_id", "attempt_number"\)/
    )
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "ot_delivery_event_fulfillment_id_sequence_key"/)
  })
})

describe("migration remains additive and non-destructive", () => {
  it("performs no ALTER/DROP on existing tables and no DML backfill", () => {
    expect(SQL).not.toMatch(/ALTER TABLE "ot_order"/)
    expect(SQL).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i)
    // DML statements are anchored to line starts so `ON UPDATE/DELETE CASCADE`
    // clauses (which contain those words mid-line) are not false positives.
    expect(SQL).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im)
    // Only new tables are altered; the sole ot_order reference is an inbound FK.
    const alterTargets = [...SQL.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1])
    expect(new Set(alterTargets)).toEqual(new Set(["ot_fulfillment", "ot_fulfillment_artifact", "ot_delivery_attempt", "ot_delivery_event"]))
  })
})
