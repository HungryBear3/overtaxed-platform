/** @jest-environment node */

/**
 * Held-product provider boundary.
 *
 * The frozen contract requires the *actual* contingency Stripe helper to assert
 * held status before importing, acquiring, or constructing Stripe. These tests
 * drive the real modules with a Stripe constructor that throws, so any eager
 * construction is a hard failure rather than a silent pass.
 */

const stripeConstructor = jest.fn(() => {
  throw new Error("STRIPE_CONSTRUCTED")
})

jest.mock("stripe", () => ({
  __esModule: true,
  default: stripeConstructor,
}))

const prismaMock = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  invoice: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  appeal: { findMany: jest.fn() },
  oTOrder: { findFirst: jest.fn(), updateMany: jest.fn() },
}

jest.mock("@/lib/db", () => ({ __esModule: true, prisma: prismaMock }))

describe("held product registry", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = "sk_test_should_never_be_used"
  })

  it("marks every withdrawn product as held", async () => {
    const { HELD_PRODUCT_IDS, isHeldProduct } = await import("@/lib/products/held")

    for (const id of HELD_PRODUCT_IDS) {
      expect(isHeldProduct(id)).toBe(true)
    }

    expect(HELD_PRODUCT_IDS).toEqual(
      expect.arrayContaining([
        "T3_DFY",
        "CONTINGENCY",
        "PERFORMANCE_INVOICE",
        "BOR",
        "MARKETING_DRIP",
      ]),
    )
  })

  it("throws a typed error naming the held product and boundary", async () => {
    const { assertNotHeldProduct, HeldProductError } = await import("@/lib/products/held")

    expect(() => assertNotHeldProduct("CONTINGENCY", "stripe-invoice")).toThrow(HeldProductError)

    try {
      assertNotHeldProduct("CONTINGENCY", "stripe-invoice")
    } catch (error) {
      expect((error as Error & { productId: string; boundary: string }).productId).toBe("CONTINGENCY")
      expect((error as Error & { productId: string; boundary: string }).boundary).toBe("stripe-invoice")
    }
  })

  it("does not treat the live Assessor-stage packet as held", async () => {
    const { isHeldProduct } = await import("@/lib/products/held")
    expect(isHeldProduct("T2_PACKET")).toBe(false)
  })
})

describe("contingency Stripe helper boundary", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = "sk_test_should_never_be_used"
  })

  it("does not construct Stripe merely by importing the invoice helper", async () => {
    await import("@/lib/billing/stripe-invoice")
    expect(stripeConstructor).not.toHaveBeenCalled()
  })

  it("does not construct Stripe merely by importing the performance-fee module", async () => {
    await import("@/lib/billing/performance-fee")
    expect(stripeConstructor).not.toHaveBeenCalled()
  })

  it("refuses createAndSendStripeInvoice before acquiring Stripe", async () => {
    const { createAndSendStripeInvoice } = await import("@/lib/billing/stripe-invoice")

    const result = await createAndSendStripeInvoice({
      ourInvoiceId: "inv_1",
      userId: "user_1",
      amount: 250,
      invoiceNumber: "OT-1",
    })

    expect(result).toEqual({ success: false, error: expect.stringContaining("held") })
    expect(stripeConstructor).not.toHaveBeenCalled()
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it("refuses getOrCreateStripeCustomer before acquiring Stripe or reading the user", async () => {
    const { getOrCreateStripeCustomer } = await import("@/lib/billing/stripe-invoice")

    await expect(getOrCreateStripeCustomer("user_1")).resolves.toBeNull()
    expect(stripeConstructor).not.toHaveBeenCalled()
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("refuses createPerformanceFeeInvoice before any Stripe or invoice write", async () => {
    const { createPerformanceFeeInvoice } = await import("@/lib/billing/performance-fee")

    const result = await createPerformanceFeeInvoice(
      "user_1",
      {
        totalSavings: 5000,
        feeAmount: 1100,
        appealIds: ["a1"],
        breakdownByYear: { 2026: { savings: 5000, appealIds: ["a1"] } },
        startYear: 2026,
        endYear: 2028,
      },
      "UPFRONT",
    )

    expect(result.invoiceIds).toEqual([])
    expect(stripeConstructor).not.toHaveBeenCalled()
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it("refuses shouldCreatePerformanceInvoice before reading contingency eligibility", async () => {
    const { shouldCreatePerformanceInvoice } = await import("@/lib/billing/performance-fee")

    const result = await shouldCreatePerformanceInvoice("user_1")

    expect(result.should).toBe(false)
    expect((result as { reason?: string }).reason).toMatch(/held/i)
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.appeal.findMany).not.toHaveBeenCalled()
  })
})

describe("stripe client acquisition", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env.STRIPE_SECRET_KEY = "sk_test_should_never_be_used"
  })

  it("exposes a lazy accessor that returns null without constructing when unconfigured", async () => {
    delete process.env.STRIPE_SECRET_KEY
    const { getStripe } = await import("@/lib/stripe/client")
    expect(getStripe()).toBeNull()
    expect(stripeConstructor).not.toHaveBeenCalled()
  })
})

export {}
