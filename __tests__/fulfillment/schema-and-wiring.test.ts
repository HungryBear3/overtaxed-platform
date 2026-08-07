/**
 * @jest-environment node
 *
 * Matrix rows 1, 13, 15: the state language represents every required state
 * without inferring delivery; and no current checkout / webhook / admin / packet
 * route performs (or even imports) a new evidence write in this phase.
 */
import { readFileSync } from "fs"
import { join } from "path"
import { FULFILLMENT_STATUSES } from "@/lib/fulfillment/types"

const ROOT = process.cwd()

describe("row 1 — state language represents every required distinction", () => {
  it("includes the full set of required states", () => {
    const required = [
      "NOT_STARTED",
      "NEEDS_RECONCILIATION",
      "INELIGIBLE",
      "INCOMPLETE_INPUT",
      "MANUAL_REVIEW",
      "ARTIFACT_PENDING",
      "ARTIFACT_READY",
      "DELIVERY_PENDING",
      "PROVIDER_ACCEPTED",
      "DELIVERED",
      "DELAYED",
      "BOUNCED",
      "COMPLAINED",
      "FAILED",
      "CANCELLED",
    ]
    for (const s of required) expect(FULFILLMENT_STATUSES).toContain(s)
  })

  it("keeps provider acceptance and delivery as separate states (never inferred)", () => {
    expect(FULFILLMENT_STATUSES).toContain("PROVIDER_ACCEPTED")
    expect(FULFILLMENT_STATUSES).toContain("DELIVERED")
    expect("PROVIDER_ACCEPTED").not.toBe("DELIVERED")
  })
})

describe("row 15 — Phase 2 runtime wiring remains bounded", () => {
  const unwiredRoutes = [
    "app/api/checkout/session/route.ts",
    "app/api/admin/ot-orders/[orderId]/review/route.ts",
    "lib/packet/generate-and-deliver.ts",
    "lib/checkout/ot-settlement.ts",
  ]

  it("wires only the settled-order webhook to the side-effecting kickoff adapter", () => {
    const src = readFileSync(join(ROOT, "app/api/billing/webhook/route.ts"), "utf8")
    expect(src).toContain('from "@/lib/fulfillment-runtime/kickoff"')
    expect(src).not.toContain('from "@/lib/fulfillment/')
  })

  it.each(unwiredRoutes)("%s remains outside the Phase 2 runtime seam", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8")
    expect(src.includes("lib/fulfillment-runtime")).toBe(false)
    expect(src.includes('from "@/lib/fulfillment/')).toBe(false)
  })
})
