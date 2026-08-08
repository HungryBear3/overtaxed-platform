/** @jest-environment node */

import { readFileSync } from "fs"
import { join } from "path"
import { FULFILLMENT_STATUSES } from "@/lib/fulfillment/types"
import {
  ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES,
  decideEnterManualReview,
} from "@/lib/fulfillment/manual-review"

const allowed = [
  "NOT_STARTED",
  "NEEDS_RECONCILIATION",
  "INCOMPLETE_INPUT",
  "ARTIFACT_PENDING",
  "ARTIFACT_READY",
] as const

const eligible = (overrides: Record<string, unknown> = {}) => ({
  action: "ENTER_MANUAL_REVIEW",
  fulfillment: {
    status: "ARTIFACT_PENDING",
    statusRevision: 2,
    attemptCount: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    attemptRows: 0,
    eventRows: 0,
    ...overrides,
  },
})

describe("ENTER_MANUAL_REVIEW pure decision", () => {
  it.each(allowed)("allows %s and fixes target/reason", (status) => {
    const result = decideEnterManualReview(eligible({ status }))
    expect(result).toEqual({
      allowed: true,
      action: "ENTER_MANUAL_REVIEW",
      fromStatus: status,
      targetStatus: "MANUAL_REVIEW",
      reasonCode: "MANUAL_REVIEW",
      fromRevision: 2,
      toRevision: 3,
    })
  })

  it("exports exactly the five source statuses", () => {
    expect([...ALLOWED_MANUAL_REVIEW_SOURCE_STATUSES]).toEqual(allowed)
  })

  it.each(FULFILLMENT_STATUSES.filter((status) => !allowed.includes(status as never)))(
    "rejects source status %s",
    (status) => {
      expect(decideEnterManualReview(eligible({ status }))).toMatchObject({
        allowed: false,
        code: "INELIGIBLE_SOURCE_STATUS",
      })
    },
  )

  it.each([
    eligible({ status: "artifact_pending" }),
    eligible({ status: " ARTIFACT_PENDING" }),
    { ...eligible(), action: "enter_manual_review" },
    { ...eligible(), action: "ENTER_MANUAL_REVIEW " },
  ])("rejects unknown action/status without normalization", (input) => {
    expect(decideEnterManualReview(input)).toMatchObject({ allowed: false })
  })

  it.each([
    { leaseOwner: "worker", leaseToken: null, leaseExpiresAt: null },
    { leaseOwner: null, leaseToken: "token", leaseExpiresAt: null },
    { leaseOwner: null, leaseToken: null, leaseExpiresAt: "2026-08-01T00:00:00.000Z" },
    { leaseOwner: "worker", leaseToken: "token", leaseExpiresAt: "bad" },
  ])("rejects any active, stale, or malformed lease metadata", (lease) => {
    expect(decideEnterManualReview(eligible(lease))).toMatchObject({
      allowed: false,
      code: "LEASE_PRESENT",
    })
  })

  it.each([
    { attemptCount: 1 },
    { attemptRows: 1 },
    { eventRows: 1 },
  ])("rejects attempts/events", (evidence) => {
    expect(decideEnterManualReview(eligible(evidence))).toMatchObject({
      allowed: false,
      code: "DOWNSTREAM_EVIDENCE_PRESENT",
    })
  })

  it("rejects a missing fulfillment ledger", () => {
    expect(
      decideEnterManualReview({
        action: "ENTER_MANUAL_REVIEW",
        fulfillment: null,
      }),
    ).toEqual({ allowed: false, code: "NO_FULFILLMENT_SUMMARY" })
  })

  it.each([-1, 2_147_483_647, 2_147_483_648, 1.5, NaN, Infinity])(
    "rejects unsafe status revision %p",
    (statusRevision) => {
      expect(decideEnterManualReview(eligible({ statusRevision }))).toMatchObject({
        allowed: false,
        code: "INVALID_STATUS_REVISION",
      })
    },
  )

  it("has no IO or downstream imports", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/fulfillment/manual-review.ts"),
      "utf8",
    )
    const imports = source
      .split("\n")
      .filter((line) => /^import\s/.test(line))
      .join("\n")
      .toLowerCase()
    for (const forbidden of [
      "prisma",
      "auth",
      "provider",
      "email",
      "artifact",
      "packet",
      "checkout",
      "stripe",
    ]) {
      expect(imports).not.toContain(forbidden)
    }
    expect(source).not.toContain("process.env")
    expect(source).not.toContain("fetch(")
  })
})
