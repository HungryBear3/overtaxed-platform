/**
 * Webhook idempotency around the DIY Pro packet-generation trigger.
 *
 * Two guards cooperate:
 *   1. StripeEvent dedup (at webhook handler top) — blocks the same event.id from
 *      being processed twice.
 *   2. Inside generatePacketForInvoice, packetStatus=READY|DELIVERED short-circuits
 *      even if a different event ID also lands.
 *
 * This test focuses on guard #2 — the orchestrator itself.
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
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string; packetStatus?: { in: string[] } }
          data: Record<string, unknown>
        }) => {
          const inv = mockDb.invoicesById.get(where.id) as { status?: string; packetStatus?: string } | undefined
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
        async ({ where }: { where: { id?: string; userId?: string; propertyId?: string } }) => {
          if (!where.id) return null
          const a = mockDb.appeals.get(where.id) as { userId?: string; propertyId?: string } | undefined
          if (!a) return null
          if (where.userId && a.userId !== where.userId) return null
          if (where.propertyId && a.propertyId !== where.propertyId) return null
          return a
        },
      ),
    },
  },
}))

const putMock = jest.fn(async (pathname: string) => ({ url: `https://blob.example.com/${pathname}` }))
jest.mock("@vercel/blob", () => ({ put: (...args: unknown[]) => putMock(...args) }))

const pdfMock = jest.fn(async () => new Uint8Array([37, 80, 68, 70]))
jest.mock("@/lib/document-generation/appeal-summary", () => ({
  generateAppealSummaryPdf: (...args: unknown[]) => pdfMock(...args),
}))

const buildInputsMock = jest.fn()
jest.mock("@/lib/packet/build-packet-inputs", () => ({
  buildPacketInputs: (...args: unknown[]) => buildInputsMock(...args),
}))

jest.mock("@/lib/email/send", () => ({
  sendPacketReadyEmail: jest.fn(async () => true),
  sendPacketManualReviewAlert: jest.fn(async () => true),
  sendPacketFailureAlert: jest.fn(async () => true),
}))

import { generatePacketForInvoice } from "@/lib/packet/generate-and-deliver"

function seedReady() {
  mockDb.invoicesById.clear()
  mockDb.updates.length = 0
  mockDb.appeals.clear()
  mockDb.invoicesById.set("inv_idemp", {
    id: "inv_idemp",
    userId: "user_x",
    status: "PAID",
    invoiceType: "COMPS_ONLY",
    propertyId: null,
    packetStatus: "NOT_STARTED",
    packetAppealId: "appeal_x",
    user: { email: "alice@example.com" },
  })
  mockDb.appeals.set("appeal_x", {
    id: "appeal_x",
    taxYear: 2025,
    userId: "user_x",
    propertyId: null,
    property: { pin: "11111111111111" },
    compsUsed: [],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.BLOB_READ_WRITE_TOKEN = "test"
  buildInputsMock.mockResolvedValue({
    data: { stub: true },
    diagnostics: { compCount: 5, requestedAssessmentValue: 300_000, hasSubjectEnrichment: true },
  })
})

describe("packet generation idempotency", () => {
  it("duplicate invocations generate the PDF only once", async () => {
    seedReady()
    const r1 = await generatePacketForInvoice("inv_idemp")
    const r2 = await generatePacketForInvoice("inv_idemp")
    const r3 = await generatePacketForInvoice("inv_idemp")

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r3.ok).toBe(true)

    // PDF only produced once; subsequent calls SKIP
    expect(pdfMock).toHaveBeenCalledTimes(1)
    expect(putMock).toHaveBeenCalledTimes(1)

    if (r2.ok && r2.status !== "DELIVERED" && r2.status !== "READY") {
      expect(r2.status).toBe("SKIPPED")
    }
  })

  it("unpaid → paid flip is required before generation runs", async () => {
    seedReady()
    const inv = mockDb.invoicesById.get("inv_idemp")!
    inv.status = "PENDING"

    const first = await generatePacketForInvoice("inv_idemp")
    expect(first.ok).toBe(false)
    expect(pdfMock).not.toHaveBeenCalled()

    inv.status = "PAID"
    const second = await generatePacketForInvoice("inv_idemp")
    expect(second.ok).toBe(true)
    expect(pdfMock).toHaveBeenCalledTimes(1)
  })
})
