/** Webhook ingestion: idempotency + complaint/bounce paths + transactional safety. */

type Row = { id: string; [k: string]: unknown }

const db = {
  webhookEvents: new Map<string, Row>(),
  sends: new Map<string, Row>(),
  suppressions: [] as Row[],
  campaigns: new Map<string, Row>(),
}

function cloneMap(source: Map<string, Row>): Map<string, Row> {
  return new Map(
    Array.from(source.entries()).map(([k, v]) => [k, { ...v }]),
  )
}

function cloneRows(rows: Row[]): Row[] {
  return rows.map((row) => ({ ...row }))
}

jest.mock("@/lib/db", () => {
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) => {
      const snapshot = {
        webhookEvents: cloneMap(db.webhookEvents),
        sends: cloneMap(db.sends),
        suppressions: cloneRows(db.suppressions),
        campaigns: cloneMap(db.campaigns),
      }

      try {
        return await callback(prisma)
      } catch (error) {
        db.webhookEvents.clear()
        for (const [key, value] of snapshot.webhookEvents.entries()) db.webhookEvents.set(key, value)

        db.sends.clear()
        for (const [key, value] of snapshot.sends.entries()) db.sends.set(key, value)

        db.suppressions.length = 0
        db.suppressions.push(...snapshot.suppressions)

        db.campaigns.clear()
        for (const [key, value] of snapshot.campaigns.entries()) db.campaigns.set(key, value)

        throw error
      }
    }),
    outreachWebhookEvent: {
      create: jest.fn(async ({ data }: any) => {
        const key = `${data.provider}|${data.providerEventId}`
        if (db.webhookEvents.has(key)) {
          const err = new Error("Unique constraint failed") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        const row: Row = { id: `we_${db.webhookEvents.size + 1}`, ...data }
        db.webhookEvents.set(key, row)
        return row
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const key = `${where.provider}|${where.providerEventId}`
        const row = db.webhookEvents.get(key)
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    outreachSend: {
      findUnique: jest.fn(async ({ where }: any) => {
        for (const row of db.sends.values()) if (row.customId === where.customId) return row
        return null
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of db.sends.values()) if (row.messageId === where.messageId) return row
        return null
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.sends.get(where.id)
        if (!row) throw new Error("send not found")
        Object.assign(row, data)
        return row
      }),
      count: jest.fn(async ({ where }: any) => {
        let n = 0
        for (const row of db.sends.values()) {
          if (
            row.email === where.email &&
            row.bounceType === "soft" &&
            row.bouncedAt instanceof Date &&
            row.bouncedAt >= where.bouncedAt.gte
          ) {
            n++
          }
        }
        return n
      }),
    },
    outreachSuppression: {
      create: jest.fn(async ({ data }: any) => {
        const exists = db.suppressions.find(
          (s) =>
            s.emailLowercase === data.emailLowercase &&
            (s.campaignId ?? null) === (data.campaignId ?? null) &&
            s.reason === data.reason,
        )
        if (exists) {
          const err = new Error("Unique constraint failed") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        const row: Row = { id: `sp_${db.suppressions.length + 1}`, ...data }
        db.suppressions.push(row)
        return row
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          db.suppressions.find(
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
    outreachCampaign: {
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.campaigns.get(where.id)
        if (!row) throw new Error("campaign not found")
        Object.assign(row, data)
        return row
      }),
    },
  }

  return { prisma }
})

import { ingestResendEvent } from "@/lib/outreach/webhooks"
import { prisma } from "@/lib/db"

function seedSend(overrides: Partial<Row> = {}) {
  db.campaigns.set("camp_1", { id: "camp_1", status: "running" })
  const send: Row = {
    id: "snd_1",
    campaignId: "camp_1",
    prospectId: "p_1",
    email: "board@example.com",
    customId: "cust_1",
    messageId: "msg_1",
    status: "sent",
    ...overrides,
  }
  db.sends.set(send.id as string, send)
  return send
}

beforeEach(() => {
  db.webhookEvents.clear()
  db.sends.clear()
  db.suppressions.length = 0
  db.campaigns.clear()
  jest.clearAllMocks()
})

describe("ingestResendEvent", () => {
  it("writes raw event, updates send on delivered", async () => {
    seedSend()
    const result = await ingestResendEvent({
      providerEventId: "evt_1",
      event: {
        type: "email.delivered",
        data: { email_id: "msg_1", to: "board@example.com" },
      },
    })
    expect(result.duplicate).toBe(false)
    expect(result.suppressed).toBe(false)
    const send = db.sends.get("snd_1")!
    expect(send.status).toBe("delivered")
    expect(send.deliveredAt).toBeInstanceOf(Date)
    expect(db.webhookEvents.get("resend|evt_1")?.processedAt).toBeInstanceOf(Date)
  })

  it("is idempotent on duplicate provider_event_id", async () => {
    seedSend()
    const args = {
      providerEventId: "evt_dup",
      event: {
        type: "email.opened" as const,
        data: { email_id: "msg_1", to: "board@example.com" },
      },
    }
    const first = await ingestResendEvent(args)
    const second = await ingestResendEvent(args)
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(db.webhookEvents.size).toBe(1)
  })

  it("suppresses recipient and halts campaign on complaint", async () => {
    seedSend()
    const result = await ingestResendEvent({
      providerEventId: "evt_c",
      event: {
        type: "email.complained",
        data: {
          email_id: "msg_1",
          to: "board@example.com",
          tags: [{ name: "custom_id", value: "cust_1" }],
        },
      },
    })
    expect(result.suppressed).toBe(true)
    expect(result.campaignHalted).toBe(true)
    expect(db.suppressions[0]?.reason).toBe("COMPLAINED")
    expect(db.suppressions[0]?.emailLowercase).toBe("board@example.com")
    expect(db.campaigns.get("camp_1")?.status).toBe("halted")
  })

  it("suppresses on hard bounce; does not halt campaign", async () => {
    seedSend()
    const result = await ingestResendEvent({
      providerEventId: "evt_b",
      event: {
        type: "email.bounced",
        data: {
          email_id: "msg_1",
          to: "board@example.com",
          bounce: { type: "hard", message: "mailbox not found" },
        },
      },
    })
    expect(result.suppressed).toBe(true)
    expect(result.campaignHalted).toBe(false)
    expect(db.suppressions[0]?.reason).toBe("HARD_BOUNCED")
  })

  it("does not suppress on a single soft bounce", async () => {
    seedSend({ bounceType: "soft" })
    const result = await ingestResendEvent({
      providerEventId: "evt_sb",
      event: {
        type: "email.bounced",
        data: {
          email_id: "msg_1",
          to: "board@example.com",
          bounce: { type: "soft", message: "temporary" },
        },
      },
    })
    expect(result.suppressed).toBe(false)
    expect(db.suppressions.length).toBe(0)
  })

  it("suppresses on the third soft bounce in the rolling window", async () => {
    seedSend()
    db.sends.set("snd_2", {
      id: "snd_2",
      campaignId: "camp_1",
      prospectId: "p_2",
      email: "board@example.com",
      customId: "cust_2",
      messageId: "msg_2",
      status: "bounced",
      bounceType: "soft",
      bouncedAt: new Date(),
    })
    db.sends.set("snd_3", {
      id: "snd_3",
      campaignId: "camp_1",
      prospectId: "p_3",
      email: "board@example.com",
      customId: "cust_3",
      messageId: "msg_3",
      status: "bounced",
      bounceType: "soft",
      bouncedAt: new Date(),
    })

    const result = await ingestResendEvent({
      providerEventId: "evt_sb3",
      event: {
        type: "email.bounced",
        data: {
          email_id: "msg_1",
          to: "board@example.com",
          bounce: { type: "soft", message: "temporary" },
        },
      },
    })

    expect(result.suppressed).toBe(true)
    expect(db.suppressions[0]?.reason).toBe("SOFT_BOUNCED_REPEATED")
  })

  it("does not regress status when an older webhook arrives late", async () => {
    seedSend({ status: "opened" })

    await ingestResendEvent({
      providerEventId: "evt_late_delivered",
      event: {
        type: "email.delivered",
        data: { email_id: "msg_1", to: "board@example.com" },
      },
    })

    const send = db.sends.get("snd_1")!
    expect(send.status).toBe("opened")
    expect(send.deliveredAt).toBeInstanceOf(Date)
  })

  it("uses serializable transactions for webhook ingest", async () => {
    seedSend()

    await ingestResendEvent({
      providerEventId: "evt_serializable",
      event: {
        type: "email.delivered",
        data: { email_id: "msg_1", to: "board@example.com" },
      },
    })

    expect((prisma.$transaction as jest.Mock).mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    })
  })

  it("rolls back webhook event and send updates if downstream campaign halt fails", async () => {
    seedSend()
    ;(prisma.outreachCampaign.update as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("db write failed")
    })

    await expect(
      ingestResendEvent({
        providerEventId: "evt_fail",
        event: {
          type: "email.complained",
          data: {
            email_id: "msg_1",
            to: "board@example.com",
            tags: [{ name: "custom_id", value: "cust_1" }],
          },
        },
      }),
    ).rejects.toThrow("db write failed")

    expect(db.webhookEvents.size).toBe(0)
    expect(db.suppressions.length).toBe(0)
    expect(db.campaigns.get("camp_1")?.status).toBe("running")
    expect(db.sends.get("snd_1")?.status).toBe("sent")
  })
})
