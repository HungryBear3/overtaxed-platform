/**
 * generatePacketForInvoice — the shared packet engine orchestrator.
 *
 * These tests stub prisma, Vercel Blob, the Realie/maps data assembler, and email.
 * The orchestrator is the fulcrum: payment gate, idempotency guards, weak-data
 * MANUAL_REVIEW, generation failure → FAILED. Exercising these branches here
 * is cheaper and more reliable than a live DB test.
 */

type MockInvoice = {
  id: string
  userId: string
  status: string
  invoiceType: string
  propertyId: string | null
  packetStatus: string
  packetAppealId: string | null
  user: { email: string | null }
}

const mockDb: {
  invoicesById: Map<string, MockInvoice>
  updates: Array<{ id: string; data: Record<string, unknown> }>
  appeals: Map<string, unknown>
} = { invoicesById: new Map(), updates: [], appeals: new Map() }

jest.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => mockDb.invoicesById.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const inv = mockDb.invoicesById.get(where.id)
        if (!inv) throw new Error("invoice not found")
        Object.assign(inv, data)
        mockDb.updates.push({ id: where.id, data })
        return inv
      }),
      // Atomic-claim helper: only the first caller observing an in-set status wins.
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string; packetStatus?: { in: string[] } }
          data: Record<string, unknown>
        }) => {
          const inv = mockDb.invoicesById.get(where.id)
          if (!inv) return { count: 0 }
          if (where.status && inv.status !== where.status) return { count: 0 }
          if (where.packetStatus?.in && !where.packetStatus.in.includes(String(inv.packetStatus))) {
            return { count: 0 }
          }
          Object.assign(inv, data)
          mockDb.updates.push({ id: where.id, data })
          return { count: 1 }
        },
      ),
    },
    appeal: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; userId?: string; propertyId?: string }
        }) => {
          if (!where.id) return null
          const a = mockDb.appeals.get(where.id) as { userId?: string; propertyId?: string; property?: unknown } | undefined
          if (!a) return null
          if (where.userId && a.userId !== where.userId) return null
          if (where.propertyId && a.propertyId !== where.propertyId) return null
          return a
        },
      ),
    },
  },
}))

// Vercel Blob put — deterministic fake URL
jest.mock("@vercel/blob", () => ({
  put: jest.fn(async (pathname: string) => ({ url: `https://blob.example.com/${pathname}` })),
}))

// Packet input assembler — spy so tests can control comp count / requested value
const buildInputsMock = jest.fn()
jest.mock("@/lib/packet/build-packet-inputs", () => ({
  buildPacketInputs: (...args: unknown[]) => buildInputsMock(...args),
}))

// PDF generator — return fixed tiny bytes
jest.mock("@/lib/document-generation/appeal-summary", () => ({
  generateAppealSummaryPdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])), // "%PDF"
}))

// Email helpers — observe calls
const sendReadyMock = jest.fn(async () => true)
const sendManualReviewMock = jest.fn(async () => true)
const sendFailureMock = jest.fn(async () => true)
jest.mock("@/lib/email/send", () => ({
  sendPacketReadyEmail: (...args: unknown[]) => sendReadyMock(...args),
  sendPacketManualReviewAlert: (...args: unknown[]) => sendManualReviewMock(...args),
  sendPacketFailureAlert: (...args: unknown[]) => sendFailureMock(...args),
}))

import { generatePacketForInvoice } from "@/lib/packet/generate-and-deliver"

function seed(overrides: Partial<MockInvoice> = {}, appeal: Record<string, unknown> | null = defaultAppeal()) {
  mockDb.invoicesById.clear()
  mockDb.updates.length = 0
  mockDb.appeals.clear()
  const inv: MockInvoice = {
    id: "inv_1",
    userId: "user_1",
    status: "PAID",
    invoiceType: "COMPS_ONLY",
    propertyId: null,
    packetStatus: "NOT_STARTED",
    packetAppealId: "appeal_1",
    user: { email: "owner@example.com" },
    ...overrides,
  }
  mockDb.invoicesById.set(inv.id, inv)
  if (appeal) mockDb.appeals.set("appeal_1", appeal)
}

function defaultAppeal() {
  return {
    id: "appeal_1",
    taxYear: 2025,
    userId: "user_1",
    propertyId: "prop_1",
    property: { pin: "12345678901234" },
    compsUsed: [],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token"
  buildInputsMock.mockReset()
})

describe("generatePacketForInvoice — payment gate", () => {
  it("refuses to run on an unpaid invoice", async () => {
    seed({ status: "PENDING" })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe("FAILED")
    expect(buildInputsMock).not.toHaveBeenCalled()
  })
})

describe("generatePacketForInvoice — idempotency", () => {
  it("skips when already READY", async () => {
    seed({ packetStatus: "READY" })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("SKIPPED")
    expect(buildInputsMock).not.toHaveBeenCalled()
  })

  it("skips when already DELIVERED (second webhook fires)", async () => {
    seed({ packetStatus: "DELIVERED" })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("SKIPPED")
  })

  it("marks GENERATING before doing work (visible to concurrent webhook retries)", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    await generatePacketForInvoice("inv_1")
    const generatingUpdate = mockDb.updates.find((u) => u.data.packetStatus === "GENERATING")
    expect(generatingUpdate).toBeTruthy()
  })
})

describe("generatePacketForInvoice — weak data (MANUAL_REVIEW, not fake success)", () => {
  it("goes to MANUAL_REVIEW when fewer than 3 comps", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 2, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe("MANUAL_REVIEW")
      expect(r.reason).toMatch(/minimum 3/i)
    }
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("MANUAL_REVIEW")
    expect(sendManualReviewMock).toHaveBeenCalledWith("owner@example.com", "inv_1", expect.any(String))
    expect(sendReadyMock).not.toHaveBeenCalled()
  })

  it("goes to MANUAL_REVIEW when requestedAssessmentValue is missing", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: null, hasSubjectEnrichment: true },
    })
    const r = await generatePacketForInvoice("inv_1")
    if (!r.ok) expect(r.status).toBe("MANUAL_REVIEW")
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("MANUAL_REVIEW")
    expect(final?.packetLastError).toMatch(/requested assessed value/i)
  })

  it("goes to MANUAL_REVIEW when no appeal can be resolved", async () => {
    seed({ packetAppealId: null, propertyId: null })
    const r = await generatePacketForInvoice("inv_1")
    if (!r.ok) expect(r.status).toBe("MANUAL_REVIEW")
    expect(buildInputsMock).not.toHaveBeenCalled()
  })
})

describe("generatePacketForInvoice — happy path", () => {
  it("produces READY or DELIVERED with a pdfUrl when data is strong", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    sendReadyMock.mockResolvedValueOnce(true)

    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(true)
    if (r.ok && r.status !== "SKIPPED") {
      expect(["READY", "DELIVERED"]).toContain(r.status)
      // Default storage mode is 'private' — pdfUrl is intentionally null.
      // (See lib/packet/storage.ts: in private mode the URL is never surfaced.)
      expect(r.pdfUrl).toBeNull()
    }
    const final = mockDb.invoicesById.get("inv_1")
    expect(["READY", "DELIVERED"]).toContain(final?.packetStatus)
    expect(sendReadyMock).toHaveBeenCalledTimes(1)
  })

  it("attaches the PDF when it's under 5 MB", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 4, requestedAssessmentValue: 250_000, hasSubjectEnrichment: true },
    })
    await generatePacketForInvoice("inv_1")
    expect(sendReadyMock).toHaveBeenCalled()
    const args = sendReadyMock.mock.calls[0]?.[1] as { pdfBytes: Buffer | null } | undefined
    expect(args?.pdfBytes).toBeInstanceOf(Buffer)
  })

  it("falls back to READY (not DELIVERED) when email fails but PDF succeeded", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 3, requestedAssessmentValue: 200_000, hasSubjectEnrichment: true },
    })
    sendReadyMock.mockResolvedValueOnce(false)
    const r = await generatePacketForInvoice("inv_1")
    if (r.ok && r.status !== "SKIPPED") expect(r.status).toBe("READY")
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("READY") // not DELIVERED because email did not succeed
  })
})

describe("generatePacketForInvoice — generation error", () => {
  it("marks FAILED and alerts support when buildPacketInputs throws", async () => {
    seed()
    buildInputsMock.mockRejectedValue(new Error("Realie timeout"))
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe("FAILED")
      expect(r.error).toMatch(/Realie timeout/)
    }
    expect(sendFailureMock).toHaveBeenCalledWith("owner@example.com", "inv_1", expect.stringMatching(/Realie timeout/))
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("FAILED")
  })

  it("marks FAILED when BLOB_READ_WRITE_TOKEN is missing (fails closed)", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe("FAILED")
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("FAILED")
    expect(final?.packetLastError).toMatch(/BLOB_READ_WRITE_TOKEN/)
  })
})

describe("generatePacketForInvoice — ownership enforcement", () => {
  it("rejects an appeal whose userId does not match invoice.userId → MANUAL_REVIEW", async () => {
    seed({}, { id: "appeal_1", taxYear: 2025, userId: "user_FOREIGN", propertyId: "prop_1", property: { pin: "x" }, compsUsed: [] })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe("MANUAL_REVIEW")
    const final = mockDb.invoicesById.get("inv_1")
    expect(final?.packetStatus).toBe("MANUAL_REVIEW")
    expect(final?.packetLastError).toMatch(/not owned/i)
  })

  it("rejects an appeal whose propertyId does not match invoice.propertyId → MANUAL_REVIEW", async () => {
    seed(
      { propertyId: "prop_1", packetAppealId: "appeal_1" },
      { id: "appeal_1", taxYear: 2025, userId: "user_1", propertyId: "prop_OTHER", property: { pin: "x" }, compsUsed: [] },
    )
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe("MANUAL_REVIEW")
  })
})

describe("generatePacketForInvoice — atomic claim / concurrency", () => {
  it("only one concurrent caller transitions NOT_STARTED → GENERATING; others SKIP", async () => {
    seed()
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    const [a, b] = await Promise.all([
      generatePacketForInvoice("inv_1"),
      generatePacketForInvoice("inv_1"),
    ])
    const statuses = [a, b].map((r) => (r.ok ? r.status : "FAIL"))
    // Exactly one should win (READY/DELIVERED), the other must SKIP.
    expect(statuses.sort()).toEqual(["DELIVERED", "SKIPPED"].sort())
    // Build/PDF only ran once.
    expect(buildInputsMock).toHaveBeenCalledTimes(1)
  })

  it("already-READY invoice short-circuits subsequent calls without claiming again", async () => {
    seed({ packetStatus: "READY" })
    buildInputsMock.mockResolvedValue({
      data: { stub: true },
      diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
    })
    const r = await generatePacketForInvoice("inv_1")
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe("SKIPPED")
    expect(buildInputsMock).not.toHaveBeenCalled()
  })
})
