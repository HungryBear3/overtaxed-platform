/**
 * @jest-environment node
 *
 * The Stripe webhook must NOT downgrade an existing recurring tier
 * (STARTER / GROWTH / PORTFOLIO / PERFORMANCE) to COMPS_ONLY when a one-off
 * DIY packet purchase is processed.
 *
 * We test by importing the webhook route's POST and feeding it a stripe-shaped
 * event whose signature verification we bypass via env mocking.
 */

// ── prisma mock ─────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const dbState: {
  invoices: Map<string, Row>
  users: Map<string, Row>
  stripeEvents: Map<string, Row>
} = { invoices: new Map(), users: new Map(), stripeEvents: new Map() }

jest.mock("@/lib/db", () => ({
  prisma: {
    stripeEvent: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        dbState.stripeEvents.get(where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: { id: string; type: string } }) => {
        if (dbState.stripeEvents.has(data.id)) {
          const err = new Error("unique constraint") as Error & { code?: string }
          err.code = "P2002"
          throw err
        }
        dbState.stripeEvents.set(data.id, data)
        return data
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        dbState.stripeEvents.delete(where.id)
        return null
      }),
    },
    invoice: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const inv = dbState.invoices.get(where.id)
        if (!inv) throw new Error("invoice not found")
        Object.assign(inv, data)
        return inv
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        dbState.users.get(where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const u = dbState.users.get(where.id)
        if (!u) throw new Error("user not found")
        Object.assign(u, data)
        return u
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    referral: {
      upsert: jest.fn(async () => ({})),
    },
  },
}))

// ── stripe mock — accept the constructed event verbatim, no signature check ─
jest.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn((body: string) => JSON.parse(body)),
    },
    subscriptions: {
      retrieve: jest.fn(),
      list: jest.fn(async () => ({ data: [] })),
      update: jest.fn(),
    },
    customers: {
      retrieve: jest.fn(),
    },
  },
}))

// Stop generatePacketForInvoice from running real logic; we only care about user.update behavior.
jest.mock("@/lib/packet/generate-and-deliver", () => ({
  generatePacketForInvoice: jest.fn(async () => ({ ok: true, status: "DELIVERED", pdfUrl: "x" })),
}))

import { POST } from "@/app/api/billing/webhook/route"

beforeEach(() => {
  dbState.invoices.clear()
  dbState.users.clear()
  dbState.stripeEvents.clear()
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
})

function makeRequest(eventId: string, invoiceId: string) {
  const body = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "payment",
        metadata: { invoiceId },
        customer: "cus_xyz",
      },
    },
  })
  return new Request("http://test/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body,
  }) as unknown as import("next/server").NextRequest
}

function seedUserAndInvoice(tier: string | null, invoiceId = "inv_clobber_test") {
  dbState.users.set("user_1", {
    id: "user_1",
    subscriptionTier: tier,
    stripeCustomerId: null,
  })
  dbState.invoices.set(invoiceId, {
    id: invoiceId,
    userId: "user_1",
    invoiceType: "COMPS_ONLY",
    status: "PENDING",
  })
}

describe("DIY COMPS_ONLY purchase preserves stronger recurring tiers", () => {
  it.each(["STARTER", "GROWTH", "PORTFOLIO", "PERFORMANCE"])(
    "%s user buys packet → tier preserved",
    async (tier) => {
      seedUserAndInvoice(tier)
      const res = await POST(makeRequest(`evt_${tier}`, "inv_clobber_test"))
      expect(res.status).toBe(200)
      const u = dbState.users.get("user_1")
      expect(u?.subscriptionTier).toBe(tier)
    },
  )

  it("user with no stronger plan (null) is promoted to COMPS_ONLY ACTIVE", async () => {
    seedUserAndInvoice(null)
    const res = await POST(makeRequest("evt_null", "inv_clobber_test"))
    expect(res.status).toBe(200)
    const u = dbState.users.get("user_1")
    expect(u?.subscriptionTier).toBe("COMPS_ONLY")
    expect(u?.subscriptionStatus).toBe("ACTIVE")
  })

  it("user with COMPS_ONLY stays COMPS_ONLY (no clobber, but no downgrade)", async () => {
    seedUserAndInvoice("COMPS_ONLY")
    const res = await POST(makeRequest("evt_comps", "inv_clobber_test"))
    expect(res.status).toBe(200)
    const u = dbState.users.get("user_1")
    expect(u?.subscriptionTier).toBe("COMPS_ONLY")
  })

  it("missing stripeCustomerId is patched even when tier is preserved", async () => {
    seedUserAndInvoice("STARTER")
    await POST(makeRequest("evt_starter_cust", "inv_clobber_test"))
    const u = dbState.users.get("user_1")
    expect(u?.subscriptionTier).toBe("STARTER")
    expect(u?.stripeCustomerId).toBe("cus_xyz")
  })
})

describe("Webhook idempotency", () => {
  it("duplicate event delivery: only the first wins; second sees P2002 and skips", async () => {
    seedUserAndInvoice(null, "inv_idemp_test")
    const r1 = await POST(makeRequest("evt_idemp", "inv_idemp_test"))
    const r2 = await POST(makeRequest("evt_idemp", "inv_idemp_test"))
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // Only one StripeEvent row remains.
    expect(dbState.stripeEvents.size).toBe(1)
  })
})
