/**
 * @jest-environment node
 *
 * Bounded operator recovery, driven adversarially.
 *
 * The point of this control is what it CANNOT do. It cannot resend, cannot
 * regenerate, cannot re-mint, cannot act on a stale console view, and cannot end
 * an unresolved send without an explicit on-the-record assertion of definite
 * evidence. Most of the assertions here are about those absences.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Prisma } from "@prisma/client"
import {
  NO_IN_FLIGHT_EVIDENCE,
  RECONCILABLE_STATUSES,
  RESOLVE_REASON_CODES,
  runT2DeliveryRecovery,
  type DeliveryRecoveryInput,
  type RecoveryClient,
  type RecoveryTransaction,
} from "@/lib/fulfillment-runtime/t2-delivery-recovery"

jest.mock("server-only", () => ({}))

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const MESSAGE_ID = "msg_provider_1"
const ACTOR = "usr_admin_1"
const NOW = "2026-09-12T12:00:00.000Z"

type World = {
  paymentAuthority?: boolean
  now: string
  order: { id: string; tier: string; status: string } | null
  summary: Record<string, unknown> | null
  attempts: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  adminEvents: Array<Record<string, unknown>>
  capabilities: Array<{ revokedAt: Date | null; revokedReasonCode: string | null }>
  locks: string[]
  casMiss?: boolean
}

function world(patch: Partial<World> = {}): World {
  return {
    now: NOW,
    order: { id: ORDER_ID, tier: "T2", status: "PAID" },
    summary: {
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      kind: "T2_APPEAL_EVIDENCE",
      status: "DELIVERY_PENDING",
      statusRevision: 4,
      attemptCount: 1,
    },
    attempts: [
      { attemptNumber: 1, provider: "resend", providerMessageId: MESSAGE_ID },
    ],
    events: [],
    adminEvents: [],
    capabilities: [{ revokedAt: null, revokedReasonCode: null }],
    locks: [],
    ...patch,
  }
}

function fakeClient(state: World): RecoveryClient {
  const tx: RecoveryTransaction = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      if (sql.includes("clock_timestamp()")) return [{ now: state.now }] as T
      if (sql.includes('FROM "ot_order"')) {
        state.locks.push("order")
        expect(sql).toContain('b.session_id = "ot_order"."stripeSessionId"')
        expect(sql).toContain('r.payment_intent = b.payment_intent')
        return (state.order && state.paymentAuthority !== false ? [state.order] : []) as T
      }
      if (sql.includes('FROM "ot_fulfillment"')) {
        state.locks.push("fulfillment")
        return (state.summary ? [state.summary] : []) as T
      }
      if (sql.includes('FROM "ot_delivery_attempt"')) {
        state.locks.push("attempt")
        const number = query.values[1]
        return state.attempts.filter((a) => a.attemptNumber === number) as T
      }
      if (sql.includes('FROM "ot_delivery_event"')) {
        const max = state.events.reduce((best, e) => Math.max(best, Number(e.sequence)), 0)
        return [{ next: max + 1 }] as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const sql = query.sql
      if (sql.includes('INSERT INTO "ot_delivery_event"')) {
        const [, fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence, , , reasonCode] =
          query.values as never[]
        state.events.push({ fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence, reasonCode })
        return 1
      }
      if (sql.includes('UPDATE "ot_delivery_attempt"')) return 1
      if (sql.includes('UPDATE "ot_fulfillment"')) {
        if (state.casMiss) return 0
        const summary = state.summary
        if (!summary) return 0
        const [nextRevision, , , expectedRevision] = query.values as never[]
        if (summary.statusRevision !== expectedRevision) return 0
        summary.status = "FAILED"
        summary.statusRevision = nextRevision
        return 1
      }
      if (sql.includes('UPDATE "ot_packet_download_capability"')) {
        let revoked = 0
        for (const capability of state.capabilities) {
          if (capability.revokedAt === null) {
            capability.revokedAt = query.values[0] as Date
            capability.revokedReasonCode = query.values[1] as string
            revoked += 1
          }
        }
        return revoked
      }
      if (sql.includes('INSERT INTO "ot_fulfillment_admin_event"')) {
        const [, fulfillmentId, action, fromStatus, toStatus, fromRevision, toRevision, reasonCode, actorUserId] =
          query.values as never[]
        state.adminEvents.push({ fulfillmentId, action, fromStatus, toStatus, fromRevision, toRevision, reasonCode, actorUserId })
        return 1
      }
      throw new Error(`unexpected execute: ${sql}`)
    },
  }
  return {
    async $transaction<T>(work: (t: RecoveryTransaction) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state)
      try {
        return await work(tx)
      } catch (error) {
        Object.assign(state, snapshot)
        throw error
      }
    },
  }
}

const on = { OT_T2_DELIVERY_RECOVERY_ENABLED: "true" }

const resolve = (
  state: World,
  patch: Partial<DeliveryRecoveryInput> = {},
  reconcile?: never,
) =>
  runT2DeliveryRecovery(
    {
      orderId: ORDER_ID,
      actorUserId: ACTOR,
      action: "RESOLVE_UNRESOLVED_SEND",
      expectedStatus: "DELIVERY_PENDING",
      expectedStatusRevision: 4,
      evidence: NO_IN_FLIGHT_EVIDENCE,
      reasonCode: "TIMEOUT",
      ...patch,
    },
    { env: on, client: fakeClient(state), reconcile },
  )

describe("recovery is inert while its own flag is not exactly true", () => {
  it.each([undefined, "", "false", "TRUE", "1", "true "])(
    "flag %j makes no database call",
    async (flag) => {
      const state = world()
      const client = fakeClient(state)
      const transaction = jest.spyOn(client, "$transaction")
      await expect(
        runT2DeliveryRecovery(
          {
            orderId: ORDER_ID, actorUserId: ACTOR, action: "RESOLVE_UNRESOLVED_SEND",
            expectedStatus: "DELIVERY_PENDING", expectedStatusRevision: 4,
            evidence: NO_IN_FLIGHT_EVIDENCE, reasonCode: "TIMEOUT",
          },
          { env: { OT_T2_DELIVERY_RECOVERY_ENABLED: flag }, client },
        ),
      ).resolves.toEqual({ ok: false, code: "RECOVERY_DISABLED" })
      expect(transaction).not.toHaveBeenCalled()
    },
  )
})

describe("ending an unresolved send requires an explicit assertion", () => {
  it.each([undefined, "", "yes", "NO_IN_FLIGHT", "no_in_flight_confirmed"])(
    "refuses the evidence value %j",
    async (evidence) => {
      const state = world()
      await expect(resolve(state, { evidence })).resolves.toEqual({
        ok: false,
        code: "EVIDENCE_NOT_ASSERTED",
      })
      expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
      expect(state.events).toEqual([])
    },
  )

  it.each([undefined, "", "HARD_BOUNCE", "SPAM_COMPLAINT", "whatever the operator typed"])(
    "refuses the reason code %j",
    async (reasonCode) => {
      const state = world()
      await expect(resolve(state, { reasonCode })).resolves.toEqual({
        ok: false,
        code: "INVALID_REASON_CODE",
      })
      expect(state.events).toEqual([])
    },
  )

  it("accepts only codes that can honestly describe a send that did not complete", () => {
    expect([...RESOLVE_REASON_CODES].sort()).toEqual([
      "INVALID_RECIPIENT",
      "MANUAL_REVIEW",
      "PROVIDER_ERROR",
      "TIMEOUT",
    ])
  })
})

describe("resolving an unresolved send", () => {
  it("records FAILED, revokes the credential, and attributes the actor", async () => {
    const state = world()
    await expect(resolve(state)).resolves.toEqual({
      ok: true,
      action: "RESOLVE_UNRESOLVED_SEND",
      status: "FAILED",
      statusRevision: 5,
      revokedCapabilities: 1,
    })
    expect(state.summary).toMatchObject({ status: "FAILED", statusRevision: 5 })
    expect(state.capabilities[0]).toMatchObject({ revokedReasonCode: "ADMIN_REVOKED" })
    expect(state.adminEvents).toEqual([
      {
        fulfillmentId: FULFILLMENT_ID,
        action: "RESOLVE_UNRESOLVED_SEND",
        fromStatus: "DELIVERY_PENDING",
        toStatus: "FAILED",
        fromRevision: 4,
        toRevision: 5,
        reasonCode: "TIMEOUT",
        actorUserId: ACTOR,
      },
    ])
  })

  it("namespaces its local event so it can never be mistaken for provider evidence", async () => {
    const state = world()
    await resolve(state)
    expect(state.events).toHaveLength(1)
    expect(String(state.events[0].providerEventId)).toMatch(/^local:recovery:/)
    expect(state.events[0].eventType).toBe("FAILED")
  })

  it("locks order → fulfillment → attempt", async () => {
    const state = world()
    await resolve(state)
    expect(state.locks).toEqual(["order", "fulfillment", "attempt"])
  })

  it.each([
    ["a stale revision", { expectedStatusRevision: 3 }, "STALE_STATE"],
    ["a stale status", { expectedStatus: "DELIVERED" as const }, "STALE_STATE"],
  ])("refuses %s and changes nothing", async (_label, patch, code) => {
    const state = world()
    await expect(resolve(state, patch)).resolves.toEqual({ ok: false, code })
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING", statusRevision: 4 })
    expect(state.events).toEqual([])
    expect(state.adminEvents).toEqual([])
  })

  it.each([
    ["an unbound PAID order", { paymentAuthority: false }, "ORDER_NOT_FOUND"],
    ["an unknown order", { order: null }, "ORDER_NOT_FOUND"],
    ["a non-T2 order", { order: { id: ORDER_ID, tier: "T3", status: "PAID" } }, "ORDER_NOT_T2"],
    ["an unpaid order", { order: { id: ORDER_ID, tier: "T2", status: "REFUNDED" } }, "ORDER_NOT_PAID"],
    ["no fulfillment summary", { summary: null }, "NO_FULFILLMENT_SUMMARY"],
  ])("refuses %s", async (_label, patch, code) => {
    const state = world(patch as Partial<World>)
    await expect(resolve(state)).resolves.toEqual({ ok: false, code })
  })

  it("refuses a status that is not an unresolved send", async () => {
    // PROVIDER_ACCEPTED is NOT unresolved: the provider took custody and is
    // expected to report. Ending it here would discard evidence still in flight.
    for (const status of ["PROVIDER_ACCEPTED", "DELIVERED", "DELAYED", "ARTIFACT_READY"]) {
      const state = world({ summary: { ...world().summary!, status } })
      await expect(
        resolve(state, { expectedStatus: status as never }),
      ).resolves.toEqual({ ok: false, code: "NOT_UNRESOLVED" })
      expect(state.events).toEqual([])
    }
  })

  it("rolls everything back when the compare-and-set loses", async () => {
    const state = world({ casMiss: true })
    await expect(resolve(state)).resolves.toEqual({ ok: false, code: "STALE_STATE" })
    expect(state.events).toEqual([])
    expect(state.adminEvents).toEqual([])
    expect(state.capabilities[0].revokedAt).toBeNull()
  })

  it("is not repeatable against the same revision", async () => {
    const state = world()
    await resolve(state)
    await expect(resolve(state)).resolves.toEqual({ ok: false, code: "STALE_STATE" })
    expect(state.adminEvents).toHaveLength(1)
  })
})

describe("reconciling stored provider evidence", () => {
  const reconcileInput = {
    orderId: ORDER_ID,
    actorUserId: ACTOR,
    action: "RECONCILE_PROVIDER_CALLBACKS" as const,
    expectedStatus: "DELIVERY_PENDING" as const,
    expectedStatusRevision: 4,
  }

  it("replays stored callbacks for the message id bound to the current attempt", async () => {
    const state = world()
    const calls: unknown[] = []
    await expect(
      runT2DeliveryRecovery(reconcileInput, {
        env: on,
        client: fakeClient(state),
        reconcile: (async (input: unknown) => {
          calls.push(input)
          return { examined: 2, applied: 1, stillUnmatched: 1, skipped: 0 }
        }) as never,
      }),
    ).resolves.toEqual({
      ok: true,
      action: "RECONCILE_PROVIDER_CALLBACKS",
      examined: 2,
      applied: 1,
      stillUnmatched: 1,
      skipped: 0,
    })
    expect(calls).toEqual([{ providerMessageId: MESSAGE_ID }])
    // Reconciliation writes no local evidence of its own.
    expect(state.events).toEqual([])
    expect(state.adminEvents).toEqual([])
  })

  it("refuses when no message id has been bound yet", async () => {
    const state = world({
      attempts: [{ attemptNumber: 1, provider: "resend", providerMessageId: null }],
    })
    const reconcile = jest.fn()
    await expect(
      runT2DeliveryRecovery(reconcileInput, {
        env: on, client: fakeClient(state), reconcile: reconcile as never,
      }),
    ).resolves.toEqual({ ok: false, code: "NO_BOUND_MESSAGE_ID" })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it("refuses when there is no attempt at all", async () => {
    const state = world({
      attempts: [],
      summary: { ...world().summary!, attemptCount: 0, status: "ARTIFACT_READY" },
    })
    await expect(
      runT2DeliveryRecovery(
        { ...reconcileInput, expectedStatus: "DELIVERED" },
        { env: on, client: fakeClient(state) },
      ),
    ).resolves.toEqual({ ok: false, code: "STALE_STATE" })
  })

  it("refuses a stale console view before reading anything to replay", async () => {
    const state = world()
    const reconcile = jest.fn()
    await expect(
      runT2DeliveryRecovery(
        { ...reconcileInput, expectedStatusRevision: 99 },
        { env: on, client: fakeClient(state), reconcile: reconcile as never },
      ),
    ).resolves.toEqual({ ok: false, code: "STALE_STATE" })
    expect(reconcile).not.toHaveBeenCalled()
  })
})

describe("an unknown action does nothing", () => {
  it.each(["RESEND", "REGENERATE", "RETRY", "", "resolve_unresolved_send"])(
    "refuses %j",
    async (action) => {
      const state = world()
      await expect(
        runT2DeliveryRecovery(
          { orderId: ORDER_ID, actorUserId: ACTOR, action: action as never, expectedStatus: "DELIVERY_PENDING", expectedStatusRevision: 4 },
          { env: on, client: fakeClient(state) },
        ),
      ).resolves.toEqual({ ok: false, code: "INVALID_ACTION" })
      expect(state.events).toEqual([])
    },
  )
})

describe("recovery cannot reach a sender, a generator, or an issuer", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/fulfillment-runtime/t2-delivery-recovery.ts"),
    "utf8",
  )

  it.each([
    "t2-delivery-orchestrator",
    "t2-resend-adapter",
    "t2-packet-issuance",
    "t2-artifact-workflow",
    "t2-artifact-orchestrator",
    "t2-artifact-producer",
    "lib/email",
    "resend\"",
  ])("does not import %s", (specifier) => {
    expect(source).not.toContain(specifier)
  })

  it("never inserts an artifact, an attempt, or a capability", () => {
    expect(source).not.toMatch(/INSERT INTO "ot_fulfillment_artifact"/)
    expect(source).not.toMatch(/INSERT INTO "ot_delivery_attempt"/)
    expect(source).not.toMatch(/INSERT INTO "ot_packet_download_capability"/)
  })
})

/**
 * Reconciliation re-offers evidence we already hold to a binding that now
 * exists. That can only change something while the send is still UNRESOLVED.
 *
 * From DELIVERED or a terminal-lock status the fold refuses every edge, so a
 * pass could do nothing but spend replay budget and write REFUSED rows — while
 * returning `ok: true` and looking to an operator like it had worked. The
 * refusal is at the ROW, under the lock, not at what the operator typed.
 */
describe("reconciliation is bounded to a send that is still unresolved", () => {
  const reconcileFrom = (status: string) => ({
    orderId: ORDER_ID,
    actorUserId: ACTOR,
    action: "RECONCILE_PROVIDER_CALLBACKS" as const,
    expectedStatus: status as never,
    expectedStatusRevision: 4,
  })

  it.each(["DELIVERY_PENDING", "PROVIDER_ACCEPTED", "DELAYED"])(
    "runs from %s, where nothing durable yet says what happened",
    async (status) => {
      const state = world({ summary: { ...world().summary!, status } })
      const reconcile = jest.fn(async () => ({
        examined: 0, applied: 0, stillUnmatched: 0, skipped: 0,
      }))
      await expect(
        runT2DeliveryRecovery(reconcileFrom(status), {
          env: on, client: fakeClient(state), reconcile: reconcile as never,
        }),
      ).resolves.toMatchObject({ ok: true })
      expect(reconcile).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["DELIVERED", "BOUNCED", "COMPLAINED", "FAILED", "CANCELLED", "ARTIFACT_READY"])(
    "refuses from %s without calling the reconciler at all",
    async (status) => {
      const state = world({ summary: { ...world().summary!, status } })
      const reconcile = jest.fn()
      await expect(
        runT2DeliveryRecovery(reconcileFrom(status), {
          env: on, client: fakeClient(state), reconcile: reconcile as never,
        }),
      ).resolves.toEqual({ ok: false, code: "NOT_RECONCILABLE" })
      expect(reconcile).not.toHaveBeenCalled()
      expect(state.events).toEqual([])
      expect(state.adminEvents).toEqual([])
    },
  )

  it("still refuses a stale revision before it looks at the status at all", async () => {
    const state = world()
    const reconcile = jest.fn()
    await expect(
      runT2DeliveryRecovery(
        { ...reconcileFrom("DELIVERY_PENDING"), expectedStatusRevision: 3 },
        { env: on, client: fakeClient(state), reconcile: reconcile as never },
      ),
    ).resolves.toEqual({ ok: false, code: "STALE_STATE" })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it("reports the reconciler's full accounting, skipped rows included", async () => {
    const state = world()
    await expect(
      runT2DeliveryRecovery(reconcileFrom("DELIVERY_PENDING"), {
        env: on,
        client: fakeClient(state),
        reconcile: (async () => ({
          examined: 3, applied: 1, stillUnmatched: 1, skipped: 1,
        })) as never,
      }),
    ).resolves.toEqual({
      ok: true,
      action: "RECONCILE_PROVIDER_CALLBACKS",
      examined: 3,
      applied: 1,
      stillUnmatched: 1,
      skipped: 1,
    })
  })
})

/**
 * The HTTP boundary states the same bound as the store. Two places, one rule:
 * if they drift, a request the route accepts is refused under the lock, which
 * an operator reads as a flaky control rather than as a deliberate refusal.
 */
describe("the route's accepted statuses match the store's authority", () => {
  const ROUTE = readFileSync(
    join(
      process.cwd(),
      "app/api/admin/evidence/[orderId]/delivery-recovery/route.ts",
    ),
    "utf8",
  )

  it("offers exactly the reconcilable statuses and no others", () => {
    const enumerated = ROUTE.match(/expectedStatus: z\.enum\(\[([^\]]*)\]\)/)
    expect(enumerated).not.toBeNull()
    const listed = [...enumerated![1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
    expect(listed.sort()).toEqual([...RECONCILABLE_STATUSES].sort())
  })

  it("no longer accepts DELIVERED, which it used to", () => {
    expect(RECONCILABLE_STATUSES.has("DELIVERED")).toBe(false)
    const reconcileBranch = ROUTE.slice(
      ROUTE.indexOf('z.literal("RECONCILE_PROVIDER_CALLBACKS")'),
      ROUTE.indexOf('z.literal("RESOLVE_UNRESOLVED_SEND")'),
    )
    expect(reconcileBranch).not.toContain('"DELIVERED"')
  })
})
