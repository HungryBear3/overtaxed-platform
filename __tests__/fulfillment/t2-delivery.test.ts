/**
 * @jest-environment node
 *
 * Bounded, default-off delivery: the pure dispatch/outcome decisions, the store's
 * real SQL through a fake Prisma adapter, and the orchestrator's ordering.
 *
 * The three properties every assertion here is protecting:
 *   - the attempt is durable BEFORE the send;
 *   - provider "accepted" is not "delivered";
 *   - an unknown outcome is never automatically resent, and a terminal state is
 *     never resurrected.
 */
import type { Prisma } from "@prisma/client"
import {
  decideDeliveryDispatch,
  decideSendOutcomeRecord,
  type DeliverySendOutcome,
} from "@/lib/fulfillment/delivery-orchestration"
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
} from "@/lib/fulfillment/artifact-digest"
import { FULFILLMENT_STATUSES, TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types"
import {
  T2_MAX_DELIVERY_ATTEMPTS,
  T2_MAX_LEASE_MS,
  T2_MIN_LEASE_MS,
  createPrismaT2DeliveryStore,
  type T2DeliveryClient,
  type T2DeliveryStore,
  type T2DeliveryTransaction,
} from "@/lib/fulfillment-runtime/delivery-store"
import {
  T2_DELIVERY_LEASE_MS,
  runT2Delivery,
  type T2DeliveryAdapter,
} from "@/lib/fulfillment-runtime/t2-delivery-orchestrator"

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const sha = computeArtifactSha256(Buffer.from("%PDF-1.7 bound evidence\n"))
const NOW = "2026-09-12T12:00:00.000Z"
const PROPERTY_PIN = "12345678901234"
const PROPERTY_ADDRESS = "100 Evidence Lane, Chicago IL"
const FINGERPRINT = computePropertyBindingFingerprint({
  orderId: ORDER_ID,
  propertyPin: PROPERTY_PIN,
  propertyAddress: PROPERTY_ADDRESS,
})
/** A lease this test process holds, as the fulfillment row would record it. */
const OWNER = "ot-t2-delivery:test-owner"
const TOKEN = "tok-test-owner"
const held = { owner: OWNER, token: TOKEN }

const dispatch = {
  flagEnabled: true,
  orderId: ORDER_ID,
  fulfillmentId: FULFILLMENT_ID,
  status: "ARTIFACT_READY",
  statusRevision: 3,
  attemptCount: 0,
  maxAttempts: T2_MAX_DELIVERY_ATTEMPTS,
  provider: "resend",
  artifactVersion: 1,
  artifactSha256: sha,
  generatorVersion: "t2-generator-v1",
  templateVersion: "t2-template-v1",
}

describe("dispatch decisions reuse the existing send authority", () => {
  it("plans an attempt that writes BEFORE any send", () => {
    const decision = decideDeliveryDispatch(dispatch)
    expect(decision).toMatchObject({
      ok: true,
      plan: {
        attemptNumber: 1,
        artifactVersion: 1,
        provider: "resend",
        purpose: "DELIVERY",
        fromStatus: "ARTIFACT_READY",
        nextStatus: "DELIVERY_PENDING",
        expectedStatusRevision: 3,
        requestEventType: "REQUESTED",
      },
    })
    if (!decision.ok) throw new Error("unreachable")
    // The key is the existing single-sourced contract, not a new one.
    expect(decision.plan.idempotencyKey).toContain("purpose=DELIVERY")
    expect(decision.plan.idempotencyKey).toContain(`sha=${sha}`)
  })

  it("treats a retry from DELAYED as a send of the SAME artifact version", () => {
    const decision = decideDeliveryDispatch({
      ...dispatch,
      status: "DELAYED",
      attemptCount: 1,
    })
    expect(decision).toMatchObject({
      ok: true,
      plan: { attemptNumber: 2, artifactVersion: 1 },
    })
  })

  it("refuses an unresolved in-flight send rather than risking a duplicate", () => {
    for (const status of ["DELIVERY_PENDING", "PROVIDER_ACCEPTED"]) {
      expect(decideDeliveryDispatch({ ...dispatch, status })).toEqual({
        ok: false,
        blocker: "UNRESOLVED_SEND",
      })
    }
  })

  it.each([...TERMINAL_LOCK_STATUSES])("refuses terminal %s", (status) => {
    expect(decideDeliveryDispatch({ ...dispatch, status })).toEqual({
      ok: false,
      blocker: `TERMINAL_${status}`,
    })
  })

  it("refuses a second send once delivery is confirmed", () => {
    expect(decideDeliveryDispatch({ ...dispatch, status: "DELIVERED" })).toEqual({
      ok: false,
      blocker: "ALREADY_DELIVERED",
    })
  })

  it("respects the bounded attempt budget", () => {
    expect(
      decideDeliveryDispatch({
        ...dispatch,
        status: "DELAYED",
        attemptCount: T2_MAX_DELIVERY_ATTEMPTS,
      }),
    ).toEqual({ ok: false, blocker: "MAX_ATTEMPTS" })
  })

  it.each([
    ["a disabled flag", { flagEnabled: false }, "FLAG_DISABLED"],
    ["a malformed provider", { provider: "res end" }, "INVALID_PROVIDER"],
    ["a malformed digest", { artifactSha256: "NOTHEX" }, "INVALID_ARTIFACT_SHA256"],
    ["a zero artifact version", { artifactVersion: 0 }, "INVALID_ARTIFACT_VERSION"],
    ["a negative revision", { statusRevision: -1 }, "INVALID_STATUS_REVISION"],
  ])("refuses %s", (_label, patch, blocker) => {
    expect(decideDeliveryDispatch({ ...dispatch, ...patch })).toEqual({ ok: false, blocker })
  })

  it("never plans a send from a pre-artifact status", () => {
    for (const status of FULFILLMENT_STATUSES) {
      const decision = decideDeliveryDispatch({ ...dispatch, status })
      if (status === "ARTIFACT_READY" || status === "DELAYED") {
        expect(decision.ok).toBe(true)
      } else {
        expect(decision.ok).toBe(false)
      }
    }
  })
})

describe("send outcomes: accepted is not delivered, unknown is not failure", () => {
  it("folds an accepted send to PROVIDER_ACCEPTED and never to DELIVERED", () => {
    expect(
      decideSendOutcomeRecord({
        status: "DELIVERY_PENDING",
        outcome: { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
        occurredAt: NOW,
      }),
    ).toEqual({
      ok: true,
      record: {
        eventType: "ACCEPTED",
        nextStatus: "PROVIDER_ACCEPTED",
        providerMessageId: "msg_1",
        reasonCode: null,
        resendAllowed: false,
        unresolved: false,
      },
    })
  })

  it("records NOTHING for an unknown outcome, leaving the send unresolved", () => {
    expect(
      decideSendOutcomeRecord({
        status: "DELIVERY_PENDING",
        outcome: { kind: "UNKNOWN", provider: "resend" },
        occurredAt: NOW,
      }),
    ).toEqual({
      ok: true,
      record: {
        eventType: null,
        nextStatus: null,
        providerMessageId: null,
        reasonCode: null,
        resendAllowed: false,
        unresolved: true,
      },
    })
  })

  it("leaves an unresolved send un-retryable by the send authority", () => {
    // DELIVERY_PENDING is exactly what an unknown outcome leaves behind.
    expect(decideDeliveryDispatch({ ...dispatch, status: "DELIVERY_PENDING" })).toEqual({
      ok: false,
      blocker: "UNRESOLVED_SEND",
    })
  })

  it("folds an explicit provider rejection to terminal FAILED", () => {
    expect(
      decideSendOutcomeRecord({
        status: "DELIVERY_PENDING",
        outcome: { kind: "REJECTED", provider: "resend", reasonCode: "INVALID_RECIPIENT" },
        occurredAt: NOW,
      }),
    ).toMatchObject({ ok: true, record: { eventType: "FAILED", nextStatus: "FAILED" } })
  })

  it("never authorizes an automatic resend for any outcome", () => {
    const outcomes: DeliverySendOutcome[] = [
      { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
      { kind: "REJECTED", provider: "resend", reasonCode: "HARD_BOUNCE" },
      { kind: "UNKNOWN", provider: "resend" },
    ]
    for (const outcome of outcomes) {
      const decision = decideSendOutcomeRecord({
        status: "DELIVERY_PENDING",
        outcome,
        occurredAt: NOW,
      })
      expect(decision).toMatchObject({ ok: true, record: { resendAllowed: false } })
    }
  })

  it.each([...TERMINAL_LOCK_STATUSES])(
    "refuses to write any outcome against terminal %s",
    (status) => {
      expect(
        decideSendOutcomeRecord({
          status,
          outcome: { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
          occurredAt: NOW,
        }),
      ).toEqual({ ok: false, blocker: "OUTCOME_NOT_APPLICABLE" })
    },
  )

  it.each([
    ["free-form provider text as a reason", { kind: "REJECTED", provider: "resend", reasonCode: "550 mailbox unavailable" }, "INVALID_REASON_CODE"],
    ["a malformed provider", { kind: "UNKNOWN", provider: "re send" }, "INVALID_PROVIDER"],
    ["a newline-bearing message id", { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg\n1" }, "INVALID_PROVIDER_MESSAGE_ID"],
  ])("refuses %s", (_label, outcome, blocker) => {
    expect(
      decideSendOutcomeRecord({
        status: "DELIVERY_PENDING",
        outcome: outcome as DeliverySendOutcome,
        occurredAt: NOW,
      }),
    ).toEqual({ ok: false, blocker })
  })
})

type OrderFixture = {
  id: string
  status: string
  tier: string
  propertyPin: string | null
  propertyAddress: string | null
}

type World = {
  now: string
  order: OrderFixture | null
  summary: Record<string, unknown> | null
  artifact: Record<string, unknown> | null
  attempts: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  sql: string[]
  /** Forces every status compare-and-set to lose, as a concurrent writer would. */
  casMiss?: boolean
  /** Set by the fake transaction when it unwinds, so rollback is observable. */
  rolledBack?: boolean
}

function order(patch: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: ORDER_ID,
    status: "PAID",
    tier: "T2",
    propertyPin: PROPERTY_PIN,
    propertyAddress: PROPERTY_ADDRESS,
    ...patch,
  }
}

function world(patch: Partial<World> = {}): World {
  return {
    now: NOW,
    order: order(),
    summary: {
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_READY",
      statusRevision: 3,
      attemptCount: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
    artifact: {
      version: 1,
      artifactSha256: sha,
      generatorVersion: "t2-generator-v1",
      templateVersion: "t2-template-v1",
      sourceOrderId: ORDER_ID,
      propertyBindingFingerprint: FINGERPRINT,
    },
    attempts: [],
    events: [],
    sql: [],
    ...patch,
  }
}

/** A world whose fulfillment row already records a live lease held by us. */
function leasedWorld(patch: Partial<World> = {}): World {
  const state = world(patch)
  if (state.summary) {
    state.summary.leaseOwner = OWNER
    state.summary.leaseToken = TOKEN
    state.summary.leaseExpiresAt = "2026-09-12T12:05:00.000Z"
  }
  return state
}

function fakeClient(state: World): T2DeliveryClient {
  const tx: T2DeliveryTransaction = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      state.sql.push(sql)
      if (sql.includes("clock_timestamp()")) return [{ now: state.now }] as T
      if (sql.includes('FROM "ot_order"')) return (state.order ? [state.order] : []) as T
      if (sql.includes('FROM "ot_fulfillment_artifact"'))
        return (state.artifact ? [state.artifact] : []) as T
      if (sql.includes('FROM "ot_fulfillment"'))
        return (state.summary ? [state.summary] : []) as T
      if (sql.includes('FROM "ot_delivery_attempt"')) {
        // WHERE "fulfillment_id" = $1 AND "attempt_number" = $2
        const wanted = query.values[1]
        return state.attempts.filter((a) => a.attemptNumber === wanted) as T
      }
      if (sql.includes('FROM "ot_delivery_event"')) {
        const max = state.events.reduce(
          (best, event) => Math.max(best, Number(event.sequence)),
          0,
        )
        return [{ next: max + 1 }] as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const sql = query.sql
      state.sql.push(sql)
      if (sql.includes('INSERT INTO "ot_delivery_attempt"')) {
        state.attempts.push({
          id: query.values[0],
          attemptNumber: query.values[2],
          artifactVersion: query.values[3],
          idempotencyKey: query.values[4],
          provider: query.values[5],
          providerAcceptedAt: null,
          failedAt: null,
        })
        return 1
      }
      if (sql.includes('INSERT INTO "ot_delivery_event"')) {
        state.events.push({
          attemptNumber: query.values[2],
          eventType: query.values[5],
          sequence: query.values[6],
        })
        return 1
      }
      if (sql.includes('UPDATE "ot_delivery_attempt"')) {
        const attempt = state.attempts[state.attempts.length - 1]
        if (!attempt) return 0
        // SET … CASE WHEN $accepted … — enough fidelity for the pre-send gate,
        // which refuses an attempt that already carries any outcome.
        if (query.values.includes(true)) attempt.providerAcceptedAt = NOW
        else attempt.failedAt = NOW
        return 1
      }
      if (sql.includes("'DELIVERY_PENDING'")) {
        if (state.casMiss) return 0
        // SET "status_revision" = $1, "attempt_count" = $2
        // WHERE "id" = $3 AND "status"::text = $4 AND "status_revision" = $5
        //   AND "lease_owner" = $6 AND "lease_token" = $7
        //   AND "lease_expires_at" > $8
        const summary = state.summary
        if (!summary) return 0
        const [
          nextRevision,
          attemptCount,
          ,
          expectedStatus,
          expectedRevision,
          leaseOwner,
          leaseToken,
          leaseFloor,
        ] = query.values
        if (
          summary.status !== expectedStatus ||
          summary.statusRevision !== expectedRevision
        ) {
          return 0
        }
        // The write is conditional on the lease too, not just the revision.
        if (
          summary.leaseOwner !== leaseOwner ||
          summary.leaseToken !== leaseToken ||
          !(
            summary.leaseExpiresAt !== null &&
            new Date(summary.leaseExpiresAt as string | Date).getTime() >
              (leaseFloor as Date).getTime()
          )
        ) {
          return 0
        }
        summary.status = "DELIVERY_PENDING"
        summary.statusRevision = nextRevision
        summary.attemptCount = attemptCount
        return 1
      }
      if (sql.includes('UPDATE "ot_fulfillment"') && sql.includes('SET "status"')) {
        if (state.casMiss) return 0
        // SET "status" = $1, "status_revision" = $2, "last_reason_code" = $3
        // WHERE "id" = $4 AND "status_revision" = $5
        const summary = state.summary
        if (!summary) return 0
        const [nextStatus, nextRevision, , , expectedRevision] = query.values
        if (summary.statusRevision !== expectedRevision) return 0
        summary.status = nextStatus
        summary.statusRevision = nextRevision
        return 1
      }
      if (sql.includes('SET "lease_owner" = NULL')) {
        // WHERE "id" = $1 AND "lease_owner" = $2 AND "lease_token" = $3
        const summary = state.summary
        if (!summary) return 0
        const [, owner, token] = query.values
        if (summary.leaseOwner !== owner || summary.leaseToken !== token) return 0
        summary.leaseOwner = null
        summary.leaseToken = null
        summary.leaseExpiresAt = null
        return 1
      }
      if (sql.includes('SET "lease_owner"')) {
        // SET "lease_owner" = $1, "lease_token" = $2, "lease_expires_at" = $3
        // WHERE "id" = $4 AND "status" IN (…)
        //   AND (lease absent OR expired at $5 OR already ours)
        const summary = state.summary
        if (!summary) return 0
        const [owner, token, expiresAt, , floor] = query.values
        if (
          summary.status !== "ARTIFACT_READY" &&
          summary.status !== "DELAYED"
        ) {
          return 0
        }
        const live =
          summary.leaseOwner !== null &&
          summary.leaseExpiresAt !== null &&
          new Date(summary.leaseExpiresAt as string | Date).getTime() >
            (floor as Date).getTime()
        if (live && (summary.leaseOwner !== owner || summary.leaseToken !== token))
          return 0
        summary.leaseOwner = owner
        summary.leaseToken = token
        summary.leaseExpiresAt = expiresAt
        return 1
      }
      throw new Error(`unexpected execute: ${sql}`)
    },
  }
  return {
    async $transaction<T>(work: (t: T2DeliveryTransaction) => Promise<T>): Promise<T> {
      // A throw out of the callback unwinds PostgreSQL's transaction, so the
      // fake restores the pre-transaction snapshot rather than keeping partial
      // writes. Without this, a test cannot tell a rolled-back attempt row from
      // a committed one.
      const snapshot = structuredClone(state)
      try {
        return await work(tx)
      } catch (error) {
        Object.assign(state, snapshot, { rolledBack: true })
        throw error
      }
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      return tx.$executeRaw(query)
    },
  }
}

const PRIOR = process.env.OT_T2_DELIVERY_ENABLED
beforeEach(() => {
  process.env.OT_T2_DELIVERY_ENABLED = "true"
})
afterAll(() => {
  if (PRIOR === undefined) delete process.env.OT_T2_DELIVERY_ENABLED
  else process.env.OT_T2_DELIVERY_ENABLED = PRIOR
})

describe("the store persists an attempt before any send is possible", () => {
  it("writes the attempt, its REQUESTED event, and the transition in one pass", async () => {
    const state = leasedWorld()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    const persisted = await store.persistAttempt({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      provider: "resend",
      ...held,
    })
    expect(persisted).toMatchObject({ ok: true, attemptNumber: 1, artifactVersion: 1 })
    expect(state.attempts).toHaveLength(1)
    expect(state.events).toEqual([
      { attemptNumber: 1, eventType: "REQUESTED", sequence: 1 },
    ])
    expect(state.summary).toMatchObject({
      status: "DELIVERY_PENDING",
      statusRevision: 4,
      attemptCount: 1,
    })
  })

  it("holds no recipient address and names only a provider", async () => {
    const state = leasedWorld()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await store.persistAttempt({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      provider: "resend",
      ...held,
    })
    expect(JSON.stringify(state.attempts)).not.toMatch(/@/)
    expect(state.attempts[0]).toMatchObject({ provider: "resend" })
  })

  it("refuses a refunded order under the lock without writing", async () => {
    const state = leasedWorld({ order: order({ status: "REFUNDED" }) })
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await expect(
      store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held }),
    ).resolves.toEqual({ ok: false, blocker: "INELIGIBLE_SETTLEMENT" })
    expect(state.attempts).toHaveLength(0)
    expect(state.summary).toMatchObject({ status: "ARTIFACT_READY" })
  })

  it("refuses when no artifact is bound", async () => {
    const state = leasedWorld({ artifact: null })
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await expect(
      store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held }),
    ).resolves.toEqual({ ok: false, blocker: "ARTIFACT_NOT_FOUND" })
    expect(state.attempts).toHaveLength(0)
  })

  it("refuses a second concurrent attempt once the summary has moved on", async () => {
    const state = leasedWorld()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held })
    await expect(
      store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held }),
    ).resolves.toEqual({ ok: false, blocker: "UNRESOLVED_SEND" })
    expect(state.attempts).toHaveLength(1)
  })

  it("makes no database call while the flag is not exactly true", async () => {
    delete process.env.OT_T2_DELIVERY_ENABLED
    const state = leasedWorld()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await expect(
      store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held }),
    ).resolves.toEqual({ ok: false, blocker: "FLAG_DISABLED" })
    expect(state.sql).toHaveLength(0)
  })
})

describe("the store records outcomes without over-claiming", () => {
  async function pending(state: World) {
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await store.persistAttempt({ orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID, provider: "resend", ...held })
    return store
  }

  it("advances an accepted send to PROVIDER_ACCEPTED, never DELIVERED", async () => {
    const state = leasedWorld()
    const store = await pending(state)
    await expect(
      store.recordOutcome({
        orderId: ORDER_ID,
        fulfillmentId: FULFILLMENT_ID,
        attemptNumber: 1,
        outcome: { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
      }),
    ).resolves.toEqual({
      ok: true,
      recorded: true,
      unresolved: false,
      status: "PROVIDER_ACCEPTED",
    })
    expect(state.summary).toMatchObject({ status: "PROVIDER_ACCEPTED" })
    expect(state.events.map((e) => e.eventType)).toEqual(["REQUESTED", "ACCEPTED"])
  })

  it("writes nothing for an unknown outcome and leaves the send unresolved", async () => {
    const state = leasedWorld()
    const store = await pending(state)
    const eventsBefore = state.events.length
    await expect(
      store.recordOutcome({
        orderId: ORDER_ID,
        fulfillmentId: FULFILLMENT_ID,
        attemptNumber: 1,
        outcome: { kind: "UNKNOWN", provider: "resend" },
      }),
    ).resolves.toEqual({
      ok: true,
      recorded: false,
      unresolved: true,
      status: "DELIVERY_PENDING",
    })
    expect(state.events).toHaveLength(eventsBefore)
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
  })

  it("assigns strictly increasing local sequence numbers", async () => {
    const state = leasedWorld()
    const store = await pending(state)
    await store.recordOutcome({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      attemptNumber: 1,
      outcome: { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
    })
    expect(state.events.map((e) => e.sequence)).toEqual([1, 2])
  })
})

describe("the orchestrator is bounded and default-off", () => {
  const adapter = (outcome: DeliverySendOutcome | Error): T2DeliveryAdapter => ({
    provider: "resend",
    send: jest.fn(async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    }),
  })

  function storeSpy(state: World): T2DeliveryStore {
    return createPrismaT2DeliveryStore(fakeClient(state))
  }

  it("does nothing at all while the flag is not exactly true", async () => {
    const state = world()
    const send = adapter({ kind: "ACCEPTED", provider: "resend", providerMessageId: "m" })
    await expect(
      runT2Delivery(
        { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
        { env: {}, store: storeSpy(state), adapter: send },
      ),
    ).resolves.toEqual({ outcome: "DISABLED" })
    expect(state.sql).toHaveLength(0)
    expect(send.send).not.toHaveBeenCalled()
  })

  it("reports the missing provider adapter as an explicit blocker, writing nothing", async () => {
    const state = world()
    await expect(
      runT2Delivery(
        { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
        { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state) },
      ),
    ).resolves.toEqual({ outcome: "BLOCKED", blocker: "NO_DELIVERY_ADAPTER" })
    expect(state.sql).toHaveLength(0)
    expect(state.attempts).toHaveLength(0)
  })

  it("persists the attempt BEFORE calling the adapter", async () => {
    const state = world()
    const order: string[] = []
    const send: T2DeliveryAdapter = {
      provider: "resend",
      send: async () => {
        order.push(`send:attempts=${state.attempts.length}`)
        return { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" }
      },
    }
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state), adapter: send },
    )
    expect(result).toMatchObject({ outcome: "ATTEMPTED", attemptNumber: 1, recorded: true })
    // The attempt was already durable when the adapter ran.
    expect(order).toEqual(["send:attempts=1"])
    expect(state.summary).toMatchObject({ status: "PROVIDER_ACCEPTED" })
  })

  it("treats a thrown adapter as UNKNOWN, recording nothing and resending nothing", async () => {
    const state = world()
    const send = adapter(new Error("private provider detail"))
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state), adapter: send },
    )
    expect(result).toMatchObject({ outcome: "ATTEMPTED", recorded: false, unresolved: true })
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
    expect(state.events.map((e) => e.eventType)).toEqual(["REQUESTED"])

    // A second invocation must refuse rather than risk a duplicate.
    const again = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state), adapter: send },
    )
    expect(again).toEqual({ outcome: "NOT_CLAIMED" })
    expect(state.attempts).toHaveLength(1)
  })

  it("refuses to claim a terminal fulfillment, so nothing resurrects it", async () => {
    const state = world({
      summary: {
        id: FULFILLMENT_ID,
        orderId: ORDER_ID,
        kind: "T2_APPEAL_EVIDENCE",
        status: "BOUNCED",
        statusRevision: 7,
        attemptCount: 1,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    const send = adapter({ kind: "ACCEPTED", provider: "resend", providerMessageId: "m" })
    await expect(
      runT2Delivery(
        { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
        { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state), adapter: send },
      ),
    ).resolves.toEqual({ outcome: "NOT_CLAIMED" })
    expect(send.send).not.toHaveBeenCalled()
    expect(state.attempts).toHaveLength(0)
  })

  it("takes a namespaced in-process lease and releases it afterwards", async () => {
    const state = world()
    const owners: unknown[] = []
    const send: T2DeliveryAdapter = {
      provider: "resend",
      send: async () => {
        // Observed mid-flight: the lease is held by an identity this process
        // generated, never one a caller supplied.
        owners.push(state.summary?.leaseOwner)
        return { kind: "ACCEPTED", provider: "resend", providerMessageId: "m" }
      },
    }
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store: storeSpy(state), adapter: send },
    )
    expect(String(owners[0])).toMatch(/^ot-t2-delivery:/)
    expect(result).toMatchObject({ outcome: "ATTEMPTED", released: true })
    expect(state.summary?.leaseOwner).toBeNull()
  })
})

describe("a lease is proved against the database, never against a caller", () => {
  const claim = (state: World, patch: Record<string, unknown> = {}) =>
    createPrismaT2DeliveryStore(fakeClient(state)).claim({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      owner: OWNER,
      token: TOKEN,
      leaseMs: T2_DELIVERY_LEASE_MS,
      ...patch,
    })

  it("derives the expiry from the DB clock, not from any caller instant", async () => {
    const state = world({ now: "2026-09-12T12:00:00.000Z" })
    await expect(claim(state)).resolves.toBe(true)
    expect(new Date(state.summary?.leaseExpiresAt as Date).toISOString()).toBe(
      new Date(Date.parse("2026-09-12T12:00:00.000Z") + T2_DELIVERY_LEASE_MS).toISOString(),
    )
  })

  it.each([
    ["below the floor", T2_MIN_LEASE_MS - 1],
    ["above the ceiling", T2_MAX_LEASE_MS + 1],
    ["non-integer", 60_000.5],
    ["negative", -1],
  ])("refuses a %s lease duration without touching the database", async (_label, leaseMs) => {
    const state = world()
    await expect(claim(state, { leaseMs })).resolves.toBe(false)
    expect(state.sql).toHaveLength(0)
    expect(state.summary?.leaseOwner).toBeNull()
  })

  it("refuses a live lease held by someone else, measured by the DB clock", async () => {
    const state = leasedWorld()
    await expect(
      claim(state, { owner: "ot-t2-delivery:other", token: "tok-other" }),
    ).resolves.toBe(false)
    expect(state.summary?.leaseOwner).toBe(OWNER)
  })

  it("reclaims a lease the DB clock says has expired", async () => {
    const state = leasedWorld()
    if (state.summary) state.summary.leaseExpiresAt = "2026-09-12T11:59:00.000Z"
    await expect(
      claim(state, { owner: "ot-t2-delivery:other", token: "tok-other" }),
    ).resolves.toBe(true)
    expect(state.summary?.leaseOwner).toBe("ot-t2-delivery:other")
  })

  it("refuses to persist an attempt with no lease at all", async () => {
    const state = world()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await expect(
      store.persistAttempt({
        orderId: ORDER_ID,
        fulfillmentId: FULFILLMENT_ID,
        provider: "resend",
        ...held,
      }),
    ).resolves.toEqual({ ok: false, blocker: "LEASE_NOT_HELD" })
    expect(state.attempts).toHaveLength(0)
    expect(state.summary).toMatchObject({ status: "ARTIFACT_READY" })
  })

  it.each([
    ["an expired lease", { leaseExpiresAt: "2026-09-12T11:59:00.000Z" }],
    ["another worker's lease", { leaseOwner: "ot-t2-delivery:other" }],
    ["a stolen token", { leaseToken: "tok-stolen" }],
  ])("refuses to persist an attempt under %s", async (_label, patch) => {
    const state = leasedWorld()
    Object.assign(state.summary as Record<string, unknown>, patch)
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await expect(
      store.persistAttempt({
        orderId: ORDER_ID,
        fulfillmentId: FULFILLMENT_ID,
        provider: "resend",
        ...held,
      }),
    ).resolves.toEqual({ ok: false, blocker: "LEASE_NOT_HELD" })
    expect(state.attempts).toHaveLength(0)
  })
})

describe("the persist refuses untrusted artifact and property drift", () => {
  const persist = (state: World) =>
    createPrismaT2DeliveryStore(fakeClient(state)).persistAttempt({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      provider: "resend",
      ...held,
    })

  it("refuses an artifact bound to a different order", async () => {
    const state = leasedWorld()
    if (state.artifact) state.artifact.sourceOrderId = "ord_someone_else"
    await expect(persist(state)).resolves.toEqual({
      ok: false,
      blocker: "ARTIFACT_SOURCE_ORDER_MISMATCH",
    })
    expect(state.attempts).toHaveLength(0)
  })

  it.each([
    ["a missing fingerprint", { propertyBindingFingerprint: null }],
    ["a drifted fingerprint", { propertyBindingFingerprint: sha }],
  ])("refuses %s", async (_label, patch) => {
    const state = leasedWorld()
    Object.assign(state.artifact as Record<string, unknown>, patch)
    await expect(persist(state)).resolves.toEqual({
      ok: false,
      blocker: "PROPERTY_BINDING_UNVERIFIED",
    })
    expect(state.attempts).toHaveLength(0)
  })

  it("refuses when the order's property no longer matches the packet", async () => {
    const state = leasedWorld({ order: order({ propertyPin: "99999999999999" }) })
    await expect(persist(state)).resolves.toEqual({
      ok: false,
      blocker: "PROPERTY_BINDING_UNVERIFIED",
    })
    expect(state.attempts).toHaveLength(0)
  })

  it("reports the binding the attempt was persisted against", async () => {
    const state = leasedWorld()
    await expect(persist(state)).resolves.toMatchObject({
      ok: true,
      sourceOrderId: ORDER_ID,
      propertyBindingFingerprint: FINGERPRINT,
      provider: "resend",
    })
  })
})

describe("the pre-send gate re-reads authority after the durable attempt", () => {
  /** Persist an attempt exactly as the orchestrator would, then hand back both. */
  async function pending(state: World) {
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    await store.claim({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      owner: OWNER,
      token: TOKEN,
      leaseMs: T2_DELIVERY_LEASE_MS,
    })
    const persisted = await store.persistAttempt({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      provider: "resend",
      ...held,
    })
    if (!persisted.ok) throw new Error(`unexpected refusal: ${persisted.blocker}`)
    const assertion = {
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      ...held,
      attemptId: persisted.attemptId,
      attemptNumber: persisted.attemptNumber,
      idempotencyKey: persisted.idempotencyKey,
      provider: persisted.provider,
      artifactVersion: persisted.artifactVersion,
      artifactSha256: persisted.artifactSha256,
      propertyBindingFingerprint: persisted.propertyBindingFingerprint,
      statusRevision: persisted.statusRevision,
    }
    return { store, assertion }
  }

  it("permits the send while every authority still holds", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    await expect(store.assertSendable(assertion)).resolves.toEqual({ ok: true })
  })

  it("denies a send after a refund lands during the gap", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    state.order = order({ status: "REFUNDED" })
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "INELIGIBLE_SETTLEMENT",
    })
    // Read-only: the refusal wrote nothing and resolved nothing.
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
    expect(state.events.map((e) => e.eventType)).toEqual(["REQUESTED"])
  })

  it("denies a send after the property binding drifts during the gap", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    state.order = order({ propertyAddress: "200 Somewhere Else, Chicago IL" })
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "PROPERTY_BINDING_UNVERIFIED",
    })
  })

  it("denies a send after a NEWER artifact version supersedes this one", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    if (state.artifact) state.artifact.version = 2
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "ARTIFACT_IDENTITY_MISMATCH",
    })
  })

  it.each([
    ["the lease expired", { leaseExpiresAt: "2026-09-12T11:00:00.000Z" }],
    ["the lease was stolen", { leaseOwner: "ot-t2-delivery:other" }],
  ])("denies a send once %s", async (_label, patch) => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    Object.assign(state.summary as Record<string, unknown>, patch)
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "LEASE_NOT_HELD",
    })
  })

  it("denies a send when the summary moved on under us", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    ;(state.summary as Record<string, unknown>).statusRevision = 99
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "DELIVERY_ATTEMPT_CONFLICT",
    })
  })

  it.each([
    ["a different attempt row id", { attemptId: "att_other" }],
    ["a different idempotency key", { idempotencyKey: "purpose=DELIVERY;forged" }],
    ["a different provider", { provider: "postmark" }],
  ])("denies a send presenting %s", async (_label, patch) => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    await expect(
      store.assertSendable({ ...assertion, ...patch }),
    ).resolves.toEqual({ ok: false, blocker: "ATTEMPT_IDENTITY_MISMATCH" })
  })

  it("denies a send for an attempt something else already resolved", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    await store.recordOutcome({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      attemptNumber: 1,
      outcome: { kind: "ACCEPTED", provider: "resend", providerMessageId: "msg_1" },
    })
    const result = await store.assertSendable(assertion)
    expect(result.ok).toBe(false)
    // Either the summary already moved off DELIVERY_PENDING or the attempt row
    // carries an outcome; both are refusals, and neither may send again.
    if (!result.ok)
      expect(["NOT_PENDING_SEND", "ATTEMPT_ALREADY_RESOLVED"]).toContain(result.blocker)
  })

  it("denies a send while the flag is not exactly true, reading nothing", async () => {
    const state = leasedWorld()
    const { store, assertion } = await pending(state)
    delete process.env.OT_T2_DELIVERY_ENABLED
    const before = state.sql.length
    await expect(store.assertSendable(assertion)).resolves.toEqual({
      ok: false,
      blocker: "FLAG_DISABLED",
    })
    expect(state.sql).toHaveLength(before)
  })
})

describe("the orchestrator never sends once authority has lapsed", () => {
  const accepted: DeliverySendOutcome = {
    kind: "ACCEPTED",
    provider: "resend",
    providerMessageId: "msg_1",
  }

  /** Wrap the real store so a change can land in the persist→send gap. */
  function storeWithGap(
    state: World,
    duringGap: () => void,
    overrides: Partial<T2DeliveryStore> = {},
  ): T2DeliveryStore {
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    return {
      ...store,
      async persistAttempt(input) {
        const result = await store.persistAttempt(input)
        duringGap()
        return result
      },
      ...overrides,
    }
  }

  it("does not call the adapter when a refund lands after the durable attempt", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store: storeWithGap(state, () => {
          state.order = order({ status: "REFUNDED" })
        }),
        adapter: { provider: "resend", send },
      },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      outcome: "SEND_DENIED",
      attemptNumber: 1,
      blocker: "INELIGIBLE_SETTLEMENT",
      released: true,
    })
    // The attempt stays durable and unresolved; nothing is retried or faked.
    expect(state.attempts).toHaveLength(1)
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
    expect(state.events.map((e) => e.eventType)).toEqual(["REQUESTED"])
  })

  it("does not call the adapter when the property binding drifts in the gap", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store: storeWithGap(state, () => {
          state.order = order({ propertyPin: "99999999999999" })
        }),
        adapter: { provider: "resend", send },
      },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      outcome: "SEND_DENIED",
      blocker: "PROPERTY_BINDING_UNVERIFIED",
    })
  })

  it("does not call the adapter when the lease is lost in the gap", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store: storeWithGap(state, () => {
          ;(state.summary as Record<string, unknown>).leaseOwner =
            "ot-t2-delivery:other"
        }),
        adapter: { provider: "resend", send },
      },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: "SEND_DENIED", blocker: "LEASE_NOT_HELD" })
  })

  it("does not call the adapter when activation is withdrawn in the gap", async () => {
    const state = world()
    const env: Record<string, string | undefined> = { OT_T2_DELIVERY_ENABLED: "true" }
    const send = jest.fn(async () => accepted)
    const store = storeWithGap(state, () => {
      delete env.OT_T2_DELIVERY_ENABLED
    })
    const assertSendable = jest.spyOn(store, "assertSendable")
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env, store, adapter: { provider: "resend", send } },
    )
    expect(send).not.toHaveBeenCalled()
    // The free check comes first, so a withdrawn flag costs no database round trip.
    expect(assertSendable).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: "SEND_DENIED", blocker: "FLAG_DISABLED" })
  })

  it("never sends when the pre-send check itself throws", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const store = storeWithGap(
      state,
      () => {},
      {
        assertSendable: async () => {
          throw new Error("private connection detail")
        },
      },
    )
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store, adapter: { provider: "resend", send } },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      outcome: "SEND_DENIED",
      blocker: "PRE_SEND_CHECK_UNKNOWN",
    })
  })

  it("a denied send is not retried on the next invocation", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const adapter = { provider: "resend", send }
    await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store: storeWithGap(state, () => {
          state.order = order({ status: "REFUNDED" })
        }),
        adapter,
      },
    )
    // Settlement restored, so only the unresolved DELIVERY_PENDING summary is
    // left to stop a second send — and it does.
    state.order = order()
    const again = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store: createPrismaT2DeliveryStore(fakeClient(state)),
        adapter,
      },
    )
    expect(again).toEqual({ outcome: "NOT_CLAIMED" })
    expect(send).not.toHaveBeenCalled()
    expect(state.attempts).toHaveLength(1)
  })

  it("preserves an unknown persist outcome and sends nothing", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const real = createPrismaT2DeliveryStore(fakeClient(state))
    const store: T2DeliveryStore = {
      ...real,
      async persistAttempt() {
        throw new Error("private connection detail")
      },
    }
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store, adapter: { provider: "resend", send } },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: "PERSIST_OUTCOME_UNKNOWN", released: true })
    expect(state.summary?.leaseOwner).toBeNull()
  })

  it("preserves an unknown claim outcome and sends nothing", async () => {
    const state = world()
    const send = jest.fn(async () => accepted)
    const real = createPrismaT2DeliveryStore(fakeClient(state))
    const store: T2DeliveryStore = {
      ...real,
      async claim() {
        throw new Error("private connection detail")
      },
    }
    const result = await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      { env: { OT_T2_DELIVERY_ENABLED: "true" }, store, adapter: { provider: "resend", send } },
    )
    expect(send).not.toHaveBeenCalled()
    expect(result).toMatchObject({ outcome: "CLAIM_OUTCOME_UNKNOWN" })
    expect(state.attempts).toHaveLength(0)
  })

  it("re-asserts immediately before the adapter, with nothing in between", async () => {
    const state = world()
    const calls: string[] = []
    const real = createPrismaT2DeliveryStore(fakeClient(state))
    const store: T2DeliveryStore = {
      ...real,
      async persistAttempt(input) {
        calls.push("persist")
        return real.persistAttempt(input)
      },
      async assertSendable(input) {
        calls.push("assertSendable")
        return real.assertSendable(input)
      },
    }
    await runT2Delivery(
      { orderId: ORDER_ID, fulfillmentId: FULFILLMENT_ID },
      {
        env: { OT_T2_DELIVERY_ENABLED: "true" },
        store,
        adapter: {
          provider: "resend",
          send: async () => {
            calls.push("send")
            return accepted
          },
        },
      },
    )
    expect(calls).toEqual(["persist", "assertSendable", "send"])
  })
})

describe("source contract: no half-wired sender ships in this slice", () => {
  const ROOT = process.cwd()
  const orchestrator = require("node:fs").readFileSync(
    require("node:path").join(ROOT, "lib/fulfillment-runtime/t2-delivery-orchestrator.ts"),
    "utf8",
  )
  const store = require("node:fs").readFileSync(
    require("node:path").join(ROOT, "lib/fulfillment-runtime/delivery-store.ts"),
    "utf8",
  )

  it("imports no mail client, provider SDK, or email module", () => {
    for (const source of [orchestrator, store]) {
      expect(source).not.toMatch(/from "(resend|nodemailer|@?[\w/-]*\/email[\w/-]*)"/)
      expect(source).not.toMatch(/lib\/email/)
    }
  })

  it("ships no default adapter, so an env flag alone can send nothing", () => {
    expect(orchestrator).not.toMatch(/deps\.adapter \?\?/)
    expect(orchestrator).toContain("NO_DELIVERY_ADAPTER")
  })

  it("never handles a recipient address in code", () => {
    // Prose may discuss what the adapter is responsible for; the CODE may not
    // touch it, so the comments are stripped before the check.
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const source of [orchestrator, store]) {
      expect(code(source)).not.toMatch(/\brecipient\b|\btoAddress\b|\bemail\b/i)
    }
  })
})

/**
 * `CURRENT_TIMESTAMP` (and its aliases `now()` / `transaction_timestamp()`) is
 * frozen at TRANSACTION START in PostgreSQL. Every trusted-clock read in this
 * store happens after a `FOR UPDATE` lock that can block for an unbounded time
 * behind another writer, so a transaction that queued behind a slow holder would
 * measure lease expiry against an instant from before the wait — and treat a
 * lease that died during that wait as still live, authorizing a send nobody
 * holds the lease for.
 *
 * The fake adapter below cannot prove this: it answers instantly and returns
 * whatever instant the test scripted, so it behaves identically either way. The
 * only thing that pins the real timing is the SQL text itself, so that is what
 * these assertions read.
 */
describe("source contract: expiry is measured against the DB wall clock", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "lib/fulfillment-runtime/delivery-store.ts"),
    "utf8",
  ) as string
  // Prose is allowed to name CURRENT_TIMESTAMP while explaining why it is wrong.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("reads the trusted clock with clock_timestamp(), which advances mid-transaction", () => {
    expect(code).toContain("clock_timestamp() AT TIME ZONE 'UTC'")
  })

  it("uses no transaction-start clock function anywhere in its SQL", () => {
    expect(code).not.toMatch(/CURRENT_TIMESTAMP/)
    expect(code).not.toMatch(/\btransaction_timestamp\s*\(/)
    // `now()` is the alias for CURRENT_TIMESTAMP, not for clock_timestamp().
    expect(code).not.toMatch(/\bnow\s*\(/)
  })

  it("still renders the instant with to_char, never a driver date mapping", () => {
    expect(code).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`)
  })
})

describe("the trusted clock is read after the locks, not before them", () => {
  const clockIndex = (state: World) =>
    state.sql.findIndex((sql) => sql.includes("clock_timestamp()"))
  const lastLockIndex = (state: World) =>
    state.sql.reduce((last, sql, i) => (sql.includes("FOR UPDATE") ? i : last), -1)

  it("claim reads the clock only after ot_order and ot_fulfillment are locked", async () => {
    const state = world()
    await createPrismaT2DeliveryStore(fakeClient(state)).claim({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      owner: OWNER,
      token: TOKEN,
      leaseMs: T2_DELIVERY_LEASE_MS,
    })
    expect(state.sql.filter((sql) => sql.includes("FOR UPDATE"))).toHaveLength(2)
    expect(clockIndex(state)).toBeGreaterThan(lastLockIndex(state))
  })

  it("persistAttempt reads the clock only after both locks", async () => {
    const state = leasedWorld()
    await createPrismaT2DeliveryStore(fakeClient(state)).persistAttempt({
      orderId: ORDER_ID,
      fulfillmentId: FULFILLMENT_ID,
      provider: "resend",
      owner: OWNER,
      token: TOKEN,
    })
    expect(clockIndex(state)).toBeGreaterThan(lastLockIndex(state))
  })
})

/**
 * `recordOutcome` runs after an asynchronous provider call, so every authority
 * it depends on may have changed underneath it. These pin that it re-reads each
 * one under the lock instead of trusting the attempt number it was handed, and
 * that a lost compare-and-set takes the whole transaction's writes with it.
 *
 * A refusal that merely `return`s from inside the transaction callback COMMITS
 * whatever was written before it — which for a lost outcome CAS would be an
 * orphaned FAILED/ACCEPTED event attached to a fulfillment whose status never
 * moved. That is why the store throws instead.
 */
describe("adversarial authoritative delivery admission", () => {
  const dispatchInput = {
    orderId: ORDER_ID,
    fulfillmentId: FULFILLMENT_ID,
    provider: "resend",
    ...held,
  }

  it.each([
    ["order", "FULFILLMENT_ORDER_MISMATCH"],
    ["provider", "ATTEMPT_PROVIDER_MISMATCH"],
    ["kind", "INELIGIBLE_FULFILLMENT_STATUS"],
    ["stale", "STALE_ATTEMPT"],
    ["refund", "INELIGIBLE_SETTLEMENT"],
  ])("rejects %s mismatch without writes", async (which, blocker) => {
    const state = leasedWorld()
    const store = createPrismaT2DeliveryStore(fakeClient(state))
    expect((await store.persistAttempt(dispatchInput)).ok).toBe(true)
    if (which === "order") state.summary!.orderId = "other-order"
    if (which === "kind") state.summary!.kind = "OTHER"
    if (which === "stale") state.summary!.attemptCount = 2
    if (which === "refund") state.order!.status = "REFUNDED"
    const before = structuredClone({
      attempts: state.attempts,
      events: state.events,
      summary: state.summary,
    })
    expect(
      await store.recordOutcome({
        orderId: ORDER_ID,
        fulfillmentId: FULFILLMENT_ID,
        attemptNumber: 1,
        outcome: {
          kind: "ACCEPTED",
          provider: which === "provider" ? "other" : "resend",
          providerMessageId: "msg",
        },
      }),
    ).toEqual({ ok: false, blocker })
    expect({
      attempts: state.attempts,
      events: state.events,
      summary: state.summary,
    }).toEqual(before)
  })

  it.each(["dispatch", "outcome"])(
    "rolls back all %s writes on a lost compare-and-set",
    async (phase) => {
      const state = leasedWorld()
      const store = createPrismaT2DeliveryStore(fakeClient(state))
      if (phase === "outcome") await store.persistAttempt(dispatchInput)
      const before = structuredClone({
        attempts: state.attempts,
        events: state.events,
        summary: state.summary,
      })
      state.casMiss = true
      const result =
        phase === "dispatch"
          ? await store.persistAttempt(dispatchInput)
          : await store.recordOutcome({
              orderId: ORDER_ID,
              fulfillmentId: FULFILLMENT_ID,
              attemptNumber: 1,
              outcome: {
                kind: "ACCEPTED",
                provider: "resend",
                providerMessageId: "msg",
              },
            })
      expect(result).toEqual({ ok: false, blocker: "DELIVERY_ATTEMPT_CONFLICT" })
      expect(state.rolledBack).toBe(true)
      expect({
        attempts: state.attempts,
        events: state.events,
        summary: state.summary,
      }).toEqual(before)
    },
  )
})
