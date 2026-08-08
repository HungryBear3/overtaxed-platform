/** @jest-environment node */

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"
import { createPrismaManualReviewStore } from "@/lib/fulfillment-runtime/manual-review-store"

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const describeIfDb = testDatabaseUrl ? describe : describe.skip

describeIfDb("OT manual-review PostgreSQL contract proof", () => {
  jest.setTimeout(30_000)

  let pool: Pool
  let prisma: PrismaClient
  let store: ReturnType<typeof createPrismaManualReviewStore>
  let prefix: string

  beforeAll(() => {
    pool = new Pool({ connectionString: testDatabaseUrl, max: 10, ssl: false })
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    store = createPrismaManualReviewStore(
      prisma as unknown as Parameters<typeof createPrismaManualReviewStore>[0],
    )
  })

  beforeEach(() => {
    prefix = `ot_manual_review_pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  })

  afterEach(async () => {
    await prisma.oTOrder.deleteMany({ where: { id: { startsWith: prefix } } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

  async function order(status = "PAID", tier = "T2") {
    return prisma.oTOrder.create({
      data: {
        id: `${prefix}_order`,
        checkoutKey: `${prefix}:checkout`,
        contractKey: `${prefix}:contract`,
        tier,
        email: `${prefix}@example.com`,
        propertyAddress: "123 Main St",
        propertyPin: "09000000000000",
        township: "Northfield",
        windowStatus: "OPEN",
        checkoutAmountCents: 6900,
        checkoutCurrency: "usd",
        settledAmountCents: 6900,
        settledCurrency: "usd",
        stripeSessionId: `${prefix}_session`,
        status,
        attempt: 1,
      },
    })
  }

  async function fulfillment(status = "ARTIFACT_PENDING", revision = 0) {
    const parent = await order()
    const summary = await prisma.oTFulfillment.create({
      data: {
        id: `${prefix}_fulfillment`,
        orderId: parent.id,
        kind: "T2_APPEAL_EVIDENCE",
        status: status as never,
        statusRevision: revision,
      },
    })
    return { parent, summary }
  }

  const enter = (orderId: string, status = "ARTIFACT_PENDING", revision = 0) =>
    store.enter({
      orderId,
      actorUserId: "admin_test_1",
      expectedStatus: status as never,
      expectedStatusRevision: revision,
    })

  it("atomically enters manual review and changes no downstream evidence or parent", async () => {
    const { parent, summary } = await fulfillment()
    const beforeOrder = await prisma.oTOrder.findUniqueOrThrow({ where: { id: parent.id } })

    await expect(enter(parent.id)).resolves.toEqual({
      ok: true,
      outcome: "ENTERED_MANUAL_REVIEW",
      status: "MANUAL_REVIEW",
      statusRevision: 1,
    })

    expect(await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).toMatchObject({
      status: "MANUAL_REVIEW",
      statusRevision: 1,
      lastReasonCode: "MANUAL_REVIEW",
      attemptCount: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    expect(await prisma.oTOrder.findUniqueOrThrow({ where: { id: parent.id } })).toEqual(beforeOrder)
    expect(await prisma.oTFulfillmentAdminEvent.findMany({ where: { fulfillmentId: summary.id } })).toMatchObject([
      {
        action: "ENTER_MANUAL_REVIEW",
        fromStatus: "ARTIFACT_PENDING",
        toStatus: "MANUAL_REVIEW",
        fromRevision: 0,
        toRevision: 1,
        reasonCode: "MANUAL_REVIEW",
        actorUserId: "admin_test_1",
      },
    ])
    expect(await prisma.oTFulfillmentArtifact.count({ where: { fulfillmentId: summary.id } })).toBe(0)
    expect(await prisma.oTDeliveryAttempt.count({ where: { fulfillmentId: summary.id } })).toBe(0)
    expect(await prisma.oTDeliveryEvent.count({ where: { fulfillmentId: summary.id } })).toBe(0)
  })

  it("serializes concurrent identical requests to one revision and one audit row", async () => {
    const { parent, summary } = await fulfillment()
    const results = await Promise.all([enter(parent.id), enter(parent.id)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "STALE_STATE" },
    ])
    expect(await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).toMatchObject({
      status: "MANUAL_REVIEW",
      statusRevision: 1,
    })
    expect(await prisma.oTFulfillmentAdminEvent.count({ where: { fulfillmentId: summary.id } })).toBe(1)
  })

  it.each([
    ["ARTIFACT_PENDING", 1],
    ["NOT_STARTED", 0],
  ])("refuses stale expected status/revision without writes", async (status, revision) => {
    const { parent, summary } = await fulfillment()
    await expect(enter(parent.id, status, revision)).resolves.toEqual({ ok: false, code: "STALE_STATE" })
    expect(await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).toMatchObject({
      status: "ARTIFACT_PENDING",
      statusRevision: 0,
    })
    expect(await prisma.oTFulfillmentAdminEvent.count({ where: { fulfillmentId: summary.id } })).toBe(0)
  })

  it("rolls back the summary when the audit insert fails", async () => {
    const { parent, summary } = await fulfillment()
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ot_fulfillment_admin_event" ("id", "fulfillment_id", "action", "from_status", "to_status", "from_revision", "to_revision", "reason_code", "actor_user_id") VALUES ($1,$2,'ENTER_MANUAL_REVIEW','ARTIFACT_PENDING','MANUAL_REVIEW',0,1,'MANUAL_REVIEW','seed_admin')`,
      `${prefix}_audit_seed`,
      summary.id,
    )
    await expect(enter(parent.id)).rejects.toThrow()
    expect(await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).toMatchObject({
      status: "ARTIFACT_PENDING",
      statusRevision: 0,
      lastReasonCode: null,
    })
  })

  it("honors a concurrent terminal parent update and never restores PAID", async () => {
    const { parent, summary } = await fulfillment()
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    let locked!: () => void
    const hasLock = new Promise<void>((resolve) => { locked = resolve })
    const refund = prisma.$transaction(async (tx) => {
      await tx.oTOrder.update({ where: { id: parent.id }, data: { status: "REFUNDED" } })
      locked()
      await held
    })
    await hasLock
    const action = enter(parent.id)
    await new Promise<void>((resolve) => setImmediate(resolve))
    release()
    const [, result] = await Promise.all([refund, action])
    expect(result).toEqual({ ok: false, code: "ORDER_NOT_PAID" })
    expect((await prisma.oTOrder.findUniqueOrThrow({ where: { id: parent.id } })).status).toBe("REFUNDED")
    expect((await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).status).toBe("ARTIFACT_PENDING")
    expect(await prisma.oTFulfillmentAdminEvent.count({ where: { fulfillmentId: summary.id } })).toBe(0)
  })

  it("refuses existing attempt/event evidence without rewriting status", async () => {
    const { parent, summary } = await fulfillment("ARTIFACT_READY")
    await prisma.oTFulfillmentArtifact.create({
      data: {
        id: `${prefix}_artifact`, fulfillmentId: summary.id, version: 1,
        artifactSha256: "a".repeat(64), byteSize: 4, storageLocator: `${prefix}/artifact.pdf`,
        generatorVersion: "gen_v1", templateVersion: "tpl_v1",
      },
    })
    await prisma.oTDeliveryAttempt.create({
      data: {
        id: `${prefix}_attempt`, fulfillmentId: summary.id, attemptNumber: 1,
        artifactVersion: 1, idempotencyKey: `${prefix}:idem`, provider: "test-provider",
      },
    })
    await prisma.oTDeliveryEvent.create({
      data: {
        id: `${prefix}_event`, fulfillmentId: summary.id, attemptNumber: 1,
        provider: "test-provider", providerEventId: `${prefix}_provider_event`,
        eventType: "REQUESTED", sequence: 1, occurredAt: new Date(),
      },
    })
    expect(await enter(parent.id, "ARTIFACT_READY")).toEqual({ ok: false, code: "DOWNSTREAM_EVIDENCE_PRESENT" })
    expect((await prisma.oTFulfillment.findUniqueOrThrow({ where: { id: summary.id } })).status).toBe("ARTIFACT_READY")
    expect(await prisma.oTFulfillmentAdminEvent.count({ where: { fulfillmentId: summary.id } })).toBe(0)
  })

  it("does not create a ledger for a legacy paid order", async () => {
    const parent = await order()
    expect(await enter(parent.id)).toEqual({ ok: false, code: "NO_FULFILLMENT_SUMMARY" })
    expect(await prisma.oTFulfillment.count({ where: { orderId: parent.id } })).toBe(0)
    expect(await prisma.oTFulfillmentAdminEvent.count()).toBe(0)
  })

  it("preserves an artifact-ready row byte-for-byte while holding the summary", async () => {
    const { parent, summary } = await fulfillment("ARTIFACT_READY", 4)
    const artifact = await prisma.oTFulfillmentArtifact.create({
      data: {
        id: `${prefix}_artifact`, fulfillmentId: summary.id, version: 7,
        artifactSha256: "b".repeat(64), byteSize: 9876,
        storageLocator: `${prefix}/immutable.pdf`, generatorVersion: "gen_v7", templateVersion: "tpl_v3",
      },
    })
    expect(await enter(parent.id, "ARTIFACT_READY", 4)).toMatchObject({ ok: true, statusRevision: 5 })
    expect(await prisma.oTFulfillmentArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).toEqual(artifact)
  })

  it("cascades audit history with fulfillment parent teardown", async () => {
    const { parent, summary } = await fulfillment()
    await enter(parent.id)
    await prisma.oTOrder.delete({ where: { id: parent.id } })
    expect(await prisma.oTFulfillmentAdminEvent.count({ where: { fulfillmentId: summary.id } })).toBe(0)
  })

  it("enforces the narrow audit contract in PostgreSQL checks", async () => {
    const { summary } = await fulfillment()
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "ot_fulfillment_admin_event" ("id", "fulfillment_id", "action", "from_status", "to_status", "from_revision", "to_revision", "reason_code", "actor_user_id") VALUES ($1,$2,'RETRY','ARTIFACT_PENDING','MANUAL_REVIEW',0,1,'MANUAL_REVIEW','admin')`,
      `${prefix}_invalid_audit`, summary.id,
    )).rejects.toThrow()
  })
})
