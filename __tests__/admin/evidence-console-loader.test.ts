/**
 * @jest-environment node
 *
 * Admin evidence console loader — auth boundaries + default-off DB isolation.
 * The loader must reject non-admins before any flag/DB access, and when the flag
 * is off it must return `disabled` WITHOUT querying any Phase 1 table.
 */

const getSessionMock = jest.fn()
const flagEnabledMock = jest.fn()
const controlFlagEnabledMock = jest.fn()
const orderFindUniqueMock = jest.fn()
const fulfillmentFindFirstMock = jest.fn()
const adminEventFindManyMock = jest.fn()

jest.mock("@/lib/auth/session", () => ({
  getSession: (...a: unknown[]) => getSessionMock(...a),
}))
jest.mock("@/lib/fulfillment/flag", () => ({
  t2EvidenceConsoleEnabled: (...a: unknown[]) => flagEnabledMock(...a),
  t2ManualReviewControlEnabled: (...a: unknown[]) => controlFlagEnabledMock(...a),
  OT_T2_EVIDENCE_CONSOLE_FLAG: "OT_T2_EVIDENCE_CONSOLE_ENABLED",
  OT_T2_MANUAL_REVIEW_CONTROL_FLAG: "OT_T2_MANUAL_REVIEW_CONTROL_ENABLED",
  OT_T2_FULFILLMENT_EVIDENCE_FLAG: "OT_T2_FULFILLMENT_EVIDENCE_ENABLED",
}))
jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: { findUnique: (...a: unknown[]) => orderFindUniqueMock(...a) },
    oTFulfillment: { findFirst: (...a: unknown[]) => fulfillmentFindFirstMock(...a) },
    oTFulfillmentAdminEvent: { findMany: (...a: unknown[]) => adminEventFindManyMock(...a) },
  },
}))

import { loadAdminEvidenceView } from "@/lib/admin/evidence-loader"
import { computePropertyBindingFingerprint } from "@/lib/fulfillment/artifact-digest"

const NOW = "2026-08-08T12:00:00.000Z"

beforeEach(() => {
  jest.clearAllMocks()
  getSessionMock.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } })
  flagEnabledMock.mockReturnValue(true)
  controlFlagEnabledMock.mockReturnValue(true)
  orderFindUniqueMock.mockResolvedValue({
    id: "ord_1",
    tier: "T2",
    status: "PAID",
    amountPaid: 149,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  })
  fulfillmentFindFirstMock.mockResolvedValue(null)
  adminEventFindManyMock.mockResolvedValue([])
})

describe("auth boundary", () => {
  it("rejects a null session before touching the flag or database", async () => {
    getSessionMock.mockResolvedValue(null)
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(r.kind).toBe("unauthorized")
    expect(flagEnabledMock).not.toHaveBeenCalled()
    expect(orderFindUniqueMock).not.toHaveBeenCalled()
    expect(fulfillmentFindFirstMock).not.toHaveBeenCalled()
  })

  it("rejects a non-admin (USER) role before touching the flag or database", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "u2", role: "USER" } })
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(r.kind).toBe("unauthorized")
    expect(flagEnabledMock).not.toHaveBeenCalled()
    expect(orderFindUniqueMock).not.toHaveBeenCalled()
  })
})

describe("default-off isolation", () => {
  it("returns disabled and performs ZERO Phase 1 database queries when the flag is off", async () => {
    flagEnabledMock.mockReturnValue(false)
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(r.kind).toBe("disabled")
    expect(orderFindUniqueMock).not.toHaveBeenCalled()
    expect(fulfillmentFindFirstMock).not.toHaveBeenCalled()
  })
})

describe("enabled admin reads", () => {
  it("returns not_found when the order does not exist", async () => {
    orderFindUniqueMock.mockResolvedValue(null)
    const r = await loadAdminEvidenceView("missing", { now: NOW })
    expect(r.kind).toBe("not_found")
    expect(fulfillmentFindFirstMock).not.toHaveBeenCalled()
  })

  it("derives a RECONCILIATION_NEEDED view for a paid order with no fulfillment", async () => {
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") throw new Error("expected ok")
    expect(r.view.hasFulfillment).toBe(false)
    expect(r.view.summary.displayState).toBe("RECONCILIATION_NEEDED")
  })

  it("selects leaseToken only for authoritative eligibility, but no locator or idempotency key", async () => {
    await loadAdminEvidenceView("ord_1", { now: NOW })
    const arg = fulfillmentFindFirstMock.mock.calls[0]?.[0]
    const selectJson = JSON.stringify(arg?.select ?? {})
    expect(selectJson).not.toContain("storageLocator")
    expect(selectJson).toContain("leaseToken")
    expect(selectJson).not.toContain("idempotencyKey")
  })

  it("derives DELIVERED from a full record and redacts secrets", async () => {
    fulfillmentFindFirstMock.mockResolvedValue({
      id: "ful_1",
      kind: "T2_APPEAL_EVIDENCE",
      status: "DELIVERED",
      statusRevision: 4,
      attemptCount: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastReasonCode: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      artifacts: [
        {
          version: 1,
          artifactSha256: "a".repeat(64),
          byteSize: 2048,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          createdAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ],
      attempts: [
        {
          attemptNumber: 1,
          artifactVersion: 1,
          provider: "resend",
          providerMessageId: "re_RAWID_XYZ",
          requestedAt: new Date("2026-08-03T00:00:00.000Z"),
          providerAcceptedAt: new Date("2026-08-03T00:00:01.000Z"),
          deliveredAt: new Date("2026-08-03T00:00:05.000Z"),
          delayedAt: null,
          failedAt: null,
          reasonCode: null,
          createdAt: new Date("2026-08-03T00:00:00.000Z"),
        },
      ],
      events: [
        { provider: "resend", providerEventId: "evt_1", eventType: "ACCEPTED", sequence: 1, occurredAt: new Date("2026-08-03T00:00:01.000Z"), reasonCode: null, attemptNumber: 1, receivedAt: new Date("2026-08-03T00:00:02.000Z") },
        { provider: "resend", providerEventId: "evt_2", eventType: "DELIVERED", sequence: 2, occurredAt: new Date("2026-08-03T00:00:05.000Z"), reasonCode: null, attemptNumber: 1, receivedAt: new Date("2026-08-03T00:00:06.000Z") },
      ],
    })
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(r.kind).toBe("ok")
    if (r.kind !== "ok") throw new Error("expected ok")
    expect(r.view.summary.displayState).toBe("DELIVERED")
    expect(JSON.stringify(r.view)).not.toContain("re_RAWID_XYZ")
    expect(r.view.attempts[0]?.providerMessageIdMasked).toBe("re_•••YZ")
  })

  it("requires the separate control flag and derives an authoritative capability", async () => {
    fulfillmentFindFirstMock.mockResolvedValue({
      id: "ful_eligible", kind: "T2_APPEAL_EVIDENCE", status: "ARTIFACT_PENDING",
      statusRevision: 2, attemptCount: 0, leaseOwner: null, leaseToken: null,
      leaseExpiresAt: null, lastReasonCode: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"), artifacts: [], attempts: [], events: [],
    })
    const result = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.manualReviewControlEnabled).toBe(true)
    expect(result.manualReviewCapability).toEqual({
      eligible: true, status: "ARTIFACT_PENDING", statusRevision: 2, reason: null,
    })

    controlFlagEnabledMock.mockReturnValue(false)
    const disabled = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(disabled.kind).toBe("ok")
    if (disabled.kind !== "ok") throw new Error("expected ok")
    expect(disabled.manualReviewControlEnabled).toBe(false)
  })

  it("keeps paid/no-ledger reconciliation behavior and no enabled control", async () => {
    const result = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.view.summary.displayState).toBe("RECONCILIATION_NEEDED")
    expect(result.manualReviewCapability).toEqual({
      eligible: false, status: null, statusRevision: null, reason: "NO_FULFILLMENT_SUMMARY",
    })
  })

  it("fetches admin history separately and masks the actor", async () => {
    fulfillmentFindFirstMock.mockResolvedValue({
      id: "ful_1", kind: "T2_APPEAL_EVIDENCE", status: "MANUAL_REVIEW",
      statusRevision: 3, attemptCount: 0, leaseOwner: null, leaseToken: null,
      leaseExpiresAt: null, lastReasonCode: "MANUAL_REVIEW",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"), artifacts: [], attempts: [], events: [],
    })
    adminEventFindManyMock.mockResolvedValue([{
      action: "ENTER_MANUAL_REVIEW", fromStatus: "ARTIFACT_PENDING", toStatus: "MANUAL_REVIEW",
      fromRevision: 2, toRevision: 3, actorUserId: "admin_RAW_SECRET_99",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    }])
    const result = await loadAdminEvidenceView("ord_1", { now: NOW })
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") throw new Error("expected ok")
    expect(result.adminEvents).toEqual([{
      action: "ENTER_MANUAL_REVIEW", fromStatus: "ARTIFACT_PENDING", toStatus: "MANUAL_REVIEW",
      fromRevision: 2, toRevision: 3, actorMasked: "adm•••99",
      createdAt: "2026-08-02T00:00:00.000Z",
    }])
    expect(JSON.stringify(result)).not.toContain("admin_RAW_SECRET_99")
  })
})

/**
 * Phase 2 Slice 2 — the property binding is AUTHENTICATED at this boundary.
 *
 * The reviewed version reduced any nonempty fingerprint to `true`, so a
 * well-formed fingerprint computed for a completely different property read as
 * agreement. The loader now recomputes the expected fingerprint from the current
 * authoritative order and passes only the bounded comparison result inward.
 */
describe("Slice 2 — property-binding authentication at the loader boundary", () => {
  const PIN = "09000000000000"
  const ADDRESS = "123 Main St"
  const GENERATED_AT = new Date("2026-08-02T00:00:00.000Z")

  const MATCHING = computePropertyBindingFingerprint({
    orderId: "ord_1",
    propertyPin: PIN,
    propertyAddress: ADDRESS,
  })
  const OTHER_PROPERTY = computePropertyBindingFingerprint({
    orderId: "ord_1",
    propertyPin: "09000000000001",
    propertyAddress: "999 Elsewhere Ave",
  })

  const order = (overrides: Record<string, unknown> = {}) => ({
    id: "ord_1",
    tier: "T2",
    status: "PAID",
    amountPaid: 149,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    propertyPin: PIN,
    propertyAddress: ADDRESS,
    ...overrides,
  })

  const withArtifact = (fingerprint: string | null) => ({
    id: "ful_1",
    kind: "T2_APPEAL_EVIDENCE",
    status: "ARTIFACT_READY",
    statusRevision: 2,
    attemptCount: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastReasonCode: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    artifacts: [
      {
        version: 1,
        artifactSha256: "a".repeat(64),
        byteSize: 2048,
        generatorVersion: "gen_v1",
        templateVersion: "tpl_v1",
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        generatedAt: GENERATED_AT,
        sourceOrderId: "ord_1",
        propertyBindingFingerprint: fingerprint,
      },
    ],
    attempts: [],
    events: [],
  })

  beforeEach(() => {
    orderFindUniqueMock.mockResolvedValue(order())
  })

  async function load() {
    const r = await loadAdminEvidenceView("ord_1", { now: NOW })
    if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`)
    return r
  }

  it("selects the authoritative property inputs needed to recompute the fingerprint", async () => {
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(MATCHING))
    await load()
    const select = JSON.stringify(orderFindUniqueMock.mock.calls[0]?.[0]?.select ?? {})
    expect(select).toContain("propertyPin")
    expect(select).toContain("propertyAddress")
  })

  it("reports MATCHES and does not taint when the binding describes this order", async () => {
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(MATCHING))
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("MATCHES")
    expect(r.view.conflicted).toBe(false)
    expect(r.view.artifact.provenance).toBe("RECORDED")
  })

  it("reports DRIFTED and fails closed for a fingerprint of a different property", async () => {
    // The reviewed version reported this as `propertyBindingRecorded: true`.
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(OTHER_PROPERTY))
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("DRIFTED")
    expect(r.view.conflicted).toBe(true)
    expect(r.view.summary.displayState).toBe("MANUAL_REVIEW")
    expect(r.view.warnings.map((w) => w.code)).toContain(
      "ARTIFACT_PROPERTY_BINDING_UNTRUSTED",
    )
    for (const a of r.view.actions) {
      if (a.action !== "INSPECT") expect(a.wouldBeEligible).toBe(false)
    }
  })

  it("reports DRIFTED when the order's property has since changed", async () => {
    orderFindUniqueMock.mockResolvedValue(order({ propertyAddress: "77 New Address Rd" }))
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(MATCHING))
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("DRIFTED")
    expect(r.view.conflicted).toBe(true)
  })

  it("reports MALFORMED and fails closed for a present-but-invalid fingerprint", async () => {
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact("not-a-fingerprint"))
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("MALFORMED")
    expect(r.view.conflicted).toBe(true)
    expect(JSON.stringify(r.view)).not.toContain("not-a-fingerprint")
  })

  it("reports UNVERIFIABLE and fails closed when the current order lacks property inputs", async () => {
    orderFindUniqueMock.mockResolvedValue(order({ propertyPin: null }))
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(MATCHING))
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("UNVERIFIABLE")
    expect(r.view.conflicted).toBe(true)
    expect(r.view.summary.displayState).toBe("MANUAL_REVIEW")
  })

  it("keeps a legacy pre-Slice-2 row silent, distinguishable, and non-tainting", async () => {
    const legacy = withArtifact(null)
    legacy.artifacts[0]!.generatedAt = null as unknown as Date
    legacy.artifacts[0]!.sourceOrderId = null as unknown as string
    fulfillmentFindFirstMock.mockResolvedValue(legacy)
    const r = await load()
    expect(r.view.artifact.propertyBinding).toBe("ABSENT")
    expect(r.view.artifact.provenance).toBe("ABSENT")
    expect(r.view.conflicted).toBe(false)
    expect(r.view.warnings.map((w) => w.code)).not.toContain(
      "ARTIFACT_PROPERTY_BINDING_UNTRUSTED",
    )
  })

  it.each([
    ["matching", MATCHING],
    ["drifted", OTHER_PROPERTY],
  ])("never surfaces the PIN, address, or %s fingerprint", async (_label, fingerprint) => {
    fulfillmentFindFirstMock.mockResolvedValue(withArtifact(fingerprint))
    const r = await load()
    const json = JSON.stringify(r)
    expect(json).not.toContain(fingerprint)
    expect(json).not.toContain(MATCHING)
    expect(json).not.toContain(PIN)
    expect(json).not.toContain(ADDRESS)
    expect(json).not.toContain("propertyBindingFingerprint")
    expect(json).not.toContain("propertyPin")
    expect(json).not.toContain("propertyAddress")
  })
})
