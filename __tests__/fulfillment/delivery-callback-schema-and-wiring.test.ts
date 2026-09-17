/** @jest-environment node */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
const MIGRATION_DIR = "prisma/migrations/20260912160000_add_ot_t2_delivery_callbacks"
const SQL = readFileSync(join(ROOT, MIGRATION_DIR, "migration.sql"), "utf8")

function model(name: string): string {
  const start = SCHEMA.indexOf(`model ${name} {`)
  expect(start).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf("\n}", start)
  return SCHEMA.slice(start, end)
}

describe("the provider-callback log schema", () => {
  const callback = () => model("OTDeliveryProviderCallback")

  it("dedups on the signed envelope identity", () => {
    expect(callback()).toMatch(/providerEventId\s+String\s+@map\("provider_event_id"\)/)
    expect(callback()).toMatch(/@@unique\(\[provider,\s*providerEventId\]\)/)
  })

  it("keeps the provider message id, which is the only correlation there is", () => {
    expect(callback()).toMatch(/providerMessageId\s+String\s+@map\("provider_message_id"\)/)
    expect(callback()).toMatch(/@@index\(\[providerMessageId\]\)/)
  })

  it("stores a bounded disposition and reason, never a payload or recipient", () => {
    expect(callback()).toMatch(/disposition\s+String/)
    expect(callback()).toMatch(/dispositionCode\s+String\?\s+@map\("disposition_code"\)/)
    expect(callback()).toMatch(/reasonCode\s+String\?\s+@map\("reason_code"\)/)
    expect(callback()).not.toMatch(/payload|recipient|subject|body|rawEvent|capability/i)
  })

  it("keeps the binding nullable, because an early event has nothing to bind to", () => {
    expect(callback()).toMatch(/fulfillmentId\s+String\?\s+@map\("fulfillment_id"\)/)
    expect(callback()).toMatch(/attemptNumber\s+Int\?\s+@map\("attempt_number"\)/)
    expect(callback()).toMatch(/resolvedAt\s+DateTime\?\s+@map\("resolved_at"\)/)
  })

  it("bounds replay so an unresolvable row cannot be retried forever", () => {
    expect(callback()).toMatch(/replayCount\s+Int\s+@default\(0\)\s+@map\("replay_count"\)/)
  })

  it("deliberately has NO cascade to ot_fulfillment", () => {
    // A cascade would delete the record of what a provider said about an order
    // at the moment that order row goes away — the evidence a dispute needs.
    expect(callback()).not.toMatch(/@relation\(/)
    expect(SQL).not.toMatch(
      /ALTER TABLE "ot_delivery_provider_callback"[\s\S]*?FOREIGN KEY/,
    )
  })
})

describe("the attempt/capability association", () => {
  const attempt = () => model("OTDeliveryAttempt")

  it("records which credential an attempt handed out, and only one per capability", () => {
    expect(attempt()).toMatch(
      /downloadCapabilityId\s+String\?\s+@unique\s+@map\("download_capability_id"\)/,
    )
    expect(attempt()).toMatch(
      /downloadCapability\s+OTPacketDownloadCapability\?\s+@relation\([\s\S]*?onDelete:\s*NoAction/,
    )
  })

  it("is nullable, because an attempt is durable before its capability exists", () => {
    expect(attempt()).toMatch(/downloadCapabilityId\s+String\?/)
    expect(SQL).toMatch(/ADD COLUMN "download_capability_id" TEXT;/)
    expect(SQL).not.toMatch(/"download_capability_id" TEXT NOT NULL/)
  })

  it("is reachable from the capability it names", () => {
    expect(model("OTPacketDownloadCapability")).toMatch(
      /deliveryAttempt\s+OTDeliveryAttempt\?/,
    )
  })
})

describe("the migration is additive and discoverable", () => {
  it("ships as one timestamped directory Prisma will find", () => {
    expect(existsSync(join(ROOT, MIGRATION_DIR, "migration.sql"))).toBe(true)
    expect(readdirSync(join(ROOT, "prisma/migrations"))).toContain(
      "20260912160000_add_ot_t2_delivery_callbacks",
    )
  })

  it("creates exactly one table and adds exactly one column", () => {
    expect([...SQL.matchAll(/CREATE TABLE /g)]).toHaveLength(1)
    expect(SQL).toContain('CREATE TABLE "ot_delivery_provider_callback"')
    expect([...SQL.matchAll(/ADD COLUMN /g)]).toHaveLength(1)
  })

  it("destroys, retypes and backfills nothing", () => {
    expect(SQL).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bALTER COLUMN\b/i)
    expect(SQL).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im)
  })

  it("touches no settlement or payment table", () => {
    expect(SQL).not.toMatch(/ALTER TABLE "ot_order"/)
    expect(SQL).not.toMatch(/"stripe_event"|"Invoice"|"User"/)
  })

  it("enforces the callback invariants in the database, not only in code", () => {
    expect(SQL).toMatch(/"disposition" IN \('APPLIED', 'UNMATCHED', 'REFUSED'\)/)
    // A bounded, uppercase-only reason: free provider text cannot be stored.
    expect(SQL).toMatch(/"reason_code" IS NULL OR "reason_code" ~ '\^\[A-Z_\]\{1,64\}\$'/)
    expect(SQL).toMatch(/"disposition_code" IS NULL OR "disposition_code" ~ '\^\[A-Z_\]\{1,64\}\$'/)
    // An APPLIED row that points at nothing would be a lie.
    expect(SQL).toMatch(/"disposition" <> 'APPLIED'/)
    // A callback can never claim an attempt without naming its fulfillment.
    expect(SQL).toMatch(/"attempt_number" IS NULL OR "fulfillment_id" IS NOT NULL/)
    expect(SQL).toMatch(/"replay_count" >= 0 AND "replay_count" <= 1000/)
    expect(SQL).toContain('CREATE UNIQUE INDEX "ot_delivery_provider_callback_provider_event_key"')
    expect(SQL).toContain('CREATE UNIQUE INDEX "ot_delivery_attempt_download_capability_id_key"')
  })

  it("keeps the new evidence out of reach of every API role", () => {
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(SQL).toMatch(/REVOKE ALL ON TABLE "ot_delivery_provider_callback" FROM PUBLIC/)
    expect(SQL).toMatch(/ARRAY\['anon', 'authenticated'\]/)
  })
})

describe("every new switch is its own strict, default-off gate", () => {
  const flags = readFileSync(join(ROOT, "lib/fulfillment/flag.ts"), "utf8")

  it.each([
    "OT_T2_DELIVERY_ADAPTER_ENABLED",
    "OT_T2_DELIVERY_CALLBACK_ENABLED",
    "OT_T2_DELIVERY_RECOVERY_ENABLED",
  ])("%s exists and is compared with strict equality", (name) => {
    expect(flags).toContain(name)
  })

  it("has no truthy fallback that could enable anything", () => {
    expect(flags).not.toMatch(/===\s*"true"\s*\|\||\?\?\s*true/)
    expect([...flags.matchAll(/=== "true"/g)].length).toBeGreaterThanOrEqual(10)
  })
})

describe("runtime wiring guards", () => {
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

  /**
   * Source with comments removed.
   *
   * Several of these modules document at length the exact things they promise
   * not to do — "never a correlation tag", "never `request.json()`". A scan that
   * could not tell prose from code would force them to stop explaining
   * themselves, so the checks below run over code only. Line comments are
   * stripped only when they start a line, so a `https://` inside a string is
   * untouched.
   */
  const codeOnly = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
  const sources = {
    callbackRoute: read("app/api/ot/webhooks/resend/route.ts"),
    callbackService: read("lib/fulfillment-runtime/t2-resend-events.ts"),
    callbackStore: read("lib/fulfillment-runtime/provider-callback-store.ts"),
    adapter: read("lib/fulfillment-runtime/t2-resend-adapter.ts"),
    issuance: read("lib/fulfillment-runtime/t2-packet-issuance.ts"),
    orchestrator: read("lib/fulfillment-runtime/t2-delivery-orchestrator.ts"),
    scheduling: read("lib/fulfillment-runtime/t2-artifact-scheduling.ts"),
    recoveryRoute: read("app/api/admin/evidence/[orderId]/delivery-recovery/route.ts"),
    pureCallbacks: read("lib/fulfillment/provider-callbacks.ts"),
    packetPage: read("app/packet/page.tsx"),
    packetForm: read("app/packet/packet-form.tsx"),
  }

  it("the T2 callback path never reuses the outreach secret or verifier", () => {
    for (const key of ["callbackRoute", "callbackService", "callbackStore"] as const) {
      expect(sources[key]).not.toContain("OUTREACH_RESEND_WEBHOOK_SECRET")
      expect(sources[key]).not.toContain("lib/outreach")
      expect(sources[key]).not.toContain("verifyResendSignature")
    }
    expect(sources.callbackService).toContain("OT_T2_RESEND_WEBHOOK_SECRET")
  })

  it("the T2 verifier has no environment exception and no HMAC fallback", () => {
    // The outreach verifier permits an absent secret outside production and
    // carries a legacy raw-HMAC path. Neither may exist here.
    expect(sources.callbackService).not.toMatch(/NODE_ENV/)
    expect(sources.callbackService).not.toMatch(/createHmac|timingSafeEqual|resend-signature/)
  })

  it("the callback route reads raw bytes, never a parsed body", () => {
    expect(sources.callbackRoute).toContain("request.text()")
    expect(codeOnly(sources.callbackRoute)).not.toContain("request.json()")
  })

  it("no correlation tag is ever sent or read", () => {
    // The provider is not required to echo one and this system never assumes it
    // does. Correlation is the provider message id, and only that.
    for (const key of ["adapter", "pureCallbacks", "callbackStore", "callbackService"] as const) {
      expect(codeOnly(sources[key])).not.toMatch(/\btags\b/)
    }
  })

  it("the pure callback layer reaches no database, framework or provider", () => {
    expect(sources.pureCallbacks).not.toMatch(
      /@\/lib\/db|@prisma\/client|next\/server|from "resend"|from "svix"/,
    )
  })

  it("the issuer has no public entry point", () => {
    // Nothing reachable by order id, email, or session may mint a capability.
    expect(sources.issuance).not.toMatch(/NextRequest|NextResponse|getSession/)
    const routes = join(ROOT, "app/api/ot")
    const names = readdirSync(routes)
    expect(names).toEqual(expect.arrayContaining(["packet", "webhooks"]))
    expect(names).not.toContain("issue")
  })

  it("delivery runs only after a BOUND artifact and a released lease", () => {
    expect(sources.scheduling).toMatch(/workflowOutcome === "BOUND"/)
    expect(sources.scheduling).toMatch(/released === true/)
    // The adapter is injected, never imported by the orchestrator itself.
    expect(codeOnly(sources.orchestrator)).not.toContain("t2-resend-adapter")
  })

  it("the customer surface builds no URL that could carry the code", () => {
    for (const key of ["packetPage", "packetForm"] as const) {
      expect(sources[key]).not.toMatch(/searchParams|URLSearchParams|\?capability=|#/)
    }
  })

  it("the recovery route reuses the existing admin authentication and CSRF pattern", () => {
    const manualReview = read("app/api/admin/evidence/[orderId]/manual-review/route.ts")
    for (const fragment of [
      'getSession(request)',
      'user?.role !== "ADMIN"',
      'const origin = request.headers.get("origin")',
      'new URL(request.url).origin',
      'request.headers.get("content-type") !== "application/json"',
    ]) {
      expect(manualReview).toContain(fragment)
      expect(sources.recoveryRoute).toContain(fragment)
    }
  })

  it("the recovery route exposes no resend or regenerate action", () => {
    expect(sources.recoveryRoute).not.toMatch(/RESEND|REGENERATE|RETRY_DELIVERY/)
  })
})
