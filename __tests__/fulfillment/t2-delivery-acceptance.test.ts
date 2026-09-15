/**
 * @jest-environment node
 *
 * INTEGRATED SYNTHETIC ACCEPTANCE for the whole T2 delivery flow.
 *
 * One settled paid T2 order is driven end to end against an in-memory database
 * that answers the stores' REAL SQL, a fake blob store, and a FAKE mail
 * provider:
 *
 *   settled paid T2
 *     → signed-policy TEST FIXTURE generation (a real, parseable PDF)
 *     → immutable artifact bound to exact bytes
 *     → durable delivery attempt, persisted BEFORE any send
 *     → internal capability issuance, bound to that exact attempt
 *     → fake provider acceptance (a message id, and nothing more)
 *     → signed synthetic provider callback
 *     → the customer pastes the code into the real POST route
 *     → the exact PDF digest comes back
 *
 * No credential is read, no provider is called, no mail is sent, no real
 * database is touched, and no network socket is opened. The eligibility policy
 * used is an explicit TEST FIXTURE — the production registry stays unsigned and
 * the real producer still refuses it, which the final test here re-proves.
 *
 * The property this file exists to defend above all others: a fake provider
 * ACCEPTANCE alone never yields DELIVERED.
 */
import { createHash, randomUUID } from "node:crypto"
import { PDFDocument } from "pdf-lib"
import { Webhook as SvixWebhook } from "svix"
import type { Prisma } from "@prisma/client"
import { get, put } from "@vercel/blob"

import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
  contentAddressedT2ArtifactLocator,
} from "@/lib/fulfillment/artifact-digest"
import { RESEND_PROVIDER } from "@/lib/fulfillment/provider-callbacks"
import {
  generateT2Artifact,
  type T2ArtifactGateway,
} from "@/lib/fulfillment-runtime/t2-artifact-producer"
import { prismaArtifactBindingStore } from "@/lib/fulfillment-runtime/artifact-binding-store"
import { runT2ArtifactBindingWorkflow } from "@/lib/fulfillment-runtime/t2-artifact-workflow"
import { createPrismaT2DeliveryStore } from "@/lib/fulfillment-runtime/delivery-store"
import { createPrismaPacketDownloadStore } from "@/lib/fulfillment-runtime/packet-download-store"
import { createPrismaProviderCallbackStore } from "@/lib/fulfillment-runtime/provider-callback-store"
import { createT2ResendAdapter, type T2MailProvider } from "@/lib/fulfillment-runtime/t2-resend-adapter"
import { createPrismaT2SendContextReader } from "@/lib/fulfillment-runtime/t2-resend-adapter"
import { runT2Delivery } from "@/lib/fulfillment-runtime/t2-delivery-orchestrator"
import { ingestT2ResendCallback } from "@/lib/fulfillment-runtime/t2-resend-events"
import { POST as downloadPacket } from "@/app/api/ot/packet/download/route"

jest.mock("server-only", () => ({}))
jest.mock("@vercel/blob", () => ({ get: jest.fn(), put: jest.fn() }))
jest.mock("@/lib/db", () => ({ prisma: {} }))
jest.mock("@/lib/fulfillment-runtime/artifact-binding-store", () => ({
  prismaArtifactBindingStore: { bind: jest.fn() },
}))
jest.mock("@/lib/fulfillment-runtime/t2-artifact-producer", () => ({
  ...jest.requireActual("@/lib/fulfillment-runtime/t2-artifact-producer"),
  generateT2Artifact: jest.fn((input) =>
    jest
      .requireActual("@/lib/fulfillment-runtime/t2-artifact-producer")
      .generateT2Artifact(input, gateway()),
  ),
}))
// The download ROUTE resolves its store from the module singleton, so the
// singleton is redirected at the in-memory database rather than the route being
// handed a test double. The route under test is the real one.
jest.mock("@/lib/fulfillment-runtime/packet-download-store", () => {
  const actual = jest.requireActual("@/lib/fulfillment-runtime/packet-download-store")
  return {
    ...actual,
    prismaPacketDownloadStore: {
      issue: (...args: unknown[]) => packetStore.issue(...(args as [never])),
      authorize: (...args: unknown[]) => packetStore.authorize(...(args as [never])),
      reassert: (...args: unknown[]) => packetStore.reassert(...(args as [never])),
      revoke: (...args: unknown[]) => packetStore.revoke(...(args as [never])),
    },
  }
})

const ORDER_ID = "ord_acceptance_t2"
const FULFILLMENT_ID = "ful_acceptance_t2"
const RECIPIENT = "owner@example.com"
const PIN = "99010010010000"
const ADDRESS = "1 EXAMPLE ST"
const AT = "2026-06-08T12:00:00Z"
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

const CALLBACK_ENV = {
  OT_T2_DELIVERY_CALLBACK_ENABLED: "true",
  OT_T2_RESEND_WEBHOOK_SECRET: SECRET,
}
const ADAPTER_ENV = {
  OT_T2_DELIVERY_ADAPTER_ENABLED: "true",
  OT_T2_PACKET_DOWNLOAD_ENABLED: "true",
  RESEND_API_KEY: "re_synthetic_key_not_a_real_credential",
  OT_T2_DELIVERY_FROM: "OverTaxed IL <support@overtaxed-il.com>",
  NEXT_PUBLIC_APP_URL: "https://www.overtaxed-il.com",
}

/** The signed TEST FIXTURE policy. The production registry stays unsigned. */
function gateway(): T2ArtifactGateway {
  const subject = {
    pin: PIN, address: ADDRESS, city: "Chicago", township: "Example",
    neighborhoodCode: "99010", propertyClass: "203", residentialSubtype: "1 Story",
    buildingSqft: 1200, yearBuilt: 1955, assessedTotalValue: 30000,
    assessmentStage: "mailed" as const, taxYear: 2025, pinCount: 1, inCookCounty: true,
  }
  const candidates = Array.from({ length: 6 }, (_, i) => ({
    pin: `9901001002000${i}`, neighborhoodCode: "99010", propertyClass: "203",
    residentialSubtype: "1 Story", buildingSqft: 1200, yearBuilt: 1955,
  }))
  return {
    loadOrder: async () => ({ id: ORDER_ID, propertyPin: PIN, propertyAddress: ADDRESS, township: "Example" }),
    loadFulfillment: async () => ({
      id: FULFILLMENT_ID, orderId: ORDER_ID, kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_PENDING", createdAt: new Date("2026-06-08T10:15:30Z"),
    }),
    loadCountyData: async () => ({
      subject, comparableCandidates: candidates,
      comparableAssessedValues: new Map(candidates.map((c) => [c.pin, 24000])),
      comparableAddresses: new Map(candidates.map((c, i) => [c.pin, `${i} EXAMPLE AVE`])),
      sources: [
        { datasetId: "uzyt-m557", datasetTitle: "Assessor - Assessed Values", url: "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json", retrievedAt: AT, contentSha256: "a".repeat(64) },
        { datasetId: "x54s-btds", datasetTitle: "Assessor - Single and Multi-Family Improvement Characteristics", url: "https://datacatalog.cookcountyil.gov/resource/x54s-btds.json", retrievedAt: AT, contentSha256: "b".repeat(64) },
      ],
    }),
    resolvePolicy: () => ({
      version: "test-only-policy", ownerDecisions: ["OD-2", "OD-3"], signedAt: "2026-06-08",
      evidenceThreshold: { minRelativeAssessmentGap: 0.2, minComparables: 5 },
    }),
    resolveDeadline: async () => ({
      trusted: true, status: "open", closeDate: "2026-06-30",
      sourceName: "Cook County Assessor",
      sourceUrl: "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      retrievedAt: AT,
    }),
    now: () => new Date(AT),
  }
}

/* ── The in-memory database ──────────────────────────────────────────────── */

type Row = Record<string, unknown>

type Database = {
  now: string
  order: Row
  fulfillment: Row
  artifacts: Row[]
  attempts: Row[]
  events: Row[]
  capabilities: Row[]
  callbacks: Row[]
}

let db: Database
let objects: Map<string, Buffer>
let packetStore: ReturnType<typeof createPrismaPacketDownloadStore>
let deliveryStore: ReturnType<typeof createPrismaT2DeliveryStore>
let callbackStore: ReturnType<typeof createPrismaProviderCallbackStore>
let contextReader: ReturnType<typeof createPrismaT2SendContextReader>
let sentMessages: Array<{ to: string; subject: string; text: string; html: string }>

function freshDatabase(): Database {
  return {
    now: "2026-06-08T12:05:00.000Z",
    order: {
      id: ORDER_ID, tier: "T2", status: "PAID", email: RECIPIENT,
      propertyPin: PIN, propertyAddress: ADDRESS,
    },
    fulfillment: {
      id: FULFILLMENT_ID, orderId: ORDER_ID, kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_READY", statusRevision: 3, attemptCount: 0,
      leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    },
    artifacts: [], attempts: [], events: [], capabilities: [], callbacks: [],
  }
}

function currentArtifact(): Row | undefined {
  return [...db.artifacts].sort((a, b) => Number(b.version) - Number(a.version))[0]
}

function query(sql: string, values: readonly unknown[]): unknown {
  if (sql.includes("clock_timestamp()")) return [{ now: db.now }]

  // The callback store's message-id lookup.
  if (sql.includes('JOIN "ot_fulfillment" f ON f."id" = t."fulfillment_id"')) {
    const [provider, messageId] = values
    const hit = db.attempts.find(
      (a) => a.provider === provider && a.providerMessageId === messageId,
    )
    return hit
      ? [{ fulfillmentId: hit.fulfillmentId, attemptNumber: hit.attemptNumber, orderId: ORDER_ID }]
      : []
  }

  // The adapter's single-statement send context.
  if (sql.includes("JOIN LATERAL")) {
    const [attemptNumber, fulfillmentId, orderId] = values
    const attempt = db.attempts.find(
      (a) => a.fulfillmentId === fulfillmentId && a.attemptNumber === attemptNumber,
    )
    const artifact = currentArtifact()
    if (!attempt || !artifact || db.fulfillment.orderId !== orderId) return []
    return [{
      recipient: db.order.email,
      orderStatus: db.order.status,
      orderTier: db.order.tier,
      fulfillmentOrderId: db.fulfillment.orderId,
      fulfillmentKind: db.fulfillment.kind,
      fulfillmentStatus: db.fulfillment.status,
      attemptCount: db.fulfillment.attemptCount,
      currentArtifactVersion: artifact.version,
      currentArtifactSha256: artifact.artifactSha256,
      attemptProvider: attempt.provider,
      attemptIdempotencyKey: attempt.idempotencyKey,
      attemptCapabilityId: attempt.downloadCapabilityId ?? null,
    }]
  }

  if (sql.includes('FROM "ot_order"')) return [db.order]

  if (sql.includes('COUNT(*) AS "live"')) {
    return [{
      live: db.callbacks.filter((c) => c.disposition === "UNMATCHED" && c.resolvedAt === null).length,
    }]
  }
  if (sql.includes('FROM "ot_delivery_provider_callback"')) {
    const [provider, messageId, horizon] = values as [string, string, Date]
    return db.callbacks
      .filter((c) =>
        c.provider === provider && c.providerMessageId === messageId &&
        c.disposition === "UNMATCHED" && c.resolvedAt === null &&
        (c.receivedAt as Date) >= horizon)
      .sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime())
  }

  if (sql.includes('FROM "ot_packet_download_capability"')) {
    const hash = values[0]
    return db.capabilities.filter((c) => c.capabilityHash === hash)
  }
  if (sql.includes('FROM "ot_fulfillment_artifact"')) {
    const artifact = currentArtifact()
    return artifact ? [artifact] : []
  }
  if (sql.includes('FROM "ot_fulfillment"')) return [db.fulfillment]
  if (sql.includes('FROM "ot_delivery_attempt"')) {
    const [fulfillmentId, attemptNumber] = values
    return db.attempts.filter(
      (a) => a.fulfillmentId === fulfillmentId && a.attemptNumber === attemptNumber,
    )
  }
  if (sql.includes('FROM "ot_delivery_event"')) {
    const max = db.events.reduce((best, e) => Math.max(best, Number(e.sequence)), 0)
    return [{ next: max + 1 }]
  }
  throw new Error(`unexpected query: ${sql}`)
}

function execute(sql: string, values: readonly unknown[]): number {
  if (sql.includes('INSERT INTO "ot_delivery_attempt"')) {
    const [, fulfillmentId, attemptNumber, artifactVersion, idempotencyKey, provider] = values
    db.attempts.push({
      fulfillmentId, attemptNumber, artifactVersion, idempotencyKey, provider,
      providerMessageId: null, downloadCapabilityId: null,
    })
    return 1
  }
  if (sql.includes('INSERT INTO "ot_delivery_event"')) {
    const [, fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence, , , reasonCode] = values
    if (db.events.some((e) => e.provider === provider && e.providerEventId === providerEventId))
      return 0
    db.events.push({ fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence, reasonCode })
    return 1
  }
  if (sql.includes('INSERT INTO "ot_packet_download_capability"')) {
    const [id, capabilityHash, fulfillmentId, artifactId, artifactVersion, artifactSha256, sourceOrderId, propertyBindingFingerprint, issuedAt, expiresAt, maxUses] = values
    db.capabilities.push({
      id, capabilityHash, fulfillmentId, artifactId, artifactVersion, artifactSha256,
      sourceOrderId, propertyBindingFingerprint, issuedAt, expiresAt, maxUses,
      useCount: 0, lastUsedAt: null, revokedAt: null, revokedReasonCode: null,
    })
    return 1
  }
  if (sql.includes('INSERT INTO "ot_delivery_provider_callback"')) {
    const [id, provider, providerEventId, providerMessageId, eventType, reasonCode, occurredAt, receivedAt, disposition] = values
    if (db.callbacks.some((c) => c.provider === provider && c.providerEventId === providerEventId))
      return 0
    db.callbacks.push({
      id, provider, providerEventId, providerMessageId, eventType, reasonCode,
      occurredAt, receivedAt, disposition, dispositionCode: null,
      fulfillmentId: null, attemptNumber: null, resolvedAt: null, replayCount: 0,
    })
    return 1
  }

  if (sql.includes('UPDATE "ot_delivery_provider_callback"')) {
    if (sql.includes('"replay_count" = LEAST')) {
      const [id, expected] = values
      const row = db.callbacks.find(
        (c) => c.id === id && c.disposition === "UNMATCHED" && c.resolvedAt === null && c.replayCount === expected,
      )
      if (!row) return 0
      row.replayCount = Number(row.replayCount) + 1
      return 1
    }
    if (sql.includes('"disposition_code" = NULL')) {
      const [, fulfillmentId, attemptNumber, resolvedAt, id] = values
      const row = db.callbacks.find((c) => c.id === id)
      if (!row) return 0
      Object.assign(row, { disposition: "APPLIED", dispositionCode: null, fulfillmentId, attemptNumber, resolvedAt })
      return 1
    }
    const [, code, fulfillmentId, attemptNumber, resolvedAt, id] = values
    const row = db.callbacks.find((c) => c.id === id)
    if (!row) return 0
    Object.assign(row, {
      disposition: "REFUSED", dispositionCode: code, fulfillmentId, attemptNumber,
      resolvedAt: row.resolvedAt ?? resolvedAt,
    })
    return 1
  }

  if (sql.includes('UPDATE "ot_delivery_attempt"')) {
    if (sql.includes('"download_capability_id" = ')) {
      const [capabilityId, fulfillmentId, attemptNumber] = values
      const attempt = db.attempts.find(
        (a) => a.fulfillmentId === fulfillmentId && a.attemptNumber === attemptNumber && a.downloadCapabilityId === null,
      )
      if (!attempt) return 0
      attempt.downloadCapabilityId = capabilityId
      return 1
    }
    if (sql.includes('"provider_message_id" = COALESCE')) {
      const messageId = values[0]
      const fulfillmentId = values[values.length - 2]
      const attemptNumber = values[values.length - 1]
      const attempt = db.attempts.find(
        (a) => a.fulfillmentId === fulfillmentId && a.attemptNumber === attemptNumber,
      )
      if (!attempt) return 0
      attempt.providerMessageId = attempt.providerMessageId ?? messageId
      return 1
    }
    return 1
  }

  if (sql.includes('UPDATE "ot_fulfillment"')) {
    if (sql.includes('SET "lease_owner" = NULL')) {
      const [, owner, token] = values
      if (db.fulfillment.leaseOwner !== owner || db.fulfillment.leaseToken !== token) return 0
      Object.assign(db.fulfillment, { leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
      return 1
    }
    if (sql.includes('SET "lease_owner"')) {
      const [owner, token, expiresAt] = values
      Object.assign(db.fulfillment, { leaseOwner: owner, leaseToken: token, leaseExpiresAt: expiresAt })
      return 1
    }
    if (sql.includes("'DELIVERY_PENDING'")) {
      const [nextRevision, attemptCount, , expectedStatus, expectedRevision] = values
      if (db.fulfillment.status !== expectedStatus || db.fulfillment.statusRevision !== expectedRevision)
        return 0
      Object.assign(db.fulfillment, { status: "DELIVERY_PENDING", statusRevision: nextRevision, attemptCount })
      return 1
    }
    // Generic status advance. The delivery store's form omits the `status`
    // predicate; the callback store's includes it.
    const withStatusPredicate = sql.includes('AND "status"::text = ')
    const [nextStatus, nextRevision] = values
    const expectedRevision = values[values.length - 1]
    const expectedStatus = withStatusPredicate ? values[values.length - 2] : null
    if (db.fulfillment.statusRevision !== expectedRevision) return 0
    if (withStatusPredicate && db.fulfillment.status !== expectedStatus) return 0
    Object.assign(db.fulfillment, { status: nextStatus, statusRevision: nextRevision })
    return 1
  }

  if (sql.includes('UPDATE "ot_packet_download_capability"')) {
    if (sql.includes('SET "use_count"')) {
      const [next, lastUsedAt, id, expected, now] = values
      const row = db.capabilities.find((c) => c.id === id)
      if (!row || row.useCount !== expected || row.revokedAt !== null) return 0
      if ((row.expiresAt as Date).getTime() <= (now as Date).getTime()) return 0
      Object.assign(row, { useCount: next, lastUsedAt })
      return 1
    }
    const [revokedAt, reason] = values
    const exceptId = sql.includes('"id" <> ') ? values[3] : null
    let revoked = 0
    for (const row of db.capabilities) {
      if (row.revokedAt === null && row.id !== exceptId) {
        Object.assign(row, { revokedAt, revokedReasonCode: reason })
        revoked += 1
      }
    }
    return revoked
  }
  throw new Error(`unexpected execute: ${sql}`)
}

function client() {
  const tx = {
    async $queryRaw<T>(q: Prisma.Sql): Promise<T> {
      return query(q.sql, q.values) as T
    },
    async $executeRaw(q: Prisma.Sql): Promise<number> {
      return execute(q.sql, q.values)
    },
  }
  return {
    async $transaction<T>(work: (t: typeof tx) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(db)
      try {
        return await work(tx)
      } catch (error) {
        db = snapshot
        throw error
      }
    },
    async $executeRaw(q: Prisma.Sql): Promise<number> {
      return execute(q.sql, q.values)
    },
    // The adapter's send-context reader queries outside a transaction.
    async $queryRaw<T>(q: Prisma.Sql): Promise<T> {
      return query(q.sql, q.values) as T
    },
  }
}

/* ── Provider and callback helpers ───────────────────────────────────────── */

function provider(
  options: { response?: { id: string | null; errorName: string | null }; onSend?: () => void | Promise<void> } = {},
): T2MailProvider {
  return {
    async send(message) {
      sentMessages.push(message as never)
      await options.onSend?.()
      return options.response ?? { id: "msg_synthetic_provider_1", errorName: null }
    },
  }
}

function deliver(mail: T2MailProvider) {
  const adapter = createT2ResendAdapter({
    env: ADAPTER_ENV,
    provider: mail,
    reader: contextReader,
    issuanceDeps: { store: packetStore },
    revoke: (input) => packetStore.revoke(input),
  })
  if (!adapter) throw new Error("adapter must construct under the synthetic config")
  return runT2Delivery(
    { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
    {
      env: { OT_T2_DELIVERY_ENABLED: "true" },
      store: deliveryStore,
      adapter,
      reconcile: ({ providerMessageId }) =>
        callbackStore.reconcile({ provider: RESEND_PROVIDER, providerMessageId }),
    },
  )
}

function callback(
  type: string,
  options: { messageId?: string; id?: string; at?: Date } = {},
) {
  const at = options.at ?? new Date()
  const body = JSON.stringify({
    type,
    created_at: new Date(at.getTime() - 1000).toISOString(),
    data: { email_id: options.messageId ?? "msg_synthetic_provider_1", to: [RECIPIENT] },
  })
  const id = options.id ?? `msg_envelope_${randomUUID()}`
  const signature = new SvixWebhook(SECRET).sign(id, at, body)
  return ingestT2ResendCallback(
    {
      rawBody: body,
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
        "svix-signature": signature,
      },
    },
    { env: CALLBACK_ENV, store: callbackStore, now: () => at },
  )
}

/** The code a customer pastes, submitted to the REAL download route. */
async function redeem(code: string) {
  return downloadPacket(
    new Request("https://www.overtaxed-il.com/api/ot/packet/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: code }),
    }) as unknown as import("next/server").NextRequest,
  )
}

/** Extract the pasted code from the fake provider's message body. */
function codeFromMessage(): string {
  const message = sentMessages.at(-1)
  if (!message) throw new Error("no message was handed to the provider")
  const match = message.text.match(/^[A-Za-z0-9_-]{43}$/m)
  if (!match) throw new Error("no one-time code in the message body")
  return match[0]
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  jest.clearAllMocks()
  db = freshDatabase()
  objects = new Map()
  sentMessages = []
  packetStore = createPrismaPacketDownloadStore(client() as never)
  deliveryStore = createPrismaT2DeliveryStore(client() as never)
  callbackStore = createPrismaProviderCallbackStore(client() as never)
  contextReader = createPrismaT2SendContextReader(client() as never)

  process.env.OT_T2_ARTIFACT_BINDING_ENABLED = "true"
  process.env.OT_T2_PRIVATE_STORAGE_ENABLED = "true"
  process.env.OT_T2_PACKET_DOWNLOAD_ENABLED = "true"
  process.env.OT_T2_DELIVERY_ENABLED = "true"

  jest.mocked(get).mockImplementation(async (locator) => {
    const bytes = objects.get(String(locator))
    return bytes
      ? ({
          statusCode: 200,
          blob: { pathname: locator, contentType: "application/pdf", size: bytes.length },
          stream: new ReadableStream({
            start(controller) { controller.enqueue(bytes); controller.close() },
          }),
        } as Awaited<ReturnType<typeof get>>)
      : null
  })
  jest.mocked(put).mockImplementation(async (locator, bytes) => {
    objects.set(locator, Buffer.from(bytes as Buffer))
    return { pathname: locator, contentType: "application/pdf" } as Awaited<ReturnType<typeof put>>
  })
  // Binding writes the immutable artifact row into the in-memory database.
  jest.mocked(prismaArtifactBindingStore.bind).mockImplementation(async (command) => {
    const digest = computeArtifactSha256(command.bytes)
    const existing = db.artifacts.find((a) => a.artifactSha256 === digest)
    if (existing) return { ok: true, created: false, artifactId: existing.id as string, artifactSha256: digest }
    const id = `art_${db.artifacts.length + 1}`
    db.artifacts.push({
      id, fulfillmentId: FULFILLMENT_ID, version: db.artifacts.length + 1,
      artifactSha256: digest, byteSize: command.bytes.byteLength,
      storageLocator: contentAddressedT2ArtifactLocator(digest),
      sourceOrderId: ORDER_ID,
      propertyBindingFingerprint: computePropertyBindingFingerprint({
        orderId: ORDER_ID, propertyPin: PIN, propertyAddress: ADDRESS,
      }),
      generatorVersion: command.provenance.generatorVersion,
      templateVersion: command.provenance.templateVersion ?? null,
    })
    return { ok: true, created: true, artifactId: id, artifactSha256: digest }
  })

  const bound = await runT2ArtifactBindingWorkflow({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID })
  expect(bound).toMatchObject({ outcome: "BOUND", created: true })
})

afterEach(() => { process.env = { ...ORIGINAL_ENV } })

/* ── The acceptance path ─────────────────────────────────────────────────── */

describe("settled paid T2 → bound packet → code → exact PDF", () => {
  it("delivers a redeemable code and returns the exact bound bytes", async () => {
    const artifact = currentArtifact()!
    const storedBytes = objects.get(artifact.storageLocator as string)!
    // The generated packet is a real, parseable PDF.
    expect((await PDFDocument.load(storedBytes)).getPageCount()).toBeGreaterThan(0)

    const result = await deliver(provider())
    expect(result).toMatchObject({ outcome: "ATTEMPTED", attemptNumber: 1, recorded: true, unresolved: false })

    // The attempt was durable BEFORE the send, and is bound to the code.
    expect(db.attempts).toHaveLength(1)
    expect(db.attempts[0]).toMatchObject({
      attemptNumber: 1, provider: "resend", artifactVersion: artifact.version,
      providerMessageId: "msg_synthetic_provider_1",
      downloadCapabilityId: db.capabilities[0].id,
    })

    // Provider acceptance, and ONLY provider acceptance.
    expect(db.fulfillment.status).toBe("PROVIDER_ACCEPTED")

    const code = codeFromMessage()
    const response = await redeem(code)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("cache-control")).toContain("no-store")

    const downloaded = Buffer.from(await response.arrayBuffer())
    // The exact digest of the immutable artifact the order is entitled to.
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(artifact.artifactSha256)
    expect(downloaded.equals(storedBytes)).toBe(true)
    expect((await PDFDocument.load(downloaded)).getPageCount()).toBeGreaterThan(0)
  })

  it("NEVER reports DELIVERED on provider acceptance alone", async () => {
    await deliver(provider())
    expect(db.fulfillment.status).toBe("PROVIDER_ACCEPTED")
    expect(db.events.map((e) => e.eventType)).toEqual(["REQUESTED", "ACCEPTED"])
    // Only an authenticated provider callback can say delivered.
    await expect(callback("email.delivered")).resolves.toMatchObject({
      ok: true,
      result: { outcome: "APPLIED", status: "DELIVERED" },
    })
    expect(db.fulfillment.status).toBe("DELIVERED")
  })

  it("keeps the code out of every durable row, the event log and the outcome", async () => {
    const result = await deliver(provider())
    const code = codeFromMessage()
    expect(code).toHaveLength(43)
    const durable = JSON.stringify({
      order: db.order, fulfillment: db.fulfillment, artifacts: db.artifacts,
      attempts: db.attempts, events: db.events, capabilities: db.capabilities,
      callbacks: db.callbacks,
    })
    expect(durable).not.toContain(code)
    expect(JSON.stringify(result)).not.toContain(code)
    // Only the digest is persisted.
    expect(db.capabilities[0].capabilityHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("puts a generic /packet URL in the message and never a token URL", async () => {
    await deliver(provider())
    const message = sentMessages[0]
    const code = codeFromMessage()
    for (const body of [message.text, message.html]) {
      for (const url of body.match(/https?:\/\/[^\s"<>]+/g) ?? []) {
        expect(url).toBe("https://www.overtaxed-il.com/packet")
        expect(url).not.toContain(code)
      }
    }
  })
})

describe("the callback-before-send-response race is closed without guessing", () => {
  it("stores an early event as unmatched, then applies it once the id is bound", async () => {
    // The provider reports `delivered` while the send call is still in flight.
    let early: Awaited<ReturnType<typeof callback>> | undefined
    await deliver(
      provider({
        onSend: async () => {
          early = await callback("email.delivered")
        },
      }),
    )
    // At the moment it arrived it was genuinely uncorrelatable, and was KEPT.
    expect(early).toEqual({ ok: true, result: { outcome: "UNMATCHED" } })
    // The reconciliation that runs once the message id is durably bound applied
    // it — no correlation tag was needed, assumed, or sent.
    expect(db.fulfillment.status).toBe("DELIVERED")
    expect(db.callbacks[0]).toMatchObject({ disposition: "APPLIED", attemptNumber: 1 })
  })

  it("never guesses an unmatched event onto an order", async () => {
    const unknownId = await callback("email.delivered", { messageId: "msg_never_sent_by_us" })
    expect(unknownId).toEqual({ ok: true, result: { outcome: "UNMATCHED" } })
    expect(db.fulfillment.status).toBe("ARTIFACT_READY")
    expect(db.events).toEqual([])
  })
})

describe("adversarial callbacks", () => {
  beforeEach(async () => {
    await deliver(provider())
  })

  it("ignores a replayed signed delivery", async () => {
    const id = "msg_envelope_fixed"
    const at = new Date()
    await expect(callback("email.delivered", { id, at })).resolves.toMatchObject({
      ok: true, result: { outcome: "APPLIED" },
    })
    const revision = db.fulfillment.statusRevision
    await expect(callback("email.delivered", { id, at })).resolves.toEqual({
      ok: true, result: { outcome: "DUPLICATE" },
    })
    expect(db.fulfillment.statusRevision).toBe(revision)
    expect(db.events.filter((e) => e.eventType === "DELIVERED")).toHaveLength(1)
  })

  it("refuses an unsigned callback outright", async () => {
    await expect(
      ingestT2ResendCallback(
        {
          rawBody: JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "msg_synthetic_provider_1" } }),
          headers: {},
        },
        { env: CALLBACK_ENV, store: callbackStore },
      ),
    ).resolves.toEqual({ ok: false, code: "INVALID_SIGNATURE" })
    expect(db.fulfillment.status).toBe("PROVIDER_ACCEPTED")
    expect(db.callbacks).toEqual([])
  })

  it("cannot resurrect a bounced fulfillment", async () => {
    await callback("email.bounced")
    expect(db.fulfillment.status).toBe("BOUNCED")
    // The code dies with the bounce.
    expect(db.capabilities[0].revokedAt).not.toBeNull()
    await expect(callback("email.delivered")).resolves.toMatchObject({
      ok: true, result: { outcome: "REFUSED", code: "TERMINAL_LOCKED" },
    })
    expect(db.fulfillment.status).toBe("BOUNCED")
  })

  it("refuses to serve a packet once delivery bounced", async () => {
    const code = codeFromMessage()
    await callback("email.bounced")
    const response = await redeem(code)
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "REVOKED" })
  })

  it("refuses an event about an order that has since been refunded", async () => {
    db.order.status = "REFUNDED"
    await expect(callback("email.delivered")).resolves.toMatchObject({
      ok: true, result: { outcome: "REFUSED", code: "INELIGIBLE_SETTLEMENT" },
    })
    // Recorded, never silently dropped.
    expect(db.callbacks[0]).toMatchObject({ disposition: "REFUSED", dispositionCode: "INELIGIBLE_SETTLEMENT" })
    expect(db.fulfillment.status).toBe("PROVIDER_ACCEPTED")
  })
})

describe("adversarial download", () => {
  beforeEach(async () => { await deliver(provider()) })

  it.each([
    ["a random value", "A".repeat(43)],
    ["a truncated code", "A".repeat(42)],
    ["a padded code", `${"A".repeat(43)}=`],
    ["an empty value", ""],
  ])("refuses %s", async (_label, value) => {
    const response = await redeem(value)
    expect([400, 404]).toContain(response.status)
  })

  it("refuses a refunded order mid-flight", async () => {
    const code = codeFromMessage()
    db.order.status = "REFUNDED"
    expect((await redeem(code)).status).toBe(404)
  })

  it("spends a bounded budget and then refuses", async () => {
    const code = codeFromMessage()
    for (let i = 0; i < 5; i++) expect((await redeem(code)).status).toBe(200)
    expect((await redeem(code)).status).toBe(410)
  })

  it("refuses once a newer artifact supersedes the bound one", async () => {
    const code = codeFromMessage()
    db.artifacts.push({ ...currentArtifact()!, id: "art_2", version: 2, artifactSha256: "c".repeat(64) })
    expect((await redeem(code)).status).toBe(404)
  })

  it("refuses when the stored bytes no longer match the bound digest", async () => {
    const code = codeFromMessage()
    const artifact = currentArtifact()!
    const damaged = Buffer.from(objects.get(artifact.storageLocator as string)!)
    damaged[20] ^= 1
    objects.set(artifact.storageLocator as string, damaged)
    const response = await redeem(code)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false, code: "TEMPORARILY_UNAVAILABLE" })
  })
})

describe("an ambiguous send is preserved, never resolved by guessing", () => {
  it("records nothing, leaves the summary unresolved, and refuses to retry", async () => {
    const result = await deliver(provider({ response: { id: null, errorName: "internal_server_error" } }))
    expect(result).toMatchObject({ outcome: "ATTEMPTED", recorded: false, unresolved: true })
    expect(db.fulfillment.status).toBe("DELIVERY_PENDING")
    expect(db.events.map((e) => e.eventType)).toEqual(["REQUESTED"])
    // The code stays live: the mail may have arrived.
    expect(db.capabilities[0].revokedAt).toBeNull()

    // A second dispatcher cannot claim an unresolved fulfillment at all.
    await expect(deliver(provider())).resolves.toEqual({ outcome: "NOT_CLAIMED" })
    expect(db.attempts).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
  })

  it("revokes the unsent code only on a DEFINITE rejection", async () => {
    await deliver(provider({ response: { id: null, errorName: "suppressed_recipient" } }))
    expect(db.fulfillment.status).toBe("FAILED")
    expect(db.capabilities[0]).toMatchObject({ revokedReasonCode: "SEND_REJECTED" })
    const response = await redeem(codeFromMessage())
    expect(response.status).toBe(410)
  })
})

describe("two dispatchers produce one attempt and one send", () => {
  it("serializes on the lease, so the loser sends nothing", async () => {
    const [first, second] = await Promise.all([deliver(provider()), deliver(provider())])
    const outcomes = [first.outcome, second.outcome].sort()
    expect(outcomes).toEqual(["ATTEMPTED", "NOT_CLAIMED"])
    expect(db.attempts).toHaveLength(1)
    expect(sentMessages).toHaveLength(1)
    expect(db.capabilities).toHaveLength(1)
  })
})

describe("the synthetic fixture never stands in for production policy", () => {
  it("the real producer still refuses the unsigned live policy", async () => {
    const actual: typeof generateT2Artifact = jest.requireActual(
      "@/lib/fulfillment-runtime/t2-artifact-producer",
    ).generateT2Artifact
    await expect(
      actual({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID }),
    ).resolves.toEqual({ ok: false, blocker: "ELIGIBILITY_POLICY_UNSIGNED" })
  })

  it("no real provider call, credential read, or network access occurred", () => {
    // The provider seam is a local object; the only "send" is a push onto an
    // array in this process.
    expect(sentMessages.every((m) => m.to === RECIPIENT)).toBe(true)
  })
})
