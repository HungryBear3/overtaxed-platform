/** @jest-environment node */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const MIGRATION_DIR =
  "prisma/migrations/20260912120000_add_ot_packet_download_and_orphan_quarantine"
const SQL = readFileSync(join(ROOT, MIGRATION_DIR, "migration.sql"), "utf8")

function model(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  expect(start).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf("\n}", start)
  return SCHEMA.slice(start, end)
}

describe("download capability schema", () => {
  const capability = () => model("OTPacketDownloadCapability")

  it("persists a hash and never the capability value", () => {
    expect(capability()).toMatch(/capabilityHash\s+String\s+@unique\s+@map\("capability_hash"\)/)
    // Any column that could hold the secret itself.
    expect(capability()).not.toMatch(/capabilityValue|capability_value|plaintext|token\b/i)
  })

  it("binds the exact artifact identity, order, and property fingerprint", () => {
    for (const field of [
      /artifactId\s+String\s+@map\("artifact_id"\)/,
      /artifactVersion\s+Int\s+@map\("artifact_version"\)/,
      /artifactSha256\s+String\s+@map\("artifact_sha256"\)/,
      /sourceOrderId\s+String\s+@map\("source_order_id"\)/,
      /propertyBindingFingerprint\s+String\s+@map\("property_binding_fingerprint"\)/,
    ]) {
      expect(capability()).toMatch(field)
    }
  })

  it("reuses the intra-evidence composite identity FK, so it cannot name a foreign artifact", () => {
    expect(capability()).toMatch(
      /artifact\s+OTFulfillmentArtifact\s+@relation\(fields:\s*\[fulfillmentId,\s*artifactVersion\],\s*references:\s*\[fulfillmentId,\s*version\][\s\S]*onDelete:\s*NoAction/,
    )
    expect(capability()).toMatch(/fulfillment\s+OTFulfillment\s+@relation[\s\S]*onDelete:\s*Cascade/)
  })

  it("carries a durable lifetime, use budget and revocation", () => {
    for (const field of [
      /expiresAt\s+DateTime\s+@map\("expires_at"\)/,
      /maxUses\s+Int\s+@map\("max_uses"\)/,
      /useCount\s+Int\s+@default\(0\)\s+@map\("use_count"\)/,
      /revokedAt\s+DateTime\?\s+@map\("revoked_at"\)/,
      /revokedReasonCode\s+String\?\s+@map\("revoked_reason_code"\)/,
    ]) {
      expect(capability()).toMatch(field)
    }
  })

  it("is reachable from the fulfillment and artifact it belongs to", () => {
    expect(model("OTFulfillment")).toMatch(/downloadCapabilities\s+OTPacketDownloadCapability\[\]/)
    expect(model("OTFulfillmentArtifact")).toMatch(
      /downloadCapabilities\s+OTPacketDownloadCapability\[\]/,
    )
  })
})

describe("orphan quarantine schema", () => {
  const quarantine = () => model("OTArtifactOrphanQuarantine")

  it("always records the expected content digest and where the bytes may be", () => {
    expect(quarantine()).toMatch(/artifactSha256\s+String\s+@map\("artifact_sha256"\)/)
    expect(quarantine()).toMatch(/storageLocator\s+String\s+@map\("storage_locator"\)/)
  })

  it("represents an unobserved upload outcome as its own state", () => {
    expect(quarantine()).toMatch(/uploadOutcome\s+String\s+@map\("upload_outcome"\)/)
    expect(SQL).toMatch(/"upload_outcome" IN \('CONFIRMED', 'UNKNOWN'\)/)
  })

  it("is idempotent per fulfillment, location and digest", () => {
    expect(quarantine()).toMatch(
      /@@unique\(\[fulfillmentId,\s*storageLocator,\s*artifactSha256\]\)/,
    )
    expect(quarantine()).toMatch(/observationCount\s+Int\s+@default\(1\)/)
  })

  it("deliberately has NO cascade to ot_fulfillment", () => {
    // A cascade would delete the exact record stating that bytes may exist in
    // private storage — the fact an operator needs most once the parent is gone.
    expect(quarantine()).not.toMatch(/@relation\(/)
    expect(SQL).not.toMatch(
      /ALTER TABLE "ot_artifact_orphan_quarantine"[\s\S]*FOREIGN KEY/,
    )
  })

  it("keeps reason codes bounded to columns, never free-form payloads", () => {
    expect(quarantine()).toMatch(/firstReasonCode\s+String\s+@map\("first_reason_code"\)/)
    expect(quarantine()).toMatch(/lastReasonCode\s+String\s+@map\("last_reason_code"\)/)
    expect(quarantine()).not.toMatch(/payload|message|detail|stack/i)
  })
})

describe("the migration is additive and discoverable", () => {
  it("ships as one timestamped directory Prisma will find", () => {
    expect(existsSync(join(ROOT, MIGRATION_DIR, "migration.sql"))).toBe(true)
    const names = readdirSync(join(ROOT, "prisma/migrations"))
    expect(names).toContain(
      "20260912120000_add_ot_packet_download_and_orphan_quarantine",
    )
  })

  it("creates exactly the two new tables and alters no existing one", () => {
    expect([...SQL.matchAll(/CREATE TABLE /g)]).toHaveLength(2)
    expect(SQL).toContain('CREATE TABLE "ot_packet_download_capability"')
    expect(SQL).toContain('CREATE TABLE "ot_artifact_orphan_quarantine"')
    expect(SQL).not.toMatch(
      /ALTER TABLE "ot_(order|fulfillment|fulfillment_artifact|delivery_attempt|delivery_event|fulfillment_admin_event)"/,
    )
  })

  it("destroys and backfills nothing", () => {
    expect(SQL).not.toMatch(/\bDROP\b|\bTRUNCATE\b/i)
    expect(SQL).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im)
  })

  it("enforces the capability invariants in the database, not only in code", () => {
    expect(SQL).toMatch(/"capability_hash" ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(SQL).toMatch(/"artifact_sha256" ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(SQL).toMatch(/"use_count" >= 0 AND "use_count" <= "max_uses"/)
    expect(SQL).toMatch(/"expires_at" > "issued_at"/)
    expect(SQL).toMatch(/"max_uses" BETWEEN 1 AND 1000/)
    // Revocation is all-or-nothing, so a half-revoked row cannot exist.
    expect(SQL).toMatch(/"revoked_at" IS NULL AND "revoked_reason_code" IS NULL/)
    expect(SQL).toContain('CREATE UNIQUE INDEX "ot_packet_download_capability_capability_hash_key"')
  })

  it("refuses a public bearer URL as a quarantined locator at the database level", () => {
    expect(SQL).toMatch(/"storage_locator" ~ '\^\[A-Za-z0-9\._\/-\]\+\$'/)
    expect(SQL).toMatch(/"storage_locator" NOT LIKE '\/%'/)
  })
})

describe("runtime wiring guards", () => {
  const sources = {
    route: readFileSync(join(ROOT, "app/api/ot/packet/download/route.ts"), "utf8"),
    service: readFileSync(join(ROOT, "lib/fulfillment-runtime/packet-download.ts"), "utf8"),
    downloadStore: readFileSync(
      join(ROOT, "lib/fulfillment-runtime/packet-download-store.ts"),
      "utf8",
    ),
    orphanStore: readFileSync(
      join(ROOT, "lib/fulfillment-runtime/artifact-orphan-store.ts"),
      "utf8",
    ),
    storage: readFileSync(
      join(ROOT, "lib/fulfillment-runtime/t2-artifact-storage.ts"),
      "utf8",
    ),
    workflow: readFileSync(
      join(ROOT, "lib/fulfillment-runtime/t2-artifact-workflow.ts"),
      "utf8",
    ),
  }

  it.each(["route", "service", "downloadStore", "orphanStore"] as const)(
    "%s cannot reach a settlement, provider, or mail side effect",
    (key) => {
      const source = sources[key].toLowerCase()
      for (const forbidden of [
        "fulfillment-runtime/kickoff",
        "lib/email",
        "lib/stripe",
        "stripe(",
        "nodemailer",
        "resend",
        "webhook",
      ]) {
        expect(source).not.toContain(forbidden)
      }
    },
  )

  it("the storage module has no deletion capability and no orphan placeholder", () => {
    expect(sources.storage).not.toMatch(/reconcileUnboundT2Artifact/)
    expect(sources.storage).not.toMatch(/\bdel\b|\.delete\(|copy\(/)
    // Quarantine recording lives outside the provider-facing module.
    expect(sources.storage).not.toMatch(/@\/lib\/db|@prisma\/client/)
  })

  it("the orphan recorder never touches storage", () => {
    expect(sources.orphanStore).not.toMatch(/@vercel\/blob|t2-artifact-storage/)
  })

  it("the workflow records an orphan on BOTH unknown upload and unknown bind", () => {
    expect(sources.workflow).toMatch(/reasonCode: "UPLOAD_OUTCOME_UNKNOWN"/)
    expect(sources.workflow).toMatch(/reasonCode: "BIND_OUTCOME_UNKNOWN"/)
    expect(sources.workflow).toMatch(/uploadOutcome: "UNKNOWN"/)
  })

  it("every new flag is its own strict, default-off switch", () => {
    const flags = readFileSync(join(ROOT, "lib/fulfillment/flag.ts"), "utf8")
    for (const name of ["OT_T2_PACKET_DOWNLOAD_ENABLED", "OT_T2_DELIVERY_ENABLED"]) {
      expect(flags).toContain(name)
    }
    // Strict equality only — nothing here can be enabled by a truthy fallback.
    expect(flags).not.toMatch(/===\s*"true"\s*\|\||\?\?\s*true/)
    expect([...flags.matchAll(/=== "true"/g)].length).toBeGreaterThanOrEqual(7)
  })
})
