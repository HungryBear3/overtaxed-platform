/**
 * @jest-environment node
 *
 * Admin evidence console loader — auth boundaries + default-off DB isolation.
 * The loader must reject non-admins before any flag/DB access, and when the flag
 * is off it must return `disabled` WITHOUT querying any Phase 1 table.
 */

const getSessionMock = jest.fn()
const flagEnabledMock = jest.fn()
const orderFindUniqueMock = jest.fn()
const fulfillmentFindFirstMock = jest.fn()

jest.mock("@/lib/auth/session", () => ({
  getSession: (...a: unknown[]) => getSessionMock(...a),
}))
jest.mock("@/lib/fulfillment/flag", () => ({
  t2EvidenceConsoleEnabled: (...a: unknown[]) => flagEnabledMock(...a),
  OT_T2_EVIDENCE_CONSOLE_FLAG: "OT_T2_EVIDENCE_CONSOLE_ENABLED",
  OT_T2_FULFILLMENT_EVIDENCE_FLAG: "OT_T2_FULFILLMENT_EVIDENCE_ENABLED",
}))
jest.mock("@/lib/db", () => ({
  prisma: {
    oTOrder: { findUnique: (...a: unknown[]) => orderFindUniqueMock(...a) },
    oTFulfillment: { findFirst: (...a: unknown[]) => fulfillmentFindFirstMock(...a) },
  },
}))

import { loadAdminEvidenceView } from "@/lib/admin/evidence-loader"

const NOW = "2026-08-08T12:00:00.000Z"

beforeEach(() => {
  jest.clearAllMocks()
  getSessionMock.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } })
  flagEnabledMock.mockReturnValue(true)
  orderFindUniqueMock.mockResolvedValue({
    id: "ord_1",
    tier: "T2",
    status: "PAID",
    amountPaid: 149,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  })
  fulfillmentFindFirstMock.mockResolvedValue(null)
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

  it("does NOT select storageLocator, leaseToken, or idempotencyKey from the database", async () => {
    await loadAdminEvidenceView("ord_1", { now: NOW })
    const arg = fulfillmentFindFirstMock.mock.calls[0]?.[0]
    const selectJson = JSON.stringify(arg?.select ?? {})
    expect(selectJson).not.toContain("storageLocator")
    expect(selectJson).not.toContain("leaseToken")
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
})
