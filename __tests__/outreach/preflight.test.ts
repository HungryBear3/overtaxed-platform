/** Send-time preflight: every gate returns a correct allow/reject. */

const campaigns = new Map<string, { id: string; status: string }>()
const suppressions: Array<{ emailLowercase: string; campaignId: string | null }> = []

jest.mock("@/lib/db", () => ({
  prisma: {
    outreachCampaign: {
      findUnique: jest.fn(async ({ where }: any) => campaigns.get(where.id) ?? null),
    },
    outreachSuppression: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          suppressions.find(
            (s) =>
              s.emailLowercase === where.emailLowercase &&
              (where.OR
                ? where.OR.some(
                    (clause: any) => (clause.campaignId ?? null) === (s.campaignId ?? null),
                  )
                : true),
          ) ?? null
        )
      }),
    },
  },
}))

import { preflightBeforeSend } from "@/lib/outreach/send"

beforeEach(() => {
  campaigns.clear()
  suppressions.length = 0
  campaigns.set("c1", { id: "c1", status: "running" })
})

describe("preflightBeforeSend", () => {
  it("allows a clean send", async () => {
    const r = await preflightBeforeSend({ campaignId: "c1", email: "jane.doe@example.com" })
    expect(r.allowed).toBe(true)
  })

  it("rejects when campaign is paused", async () => {
    campaigns.set("c1", { id: "c1", status: "paused" })
    const r = await preflightBeforeSend({ campaignId: "c1", email: "jane.doe@example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("campaign_status_paused")
  })

  it("rejects when campaign is halted", async () => {
    campaigns.set("c1", { id: "c1", status: "halted" })
    const r = await preflightBeforeSend({ campaignId: "c1", email: "jane.doe@example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("campaign_status_halted")
  })

  it("rejects role addresses", async () => {
    const r = await preflightBeforeSend({ campaignId: "c1", email: "info@example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("role_address")
  })

  it("rejects invalid email syntax", async () => {
    const r = await preflightBeforeSend({ campaignId: "c1", email: "not-an-email" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("invalid_email_syntax")
  })

  it("rejects suppressed recipients (global)", async () => {
    suppressions.push({ emailLowercase: "jane.doe@example.com", campaignId: null })
    const r = await preflightBeforeSend({ campaignId: "c1", email: "jane.doe@example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("suppressed")
  })

  it("rejects recently contacted prospects (30d cooldown)", async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const r = await preflightBeforeSend({
      campaignId: "c1",
      email: "jane.doe@example.com",
      prospectLastContactedAt: recent,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("already_contacted_30d")
  })

  it("rejects property-manager flagged prospects", async () => {
    const r = await preflightBeforeSend({
      campaignId: "c1",
      email: "manager@pm-co.com",
      isPropertyManager: true,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("property_manager")
  })

  it("rejects when campaign not found", async () => {
    const r = await preflightBeforeSend({ campaignId: "nope", email: "jane.doe@example.com" })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe("campaign_not_found")
  })
})
