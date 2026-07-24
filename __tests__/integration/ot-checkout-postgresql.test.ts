/** @jest-environment node */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const describeIfDb = testDatabaseUrl ? describe : describe.skip

describeIfDb("OT checkout PostgreSQL contract proof", () => {
  jest.setTimeout(30_000)

  let pool: Pool
  let prisma: PrismaClient
  let prefix: string

  beforeAll(() => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 5, ssl: false })
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  })

  beforeEach(() => {
    prefix = `ot_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  })

  afterEach(async () => {
    await prisma.oTOrder.deleteMany({
      where: {
        OR: [
          { id: { startsWith: prefix } },
          { checkoutKey: { startsWith: prefix } },
          { contractKey: { startsWith: prefix } },
          { email: { startsWith: prefix } },
        ],
      },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

  const orderData = () => ({
    id: `${prefix}_order`,
    checkoutKey: `${prefix}:checkout`,
    contractKey: `${prefix}:contract`,
    tier: "T2",
    email: `${prefix}@example.com`,
    propertyAddress: "123 Main St",
    township: "Northfield",
    windowStatus: "OPEN",
    checkoutAmountCents: 6900,
    checkoutCurrency: "usd",
    status: "PENDING",
    attempt: 0,
  })

  it("enforces unique checkout and contract identities", async () => {
    const data = orderData()
    const [first, second] = await Promise.allSettled([
      prisma.oTOrder.create({ data }),
      prisma.oTOrder.create({ data: { ...data, id: `${prefix}_other`, email: `${prefix}_other@example.com` } }),
    ])
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"])
    const rejected = [first, second].find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason?.code).toBe("P2002")
    expect(await prisma.oTOrder.count({ where: { checkoutKey: data.checkoutKey } })).toBe(1)
  })

  it("allows only one concurrent checkout claim for the exact durable tuple", async () => {
    const order = await prisma.oTOrder.create({ data: orderData() })
    const where = {
      id: order.id,
      contractKey: order.contractKey,
      tier: order.tier,
      email: order.email,
      propertyAddress: order.propertyAddress,
      township: order.township,
      windowStatus: order.windowStatus,
      checkoutAmountCents: order.checkoutAmountCents,
      checkoutCurrency: order.checkoutCurrency,
      attempt: order.attempt,
      status: order.status,
      updatedAt: order.updatedAt,
    }
    const results = await Promise.all([
      prisma.oTOrder.updateMany({ where, data: { status: "CHECKOUT_CREATING" } }),
      prisma.oTOrder.updateMany({ where, data: { status: "CHECKOUT_CREATING" } }),
    ])
    expect(results.map((result) => result.count).sort()).toEqual([0, 1])
  })

  it("allows only one exact settlement transition and preserves the winner", async () => {
    const data = orderData()
    const order = await prisma.oTOrder.create({
      data: {
        ...data,
        status: "CHECKOUT_CREATED",
        stripeSessionId: `${prefix}_session`,
        checkoutPriceId: `${prefix}_price`,
        checkoutProductId: `${prefix}_product`,
        analysisAcknowledgedAt: new Date(),
        acknowledgmentVersion: "analysis_ack_v1",
        acknowledgmentEvidence: { acknowledged: true, version: "analysis_ack_v1" },
      },
    })
    const where = {
      id: order.id,
      status: "CHECKOUT_CREATED",
      stripeSessionId: order.stripeSessionId,
      checkoutKey: order.checkoutKey,
      contractKey: order.contractKey,
      checkoutAmountCents: order.checkoutAmountCents,
      checkoutCurrency: order.checkoutCurrency,
    }
    const results = await Promise.all([
      prisma.oTOrder.updateMany({ where, data: { status: "PAID", settledAmountCents: 6900, settledCurrency: "usd" } }),
      prisma.oTOrder.updateMany({ where, data: { status: "PAID", settledAmountCents: 6900, settledCurrency: "usd" } }),
    ])
    expect(results.map((result) => result.count).sort()).toEqual([0, 1])
    expect(await prisma.oTOrder.findUnique({ where: { id: order.id } })).toMatchObject({
      status: "PAID",
      settledAmountCents: 6900,
      settledCurrency: "usd",
    })
  })
})
