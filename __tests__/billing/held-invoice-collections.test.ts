/** @jest-environment node */

/**
 * Collections against a held product.
 *
 * The performance invoice is held. Its creation route, its cron, and its
 * payment route were all closed, and the "Pay Now" control was removed from
 * `/account`. `/api/cron/invoice-collections` was not: it ran daily, selected
 * every `PENDING` invoice past due, and mailed an escalating series of notices
 * — notice 1 at 7 days, then 14, 30, 45 — each carrying a "Pay Invoice" button
 * pointing at the page whose payment control had just been removed. On each
 * send it also incremented `collectionLettersSent` on the customer's row.
 *
 * So a customer holding a held invoice received a demand to pay for a product
 * that cannot be sold, followed it to a page with no way to pay, and was
 * escalated to a final notice for not paying. These tests hold that shut at the
 * real route, with the genuine `sendEmail` running and only the `resend` SDK
 * mocked, so a leak is a provider call rather than a silent pass.
 */

const resendSend = jest.fn(async (_payload: unknown) => ({ data: { id: "msg_test" }, error: null }))
const resendConstructor = jest.fn(function ResendMock(this: Record<string, unknown>) {
  this.emails = { send: resendSend }
})
jest.mock("resend", () => ({ __esModule: true, Resend: resendConstructor }))

const prismaMock = {
  invoice: { findMany: jest.fn(async () => [] as unknown[]), update: jest.fn(async () => ({})) },
}
jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))

import { NextRequest } from "next/server"

const CRON_SECRET = "cron-secret-for-tests"
const ROUTE_URL = "http://localhost/api/cron/invoice-collections"

function get(headers: Record<string, string> = {}) {
  return new NextRequest(ROUTE_URL, { method: "GET", headers })
}

async function runRoute(req: NextRequest) {
  const { GET } = await import("@/app/api/cron/invoice-collections/route")
  const res = await GET(req)
  return { res, json: await res.json() }
}

/** 60 days overdue and zero letters sent: notice 1 is unambiguously due. */
function overdueInvoice(invoiceType: string) {
  return {
    id: `inv_${invoiceType.toLowerCase()}`,
    invoiceNumber: `OT-${invoiceType}-0001`,
    invoiceType,
    amount: 412.5,
    dueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    collectionLettersSent: 0,
    user: { id: "usr_1", email: "customer@example.com", name: "Sam" },
  }
}

describe("/api/cron/invoice-collections", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.RESEND_API_KEY = "re_test_should_never_be_used"
    process.env.CRON_SECRET = CRON_SECRET
    process.env.NEXT_PUBLIC_APP_URL = "https://www.overtaxed-il.com"
  })

  it("fails closed when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const { res, json } = await runRoute(get())
    expect(res.status).toBe(401)
    expect(json).toEqual({ error: "Unauthorized" })
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
    expect(resendSend).not.toHaveBeenCalled()
  })

  it("fails closed on a wrong bearer token", async () => {
    const { res } = await runRoute(get({ authorization: "Bearer wrong" }))
    expect(res.status).toBe(401)
    expect(resendSend).not.toHaveBeenCalled()
  })

  it.each(["PERFORMANCE_FEE", "LATE_FEE", "COLLECTION_FEE"])(
    "sends no notice and writes nothing for a held %s invoice",
    async (invoiceType) => {
      prismaMock.invoice.findMany.mockResolvedValue([overdueInvoice(invoiceType)])
      const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))

      expect(json.noticesSent).toBe(0)
      expect(json.heldSuppressed).toBe(1)
      // No Resend construction call, no invoice mutation, no letter counter.
      expect(resendSend).not.toHaveBeenCalled()
      expect(prismaMock.invoice.update).not.toHaveBeenCalled()
    },
  )

  it("suppresses held rows without stopping the non-held ones", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      overdueInvoice("PERFORMANCE_FEE"),
      overdueInvoice("COMPS_ONLY"),
    ])
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))

    expect(json.heldSuppressed).toBe(1)
    expect(json.noticesSent).toBe(1)
    expect(resendSend).toHaveBeenCalledTimes(1)

    const payload = resendSend.mock.calls[0][0] as unknown as { subject: string }
    expect(payload.subject).toContain("OT-COMPS_ONLY-0001")
    // The held invoice's number appears in no message at all.
    const everything = JSON.stringify(resendSend.mock.calls)
    expect(everything).not.toContain("OT-PERFORMANCE_FEE-0001")
  })

  it("does not touch a held row even when it is deep into the escalation", async () => {
    // Three letters already out and 90 days overdue: the row the old code
    // would have escalated to the final notice.
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        ...overdueInvoice("PERFORMANCE_FEE"),
        collectionLettersSent: 3,
        dueDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    ])
    const { json } = await runRoute(get({ authorization: `Bearer ${CRON_SECRET}` }))
    expect(json.noticesSent).toBe(0)
    expect(json.heldSuppressed).toBe(1)
    expect(resendSend).not.toHaveBeenCalled()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })
})
