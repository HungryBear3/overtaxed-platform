/**
 * Packet delivery-email builders — verify the link is always included and
 * attachment is only used when bytes are present.
 */

// Mock Resend at the transport layer so the real send.ts code path runs and
// we can assert the exact payload the helpers build.
const resendSendMock = jest.fn(async () => ({ data: { id: "rs_1" }, error: null }))
jest.mock("@/lib/email/resend", () => ({
  resend: { emails: { send: (args: unknown) => resendSendMock(args) } },
  FROM_EMAIL: "from@example.com",
}))

import { sendPacketReadyEmail, sendPacketManualReviewAlert, sendPacketFailureAlert } from "@/lib/email/send"

const sendEmailMock = resendSendMock

beforeEach(() => {
  resendSendMock.mockClear()
})

describe("sendPacketReadyEmail", () => {
  it("always includes the download link in text + html", async () => {
    await sendPacketReadyEmail("u@example.com", {
      downloadUrl: "https://app.example.com/account/packets/inv_1",
      invoiceId: "inv_1",
      pdfBytes: null,
      filename: "packet.pdf",
    })
    const arg = sendEmailMock.mock.calls[0]?.[0] as { text: string; html: string; attachments?: unknown }
    expect(arg.text).toContain("https://app.example.com/account/packets/inv_1")
    expect(arg.html).toContain("https://app.example.com/account/packets/inv_1")
    expect(arg.attachments).toBeUndefined()
  })

  it("attaches when pdfBytes are provided", async () => {
    const bytes = Buffer.from("%PDF-1.4 fake")
    await sendPacketReadyEmail("u@example.com", {
      downloadUrl: "https://app.example.com/account/packets/inv_2",
      invoiceId: "inv_2",
      pdfBytes: bytes,
      filename: "packet.pdf",
    })
    const arg = sendEmailMock.mock.calls[0]?.[0] as { attachments?: Array<{ filename: string; content: Buffer }> }
    expect(arg.attachments).toHaveLength(1)
    expect(arg.attachments?.[0]?.filename).toBe("packet.pdf")
    expect(arg.attachments?.[0]?.content).toBeInstanceOf(Buffer)
  })
})

describe("operator alerts", () => {
  it("manual review alert goes to support and names the invoice + reason", async () => {
    await sendPacketManualReviewAlert("u@example.com", "inv_weak", "Only 1 comparable available")
    const arg = sendEmailMock.mock.calls[0]?.[0] as { to: string; subject: string; text: string }
    expect(arg.to).toBe("support@overtaxed-il.com")
    expect(arg.subject).toMatch(/MANUAL REVIEW/)
    expect(arg.text).toContain("inv_weak")
    expect(arg.text).toContain("Only 1 comparable available")
  })

  it("failure alert goes to support with the error", async () => {
    await sendPacketFailureAlert("u@example.com", "inv_err", "Realie 500 timeout")
    const arg = sendEmailMock.mock.calls[0]?.[0] as { to: string; subject: string; text: string }
    expect(arg.to).toBe("support@overtaxed-il.com")
    expect(arg.subject).toMatch(/FAILED/)
    expect(arg.text).toContain("Realie 500 timeout")
  })
})
