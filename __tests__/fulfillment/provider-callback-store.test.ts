/**
 * @jest-environment node
 *
 * The callback store's real SQL, run against a literal fake Prisma adapter that
 * keeps a small in-memory world, records lock order, and enforces the
 * compare-and-set predicates itself. The assertions are therefore about the
 * store's own concurrency and lifecycle logic, not about scripted returns.
 *
 * What is being protected:
 *   - a replayed signed delivery writes nothing the second time;
 *   - an event that cannot be correlated yet is KEPT, not dropped;
 *   - once the message id is bound, the kept event is applied — exactly once;
 *   - a stale attempt, a superseded artifact, a foreign order, a refunded order
 *     and a terminal state are all recorded and refused rather than applied.
 */
import type { Prisma } from "@prisma/client"
import {
  MAX_CALLBACK_REPLAYS,
  RESEND_PROVIDER,
  type SanitizedProviderCallback,
} from "@/lib/fulfillment/provider-callbacks"
import {
  createPrismaProviderCallbackStore,
  type ProviderCallbackClient,
  type ProviderCallbackTransaction,
} from "@/lib/fulfillment-runtime/provider-callback-store"

const ORDER_ID = "ord_paid_t2"
const FULFILLMENT_ID = "ful_t2"
const MESSAGE_ID = "msg_provider_1"
const NOW = "2026-09-12T12:00:00.000Z"

type CallbackRow = {
  id: string
  provider: string
  providerEventId: string
  providerMessageId: string
  eventType: string
  reasonCode: string | null
  occurredAt: Date
  receivedAt: Date
  disposition: string
  dispositionCode: string | null
  fulfillmentId: string | null
  attemptNumber: number | null
  resolvedAt: Date | null
  replayCount: number
}

type World = {
  now: string
  order: { id: string; tier: string; status: string } | null
  summary: Record<string, unknown> | null
  attempts: Array<Record<string, unknown>>
  artifactVersion: number | null
  events: Array<Record<string, unknown>>
  callbacks: CallbackRow[]
  capabilities: Array<{ revokedAt: Date | null; revokedReasonCode: string | null }>
  locks: string[]
  /** True when the spool-cap COUNT ran while the serializing lock was held. */
  countedUnmatchedUnderLock: boolean
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
      {
        fulfillmentId: FULFILLMENT_ID,
        attemptNumber: 1,
        provider: RESEND_PROVIDER,
        artifactVersion: 1,
        providerMessageId: MESSAGE_ID,
      },
    ],
    artifactVersion: 1,
    events: [],
    callbacks: [],
    capabilities: [{ revokedAt: null, revokedReasonCode: null }],
    locks: [],
    countedUnmatchedUnderLock: false,
    ...patch,
  }
}

function fakeClient(state: World): ProviderCallbackClient {
  const tx: ProviderCallbackTransaction = {
    async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
      const sql = query.sql
      if (sql.includes("clock_timestamp()")) return [{ now: state.now }] as T
      if (sql.includes("pg_advisory_xact_lock")) {
        // Recorded, so the ORDER of the cap decision is assertable: the count
        // must never be taken outside this lock.
        state.locks.push("spool-cap")
        return [{ locked: true }] as T
      }
      if (sql.includes('COUNT(*) AS "live"')) {
        state.countedUnmatchedUnderLock = state.locks.includes("spool-cap")
        return [{
          live: state.callbacks.filter(
            (c) => c.disposition === "UNMATCHED" && c.resolvedAt === null,
          ).length,
        }] as T
      }
      if (sql.includes('JOIN "ot_fulfillment" f ON f."id" = t."fulfillment_id"')) {
        const [provider, messageId] = query.values
        const hits = state.attempts.filter(
          (a) => a.provider === provider && a.providerMessageId === messageId,
        )
        return hits.map((hit) => ({
          fulfillmentId: hit.fulfillmentId,
          attemptNumber: hit.attemptNumber,
          orderId: (state.summary?.orderId as string) ?? ORDER_ID,
        })) as T
      }
      if (sql.includes('FROM "ot_order"')) {
        state.locks.push("order")
        return (state.order ? [state.order] : []) as T
      }
      if (sql.includes('FROM "ot_fulfillment" WHERE "id"')) {
        state.locks.push("fulfillment")
        return (state.summary ? [state.summary] : []) as T
      }
      if (sql.includes('FROM "ot_delivery_attempt"') && sql.includes("FOR UPDATE")) {
        state.locks.push("attempt")
        const number = query.values[1]
        return state.attempts.filter((a) => a.attemptNumber === number) as T
      }
      if (sql.includes('FROM "ot_fulfillment_artifact"'))
        return (state.artifactVersion === null ? [] : [{ version: state.artifactVersion }]) as T
      if (sql.includes('FROM "ot_delivery_event"')) {
        const max = state.events.reduce((best, e) => Math.max(best, Number(e.sequence)), 0)
        return [{ next: max + 1 }] as T
      }
      if (sql.includes('COUNT(*) AS "live"')) {
        const live = state.callbacks.filter(
          (c) => c.disposition === "UNMATCHED" && c.resolvedAt === null,
        ).length
        return [{ live }] as T
      }
      if (sql.includes('FROM "ot_delivery_provider_callback"')) {
        // … AND "received_at" >= $3 AND "replay_count" < $4
        const [provider, messageId, horizon, ceiling] = query.values as
          [string, string, Date, number]
        return state.callbacks
          .filter(
            (c) =>
              c.provider === provider &&
              c.providerMessageId === messageId &&
              c.disposition === "UNMATCHED" &&
              c.resolvedAt === null &&
              c.receivedAt >= horizon &&
              c.replayCount < ceiling,
          )
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
          // COPIES, as a real query returns. Handing out live references let the
          // compare-and-set below read a value that had changed since the batch
          // was read, which is precisely the race it exists to lose.
          .map((row) => ({ ...row })) as T
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    async $executeRaw(query: Prisma.Sql): Promise<number> {
      const sql = query.sql
      if (sql.includes('INSERT INTO "ot_delivery_provider_callback"')) {
        const [id, provider, providerEventId, providerMessageId, eventType, reasonCode, occurredAt, receivedAt, disposition] =
          query.values as never[]
        // The unique index is the replay authority: a conflicting insert writes
        // nothing and reports zero.
        if (
          state.callbacks.some(
            (c) => c.provider === provider && c.providerEventId === providerEventId,
          )
        )
          return 0
        state.callbacks.push({
          id, provider, providerEventId, providerMessageId, eventType,
          reasonCode, occurredAt, receivedAt, disposition,
          dispositionCode: null, fulfillmentId: null, attemptNumber: null,
          resolvedAt: null, replayCount: 0,
        })
        return 1
      }
      if (sql.includes('UPDATE "ot_delivery_provider_callback"')) {
        if (sql.includes('SET "replay_count" = "replay_count" + 1')) {
          // … AND "replay_count" = $2 AND "replay_count" < $3
          const [id, expected, ceiling] = query.values as [string, number, number]
          const row = state.callbacks.find(
            (c) =>
              c.id === id &&
              c.disposition === "UNMATCHED" &&
              c.resolvedAt === null &&
              c.replayCount === expected &&
              c.replayCount < ceiling,
          )
          if (!row) return 0
          row.replayCount += 1
          return 1
        }
        if (sql.includes('"disposition_code" = NULL')) {
          const [, fulfillmentId, attemptNumber, resolvedAt, id] = query.values as never[]
          const row = state.callbacks.find((c) => c.id === id)
          if (!row) return 0
          Object.assign(row, {
            disposition: "APPLIED", dispositionCode: null,
            fulfillmentId, attemptNumber, resolvedAt,
          })
          return 1
        }
        const [, code, fulfillmentId, attemptNumber, resolvedAt, id] = query.values as never[]
        const row = state.callbacks.find((c) => c.id === id)
        if (!row) return 0
        Object.assign(row, {
          disposition: "REFUSED", dispositionCode: code,
          fulfillmentId, attemptNumber,
          resolvedAt: row.resolvedAt ?? resolvedAt,
        })
        return 1
      }
      if (sql.includes('INSERT INTO "ot_delivery_event"')) {
        const [, fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence] =
          query.values as never[]
        if (state.events.some((e) => e.provider === provider && e.providerEventId === providerEventId))
          return 0
        state.events.push({ fulfillmentId, attemptNumber, provider, providerEventId, eventType, sequence })
        return 1
      }
      if (sql.includes('UPDATE "ot_delivery_attempt"')) return 1
      if (sql.includes('UPDATE "ot_fulfillment"')) {
        if (state.casMiss) return 0
        const summary = state.summary
        if (!summary) return 0
        const [nextStatus, nextRevision, , , expectedStatus, expectedRevision] = query.values as never[]
        if (summary.status !== expectedStatus || summary.statusRevision !== expectedRevision)
          return 0
        summary.status = nextStatus
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
      throw new Error(`unexpected execute: ${sql}`)
    },
  }
  return {
    async $transaction<T>(work: (t: ProviderCallbackTransaction) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state)
      try {
        return await work(tx)
      } catch (error) {
        // A real transaction rolls every write back when the callback throws.
        Object.assign(state, snapshot)
        throw error
      }
    },
  }
}

function event(patch: Partial<SanitizedProviderCallback> = {}): SanitizedProviderCallback {
  return {
    provider: RESEND_PROVIDER,
    providerEventId: "evt_signed_1",
    providerMessageId: MESSAGE_ID,
    eventType: "DELIVERED",
    reasonCode: null,
    occurredAt: "2026-09-12T11:59:30.000Z",
    ...patch,
  }
}

describe("an applied callback folds exactly once, under the authoritative lock", () => {
  it("locks order → fulfillment → attempt, matching every other store", async () => {
    const state = world()
    await createPrismaProviderCallbackStore(fakeClient(state)).ingest(event())
    expect(state.locks).toEqual(["order", "fulfillment", "attempt"])
  })

  it("applies delivery to the current attempt and records the binding", async () => {
    const state = world({ summary: { ...world().summary!, status: "PROVIDER_ACCEPTED" } })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({
      outcome: "APPLIED",
      fulfillmentId: FULFILLMENT_ID,
      attemptNumber: 1,
      status: "DELIVERED",
    })
    expect(state.summary).toMatchObject({ status: "DELIVERED", statusRevision: 5 })
    expect(state.events).toHaveLength(1)
    expect(state.callbacks[0]).toMatchObject({
      disposition: "APPLIED",
      fulfillmentId: FULFILLMENT_ID,
      attemptNumber: 1,
    })
  })

  it("records a provider acceptance as PROVIDER_ACCEPTED, never DELIVERED", async () => {
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ eventType: "ACCEPTED" }))
    expect(state.summary).toMatchObject({ status: "PROVIDER_ACCEPTED" })
  })

  it("ends live customer access the moment a terminal outcome lands", async () => {
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ eventType: "BOUNCED", reasonCode: "HARD_BOUNCE" }))
    expect(state.summary).toMatchObject({ status: "BOUNCED" })
    expect(state.capabilities[0]).toMatchObject({
      revokedAt: expect.any(Date),
      revokedReasonCode: "UNDELIVERABLE",
    })
  })

  it("leaves capabilities alone for a non-terminal outcome", async () => {
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ eventType: "ACCEPTED" }))
    expect(state.capabilities[0].revokedAt).toBeNull()
  })
})

describe("replay of a signed delivery is a no-op", () => {
  it("writes nothing the second time", async () => {
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    const revision = state.summary!.statusRevision
    const events = state.events.length

    await expect(store.ingest(event())).resolves.toEqual({ outcome: "DUPLICATE" })
    expect(state.callbacks).toHaveLength(1)
    expect(state.events).toHaveLength(events)
    expect(state.summary!.statusRevision).toBe(revision)
  })

  it("treats a different signed envelope as a different event", async () => {
    const state = world({ summary: { ...world().summary!, status: "PROVIDER_ACCEPTED" } })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ providerEventId: "evt_a" }))
    // A second, distinct signed envelope. It is admitted and recorded; the fold
    // authority decides whether it may move anything.
    await store.ingest(event({ providerEventId: "evt_b", eventType: "COMPLAINED", reasonCode: "SPAM_COMPLAINT" }))
    expect(state.callbacks).toHaveLength(2)
    expect(state.summary).toMatchObject({ status: "COMPLAINED" })
  })
})

describe("an event that cannot be correlated yet is kept, never dropped", () => {
  it("stores it as UNMATCHED when no attempt owns the message id", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({ outcome: "UNMATCHED" })
    expect(state.callbacks[0]).toMatchObject({
      disposition: "UNMATCHED",
      providerMessageId: MESSAGE_ID,
      fulfillmentId: null,
    })
    // Nothing was guessed onto an order.
    expect(state.events).toEqual([])
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING", statusRevision: 4 })
  })

  it("applies it once the send binds the message id — the race, closed", async () => {
    // The callback arrives BEFORE the send response.
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    expect(state.callbacks[0].disposition).toBe("UNMATCHED")

    // Now the send returns and the message id becomes a real binding.
    state.attempts = world().attempts
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 1, applied: 1, stillUnmatched: 0, skipped: 0 })
    expect(state.summary).toMatchObject({ status: "DELIVERED" })
    expect(state.callbacks[0]).toMatchObject({ disposition: "APPLIED", replayCount: 1 })
  })

  it("cannot apply the same stored event twice", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    state.attempts = world().attempts
    await store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID })
    const revision = state.summary!.statusRevision
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 0, applied: 0, stillUnmatched: 0, skipped: 0 })
    expect(state.summary!.statusRevision).toBe(revision)
  })

  it("reconciles stored events oldest-first so the fold sees provider order", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ providerEventId: "evt_late", eventType: "DELIVERED", occurredAt: "2026-09-12T11:59:50.000Z" }))
    await store.ingest(event({ providerEventId: "evt_early", eventType: "ACCEPTED", occurredAt: "2026-09-12T11:59:10.000Z" }))
    state.attempts = world().attempts
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 2, applied: 2, stillUnmatched: 0, skipped: 0 })
    expect(state.events.map((e) => e.eventType)).toEqual(["ACCEPTED", "DELIVERED"])
    expect(state.summary).toMatchObject({ status: "DELIVERED" })
  })

  it("leaves it unmatched when the id is still unbound", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 1, applied: 0, stillUnmatched: 1, skipped: 0 })
    expect(state.callbacks[0].disposition).toBe("UNMATCHED")
  })

  it("never reconciles across providers", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    state.attempts = world().attempts
    await expect(
      store.reconcile({ provider: "postmark", providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 0, applied: 0, stillUnmatched: 0, skipped: 0 })
  })
})

describe("an event we decline to apply is recorded with its reason", () => {
  it.each([
    ["a refunded order", { order: { id: ORDER_ID, tier: "T2", status: "REFUNDED" } }, "INELIGIBLE_SETTLEMENT"],
    ["a superseded artifact", { artifactVersion: 2 }, "ARTIFACT_SUPERSEDED"],
    ["a stale attempt", { summary: { ...world().summary!, attemptCount: 2 } }, "STALE_ATTEMPT"],
    ["a terminal fulfillment", { summary: { ...world().summary!, status: "BOUNCED" } }, "TERMINAL_LOCKED"],
    ["a pre-send fulfillment", { summary: { ...world().summary!, status: "ARTIFACT_READY" } }, "NOT_APPLICABLE"],
  ])("records %s as REFUSED and changes nothing", async (_label, patch, code) => {
    const state = world(patch as Partial<World>)
    const before = structuredClone(state.summary)
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({ outcome: "REFUSED", code })
    expect(state.callbacks[0]).toMatchObject({ disposition: "REFUSED", dispositionCode: code })
    expect(state.summary).toEqual(before)
    expect(state.events).toEqual([])
  })

  it("refuses an event whose attempt belongs to another provider", async () => {
    const state = world({
      attempts: [{ ...world().attempts[0], provider: "postmark" }],
    })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    // The lookup is keyed on (provider, message id), so a resend event simply
    // finds no attempt — it can never resolve another sender's message.
    await expect(store.ingest(event())).resolves.toEqual({ outcome: "UNMATCHED" })
    expect(state.events).toEqual([])
  })
})

describe("a lost compare-and-set rolls the whole callback back", () => {
  it("writes no event when the summary moved underneath it", async () => {
    const state = world({ casMiss: true })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({
      outcome: "REFUSED",
      code: "STALE_ATTEMPT",
    })
    // The rollback took the callback row with it, so the provider's retry of the
    // same signed delivery is admitted again rather than seen as a duplicate.
    expect(state.callbacks).toEqual([])
    expect(state.events).toEqual([])
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING", statusRevision: 4 })
  })
})

describe("the durable unmatched store is bounded", () => {
  it("stops accepting new unresolved rows past the ceiling and says so", async () => {
    const state = world({ attempts: [] })
    // One below the ceiling, so the next arrival crosses it.
    state.callbacks = Array.from({ length: 1000 }, (_, i) => ({
      id: `c${i}`, provider: RESEND_PROVIDER, providerEventId: `evt_old_${i}`,
      providerMessageId: `msg_${i}`, eventType: "DELIVERED", reasonCode: null,
      occurredAt: new Date(NOW), receivedAt: new Date(NOW), disposition: "UNMATCHED",
      dispositionCode: null, fulfillmentId: null, attemptNumber: null,
      resolvedAt: null, replayCount: 0,
    }))
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({
      outcome: "REFUSED",
      code: "UNMATCHED_STORE_FULL",
    })
    // The evidence is still kept — it simply stops being queued for replay.
    expect(state.callbacks).toHaveLength(1001)
    expect(state.callbacks[1000]).toMatchObject({
      disposition: "REFUSED",
      dispositionCode: "UNMATCHED_STORE_FULL",
    })
  })

  /**
   * `SELECT COUNT(*) … > MAX` is not a cap on its own. Under READ COMMITTED a
   * concurrent ingester's uncommitted row is invisible, so N of them can each
   * count MAX, each conclude there is room, and each commit — MAX + N rows past
   * a ceiling that exists precisely to bound attacker-driven growth.
   *
   * The fake cannot reproduce PostgreSQL's snapshot isolation, so what is pinned
   * here is the property that makes the real thing safe: the count is never
   * taken outside the serializing lock.
   */
  it("decides the cap under a serializing advisory lock, never outside one", async () => {
    const state = world({ attempts: [] })
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({ outcome: "UNMATCHED" })
    expect(state.locks).toContain("spool-cap")
    expect(state.countedUnmatchedUnderLock).toBe(true)
  })

  it("takes no cap lock at all on the matched path", async () => {
    // A correlated event never touches the spool, so it must never queue behind
    // the one lock every uncorrelated arrival contends for.
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toMatchObject({ outcome: "APPLIED" })
    expect(state.locks).not.toContain("spool-cap")
  })
})

/**
 * The claim that begins a replay is a compare-and-set on `replay_count`. Written
 * as `LEAST(count + 1, 1000)` it wrote 1000 over 1000 at the ceiling, so the
 * predicate `replay_count = <observed>` stayed satisfiable and TWO concurrent
 * reconcilers could both claim the same row — the exact thing the statement
 * exists to prevent. A spent row is now simply not claimable.
 */
describe("a spent replay budget stops being claimable, and stays evidence", () => {
  function spooled(replayCount: number) {
    const state = world({ attempts: [] })
    state.callbacks = [{
      id: "c_spent", provider: RESEND_PROVIDER, providerEventId: "evt_spent",
      providerMessageId: MESSAGE_ID, eventType: "DELIVERED", reasonCode: null,
      occurredAt: new Date(NOW), receivedAt: new Date(NOW), disposition: "UNMATCHED",
      dispositionCode: null, fulfillmentId: null, attemptNumber: null,
      resolvedAt: null, replayCount,
    }]
    state.attempts = world().attempts
    return state
  }

  it("never offers a row that has reached the ceiling", async () => {
    const state = spooled(MAX_CALLBACK_REPLAYS)
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 0, applied: 0, stillUnmatched: 0, skipped: 0 })
    // Not deleted, not refused: still exactly the evidence it always was.
    expect(state.callbacks[0]).toMatchObject({
      disposition: "UNMATCHED",
      replayCount: MAX_CALLBACK_REPLAYS,
    })
  })

  it("still replays a row one below the ceiling, exactly once more", async () => {
    const state = spooled(MAX_CALLBACK_REPLAYS - 1)
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(
      store.reconcile({ provider: RESEND_PROVIDER, providerMessageId: MESSAGE_ID }),
    ).resolves.toEqual({ examined: 1, applied: 1, stillUnmatched: 0, skipped: 0 })
    expect(state.callbacks[0].replayCount).toBe(MAX_CALLBACK_REPLAYS)
  })

  it("reports a lost claim as skipped, so the batch still accounts for itself", async () => {
    const state = spooled(0)
    const client = fakeClient(state)
    // A concurrent reconciler wins the row between the batch read (the second
    // transaction of the pass) and this pass's claim (the third).
    let transactions = 0
    const racing = createPrismaProviderCallbackStore({
      async $transaction<T>(work: (tx: ProviderCallbackTransaction) => Promise<T>) {
        transactions += 1
        if (transactions === 3) state.callbacks[0].replayCount = 1
        return client.$transaction(work)
      },
    })
    const result = await racing.reconcile({
      provider: RESEND_PROVIDER,
      providerMessageId: MESSAGE_ID,
    })
    // The row was read, and then was not ours to act on. It is accounted for
    // rather than vanishing between `examined` and the two outcome counters.
    expect(result.examined).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.applied + result.stillUnmatched + result.skipped).toBe(result.examined)
    // The winner's claim stands; nothing was applied twice.
    expect(state.callbacks[0]).toMatchObject({ disposition: "UNMATCHED", replayCount: 1 })
  })
})

/**
 * `ot_delivery_attempt` carries a UNIQUE (provider, provider_message_id), so two
 * attempts can never share one message id while that index exists. Reading
 * `located[0]` out of an unordered result assumed that silently: if the index
 * were ever dropped or rebuilt during a migration, a provider event would be
 * folded onto whichever of two paid orders the planner returned first.
 */
describe("one provider message id can never resolve to two attempts", () => {
  it("refuses an ambiguous binding instead of folding onto an arbitrary order", async () => {
    const state = world()
    state.attempts = [
      ...state.attempts,
      { ...state.attempts[0], fulfillmentId: "ful_other", attemptNumber: 1 },
    ]
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await expect(store.ingest(event())).resolves.toEqual({
      outcome: "REFUSED",
      code: "AMBIGUOUS_MESSAGE_BINDING",
    })
    // Nothing was folded: no event row, and the summary never moved.
    expect(state.events).toHaveLength(0)
    expect(state.summary).toMatchObject({ status: "DELIVERY_PENDING" })
  })

  it("records the refusal rather than dropping the evidence", async () => {
    const state = world()
    state.attempts = [
      ...state.attempts,
      { ...state.attempts[0], fulfillmentId: "ful_other", attemptNumber: 1 },
    ]
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event())
    expect(state.callbacks[0]).toMatchObject({
      disposition: "REFUSED",
      dispositionCode: "AMBIGUOUS_MESSAGE_BINDING",
      // Deliberately unbound: naming one of the two would be the same guess.
      fulfillmentId: null,
      attemptNumber: null,
    })
  })
})

describe("nothing free-form is ever persisted", () => {
  it("keeps no recipient, subject, payload or capability in any row", async () => {
    const state = world()
    const store = createPrismaProviderCallbackStore(fakeClient(state))
    await store.ingest(event({ eventType: "BOUNCED", reasonCode: "HARD_BOUNCE" }))
    const serialized = JSON.stringify({
      callbacks: state.callbacks,
      events: state.events,
    })
    expect(serialized).not.toContain("@")
    expect(serialized.toLowerCase()).not.toContain("subject")
    expect(serialized.toLowerCase()).not.toContain("capability")
  })
})
