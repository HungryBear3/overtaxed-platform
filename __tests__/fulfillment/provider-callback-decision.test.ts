/**
 * @jest-environment node
 *
 * The pure callback layer, driven adversarially.
 *
 * Three properties every assertion here protects:
 *   - nothing from a hostile body survives except allowlisted values;
 *   - the replay identity comes from the signed envelope, never the body;
 *   - acceptance is not delivery, a stale attempt cannot move a summary, and a
 *     terminal state is never resurrected.
 */
import {
  decideCallbackApplication,
  MAX_UNMATCHED_CALLBACKS,
  normalizeProviderCallback,
  RESEND_PROVIDER,
  isReconcilable,
  type CallbackApplicationInput,
  type SanitizedProviderCallback,
} from "@/lib/fulfillment/provider-callbacks"
import { FULFILLMENT_STATUSES, TERMINAL_LOCK_STATUSES } from "@/lib/fulfillment/types"

const NOW = "2026-09-12T12:00:00.000Z"
const EVENT_ID = "msg_2abc_signed_envelope_id"
const MESSAGE_ID = "b7e2e2c0-0000-4000-8000-000000000001"

function body(patch: Record<string, unknown> = {}) {
  return {
    type: "email.delivered",
    created_at: "2026-09-12T11:59:30.000Z",
    data: { email_id: MESSAGE_ID, to: ["owner@example.com"], subject: "x" },
    ...patch,
  }
}

function normalize(patch: Record<string, unknown> = {}) {
  return normalizeProviderCallback({
    provider: RESEND_PROVIDER,
    providerEventId: EVENT_ID,
    body: body(patch),
    receivedAt: NOW,
  })
}

describe("normalization keeps only allowlisted values", () => {
  it("retains the message id, type, reason and instant — and nothing else", () => {
    const result = normalize({ type: "email.bounced", data: { email_id: MESSAGE_ID, bounce: { type: "Permanent", message: "550 5.1.1 no such user owner@example.com" }, to: "owner@example.com" } })
    expect(result).toEqual({
      ok: true,
      event: {
        provider: "resend",
        providerEventId: EVENT_ID,
        providerMessageId: MESSAGE_ID,
        eventType: "BOUNCED",
        reasonCode: "HARD_BOUNCE",
        occurredAt: "2026-09-12T11:59:30.000Z",
      },
    })
    // The recipient, the subject and the SMTP text all stop here.
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("owner@example.com")
    expect(serialized).not.toContain("550")
    expect(serialized).not.toContain("no such user")
  })

  it("maps every modelled provider type, and sent is ACCEPTED rather than DELIVERED", () => {
    const map: Array<[string, string]> = [
      ["email.sent", "ACCEPTED"],
      ["email.delivered", "DELIVERED"],
      ["email.delivery_delayed", "DELAYED"],
      ["email.bounced", "BOUNCED"],
      ["email.complained", "COMPLAINED"],
      ["email.failed", "FAILED"],
    ]
    for (const [type, expected] of map) {
      const result = normalize({ type })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.event.eventType).toBe(expected)
    }
  })

  it("refuses engagement tracking rather than modelling it", () => {
    for (const type of ["email.opened", "email.clicked", "email.scheduled"]) {
      expect(normalize({ type })).toEqual({ ok: false, code: "IGNORED_EVENT_TYPE" })
    }
  })

  it("never lets provider free text become a reason code", () => {
    const result = normalize({
      type: "email.bounced",
      data: { email_id: MESSAGE_ID, bounce: { type: "mailbox quota exceeded, full" } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.event.reasonCode).toBe("MAILBOX_FULL")
  })

  it("calls an unclassifiable bounce UNKNOWN rather than guessing HARD", () => {
    const result = normalize({
      type: "email.bounced",
      data: { email_id: MESSAGE_ID, bounce: { type: "something nobody documented" } },
    })
    expect(result.ok).toBe(true)
    // Guessing HARD here would suppress a recipient on evidence we do not have.
    if (result.ok) expect(result.event.reasonCode).toBe("UNKNOWN")
  })

  it("cannot be driven by an enormous adversarial bounce string", () => {
    const result = normalize({
      type: "email.bounced",
      data: { email_id: MESSAGE_ID, bounce: { type: `${"x".repeat(200_000)}hard` } },
    })
    expect(result.ok).toBe(true)
    // Only a bounded prefix is classified, so the trailing "hard" is not reached.
    if (result.ok) expect(result.event.reasonCode).toBe("UNKNOWN")
  })

  it.each([
    ["a body that is not an object", { body: "nope" }],
    ["a body that is an array", { body: [] }],
    ["a null body", { body: null }],
  ])("refuses %s", (_label, patch) => {
    expect(
      normalizeProviderCallback({
        provider: RESEND_PROVIDER,
        providerEventId: EVENT_ID,
        receivedAt: NOW,
        ...patch,
      } as never),
    ).toEqual({ ok: false, code: "INVALID_JSON" })
  })

  it.each([
    ["an unmodelled type", { type: "email.exploded" }, "UNSUPPORTED_EVENT_TYPE"],
    ["a non-string type", { type: 7 }, "UNSUPPORTED_EVENT_TYPE"],
    ["a missing data object", { data: undefined }, "INVALID_JSON"],
    ["a missing message id", { data: { to: "x@example.com" } }, "MISSING_MESSAGE_ID"],
    ["a newline-bearing message id", { data: { email_id: "msg\n1" } }, "INVALID_MESSAGE_ID"],
    ["an empty message id", { data: { email_id: "" } }, "INVALID_MESSAGE_ID"],
    ["a naive timestamp", { created_at: "2026-09-12 11:59:30" }, "INVALID_TIMESTAMP"],
    ["a date-only timestamp", { created_at: "2026-09-12" }, "INVALID_TIMESTAMP"],
    ["an impossible calendar date", { created_at: "2026-02-30T00:00:00Z" }, "INVALID_TIMESTAMP"],
  ])("refuses %s", (_label, patch, code) => {
    expect(normalize(patch)).toEqual({ ok: false, code })
  })

  it("refuses an event that claims to have happened after it arrived", () => {
    expect(normalize({ created_at: "2026-09-12T12:30:00.000Z" })).toEqual({
      ok: false,
      code: "IMPLAUSIBLE_TIMESTAMP",
    })
  })

  it("refuses an event far older than the retention window", () => {
    expect(normalize({ created_at: "2025-01-01T00:00:00.000Z" })).toEqual({
      ok: false,
      code: "IMPLAUSIBLE_TIMESTAMP",
    })
  })

  it("refuses a body-supplied event id — the identity comes from the envelope", () => {
    // A forged payload carrying its own `id` cannot choose the dedup key: the
    // normalizer never reads one, and an absent envelope id is a refusal.
    const result = normalizeProviderCallback({
      provider: RESEND_PROVIDER,
      providerEventId: "",
      body: { ...body(), id: "attacker-chosen-id" },
      receivedAt: NOW,
    })
    expect(result).toEqual({ ok: false, code: "INVALID_PROVIDER_EVENT_ID" })
  })

  it("never reads a correlation tag, even when the provider supplies one", () => {
    const result = normalize({
      data: {
        email_id: MESSAGE_ID,
        tags: [{ name: "ot_attempt", value: "ful_x:1" }],
      },
    })
    expect(result.ok).toBe(true)
    // Correlation is the message id and nothing else.
    if (result.ok) {
      expect(JSON.stringify(result.event)).not.toContain("ot_attempt")
      expect(result.event.providerMessageId).toBe(MESSAGE_ID)
    }
  })
})

/* ── Application ─────────────────────────────────────────────────────────── */

const event: SanitizedProviderCallback = {
  provider: RESEND_PROVIDER,
  providerEventId: EVENT_ID,
  providerMessageId: MESSAGE_ID,
  eventType: "DELIVERED",
  reasonCode: null,
  occurredAt: "2026-09-12T11:59:30.000Z",
}

function application(
  patch: Partial<CallbackApplicationInput> = {},
): CallbackApplicationInput {
  return {
    event,
    order: { id: "ord_1", tier: "T2", status: "PAID" },
    fulfillment: {
      id: "ful_1",
      orderId: "ord_1",
      kind: "T2_APPEAL_EVIDENCE",
      status: "PROVIDER_ACCEPTED",
      statusRevision: 5,
      attemptCount: 1,
    },
    attempt: {
      fulfillmentId: "ful_1",
      attemptNumber: 1,
      provider: RESEND_PROVIDER,
      artifactVersion: 1,
    },
    currentArtifactVersion: 1,
    trustedNow: NOW,
    ...patch,
  }
}

describe("application refuses everything it cannot prove", () => {
  it("applies a delivered event to the current attempt", () => {
    expect(decideCallbackApplication(application())).toEqual({
      ok: true,
      plan: {
        fulfillmentId: "ful_1",
        attemptNumber: 1,
        eventType: "DELIVERED",
        reasonCode: null,
        occurredAt: "2026-09-12T11:59:30.000Z",
        fromStatus: "PROVIDER_ACCEPTED",
        nextStatus: "DELIVERED",
        expectedStatusRevision: 5,
        revokesCapabilities: false,
      },
    })
  })

  it("never treats a provider acceptance as a delivery", () => {
    const decision = decideCallbackApplication(
      application({
        event: { ...event, eventType: "ACCEPTED" },
        fulfillment: { ...application().fulfillment!, status: "DELIVERY_PENDING" },
      }),
    )
    expect(decision).toMatchObject({ ok: true, plan: { nextStatus: "PROVIDER_ACCEPTED" } })
  })

  it.each([...TERMINAL_LOCK_STATUSES])("never resurrects terminal %s", (status) => {
    expect(
      decideCallbackApplication(
        application({ fulfillment: { ...application().fulfillment!, status } }),
      ),
    ).toEqual({ ok: false, code: "TERMINAL_LOCKED" })
  })

  it("marks a terminal outcome as one that ends customer access", () => {
    for (const eventType of ["BOUNCED", "COMPLAINED", "FAILED"] as const) {
      const decision = decideCallbackApplication(
        application({ event: { ...event, eventType } }),
      )
      expect(decision).toMatchObject({ ok: true, plan: { revokesCapabilities: true } })
    }
  })

  it("refuses a late event about a superseded attempt", () => {
    expect(
      decideCallbackApplication(
        application({
          attempt: { ...application().attempt!, attemptNumber: 1 },
          fulfillment: { ...application().fulfillment!, attemptCount: 2 },
        }),
      ),
    ).toEqual({ ok: false, code: "STALE_ATTEMPT" })
  })

  it("refuses an event about a packet that is no longer current", () => {
    expect(
      decideCallbackApplication(application({ currentArtifactVersion: 2 })),
    ).toEqual({ ok: false, code: "ARTIFACT_SUPERSEDED" })
    expect(
      decideCallbackApplication(application({ currentArtifactVersion: null })),
    ).toEqual({ ok: false, code: "ARTIFACT_SUPERSEDED" })
  })

  it.each([
    ["a foreign order", { fulfillment: { ...application().fulfillment!, orderId: "ord_other" } }, "FULFILLMENT_ORDER_MISMATCH"],
    ["a foreign fulfillment", { attempt: { ...application().attempt!, fulfillmentId: "ful_other" } }, "ATTEMPT_FULFILLMENT_MISMATCH"],
    ["another provider's attempt", { attempt: { ...application().attempt!, provider: "postmark" } }, "ATTEMPT_PROVIDER_MISMATCH"],
    ["a refunded order", { order: { id: "ord_1", tier: "T2", status: "REFUNDED" } }, "INELIGIBLE_SETTLEMENT"],
    ["a non-T2 order", { order: { id: "ord_1", tier: "T3", status: "PAID" } }, "INELIGIBLE_SETTLEMENT"],
    ["a missing attempt", { attempt: null }, "ATTEMPT_NOT_FOUND"],
    ["a missing order", { order: null }, "ORDER_NOT_FOUND"],
    ["a missing fulfillment", { fulfillment: null }, "FULFILLMENT_NOT_FOUND"],
    ["a foreign fulfillment kind", { fulfillment: { ...application().fulfillment!, kind: "OTHER" } }, "FULFILLMENT_NOT_FOUND"],
    ["an untrusted clock", { trustedNow: "nope" }, "UNTRUSTED_CLOCK"],
  ])("refuses %s", (_label, patch, code) => {
    expect(decideCallbackApplication(application(patch as never))).toEqual({ ok: false, code })
  })

  it("only ever applies from a status a send has actually reached", () => {
    for (const status of FULFILLMENT_STATUSES) {
      const decision = decideCallbackApplication(
        application({ fulfillment: { ...application().fulfillment!, status } }),
      )
      const reachable = ["DELIVERY_PENDING", "PROVIDER_ACCEPTED", "DELAYED"]
      if (reachable.includes(status)) expect(decision.ok).toBe(true)
      else expect(decision.ok).toBe(false)
    }
  })
})

describe("reconciliation bounds", () => {
  it("stops replaying a row once it is older than the window", () => {
    expect(isReconcilable({ receivedAt: "2026-09-11T12:00:00.000Z", trustedNow: NOW })).toBe(true)
    expect(isReconcilable({ receivedAt: "2026-08-01T12:00:00.000Z", trustedNow: NOW })).toBe(false)
  })

  it("refuses a row that claims to have arrived in the future", () => {
    expect(isReconcilable({ receivedAt: "2026-09-13T12:00:00.000Z", trustedNow: NOW })).toBe(false)
  })

  it("keeps the durable unmatched store bounded", () => {
    expect(MAX_UNMATCHED_CALLBACKS).toBeGreaterThan(0)
    expect(MAX_UNMATCHED_CALLBACKS).toBeLessThanOrEqual(10_000)
  })
})

/**
 * A provider writes its own timestamps, and RFC3339 lets it write them in shapes
 * this system never produces. The strict canonical validator is right for our
 * OWN instants and wrong for theirs: Resend documents `created_at` with six
 * fractional digits and a `+00:00` offset, and refusing those would drop a
 * genuine, signed, authenticated `email.delivered` on the floor — the packet
 * would simply never be recorded as delivered.
 *
 * The fix is a wider grammar normalized ONCE, deliberately, with explicit
 * arithmetic. It is emphatically not `new Date(value)`: these assertions pin
 * both halves — what is now admitted, and what is still refused that a
 * permissive `Date` coercion would have accepted.
 */
describe("provider-stated created_at is normalized, never coerced", () => {
  const occurredAt = (patch: Record<string, unknown>) => {
    const result = normalize(patch)
    if (!result.ok) throw new Error(`expected admission, got ${result.code}`)
    return result.event.occurredAt
  }

  it.each([
    ["the canonical form unchanged", "2026-09-12T11:59:30.000Z", "2026-09-12T11:59:30.000Z"],
    ["no fractional part at all", "2026-09-12T11:59:30Z", "2026-09-12T11:59:30.000Z"],
    ["six fractional digits, truncated", "2026-09-12T11:59:30.674981Z", "2026-09-12T11:59:30.674Z"],
    ["nine fractional digits, truncated", "2026-09-12T11:59:30.999999999Z", "2026-09-12T11:59:30.999Z"],
    ["a single fractional digit as TENTHS", "2026-09-12T11:59:30.6Z", "2026-09-12T11:59:30.600Z"],
    ["two fractional digits as HUNDREDTHS", "2026-09-12T11:59:30.06Z", "2026-09-12T11:59:30.060Z"],
    ["a zero offset spelled +00:00", "2026-09-12T11:59:30.674981+00:00", "2026-09-12T11:59:30.674Z"],
    ["RFC3339's unknown-offset -00:00", "2026-09-12T11:59:30.000-00:00", "2026-09-12T11:59:30.000Z"],
    ["a lowercase z", "2026-09-12T11:59:30.000z", "2026-09-12T11:59:30.000Z"],
    ["a positive offset, resolved by subtraction", "2026-09-12T13:29:30.000+01:30", "2026-09-12T11:59:30.000Z"],
    ["a negative offset, resolved by addition", "2026-09-12T06:59:30.000-05:00", "2026-09-12T11:59:30.000Z"],
    ["an offset that crosses a date boundary", "2026-09-13T00:59:30.000+13:00", "2026-09-12T11:59:30.000Z"],
  ])("admits %s", (_label, created_at, expected) => {
    expect(occurredAt({ created_at })).toBe(expected)
  })

  it("truncates toward the PAST, so an event can never outrun its arrival", () => {
    // Rounding .9999 up would put this event after `receivedAt` and make a
    // truthful provider look like it reported the future.
    expect(occurredAt({ created_at: "2026-09-12T11:59:30.999999Z" })).toBe(
      "2026-09-12T11:59:30.999Z",
    )
  })

  it.each([
    ["a naive local time", "2026-09-12T11:59:30"],
    ["a space separator", "2026-09-12 11:59:30Z"],
    ["a date only", "2026-09-12"],
    ["a year only", "2026"],
    ["a spelled-out date Date would accept", "Sep 12 2026 11:59:30 UTC"],
    ["an impossible calendar date", "2026-02-30T00:00:00Z"],
    ["month 13", "2026-13-01T00:00:00Z"],
    ["hour 24", "2026-09-12T24:00:00Z"],
    ["a leap second", "2026-09-12T11:59:60Z"],
    ["a 60-minute offset field", "2026-09-12T11:59:30.000+00:60"],
    ["a 24-hour offset field", "2026-09-12T11:59:30.000+24:00"],
    ["ten fractional digits", "2026-09-12T11:59:30.0000000001Z"],
    ["a bare offset sign", "2026-09-12T11:59:30.000+"],
    ["an unterminated instant", "2026-09-12T11:59:30.000"],
    ["leading whitespace", " 2026-09-12T11:59:30.000Z"],
    ["trailing whitespace", "2026-09-12T11:59:30.000Z "],
    ["an epoch integer as a string", "1789041570000"],
  ])("still refuses %s", (_label, created_at) => {
    expect(normalize({ created_at })).toEqual({
      ok: false,
      code: "INVALID_TIMESTAMP",
    })
  })

  it.each([null, 1789041570000, {}, [], true, undefined])(
    "refuses the non-string created_at %p",
    (created_at) => {
      expect(normalize({ created_at })).toEqual({
        ok: false,
        code: "INVALID_TIMESTAMP",
      })
    },
  )

  it("applies the plausibility window to the NORMALIZED instant, not the text", () => {
    // 13:29:30+01:30 is 11:59:30Z — inside the window. The same wall-clock
    // digits read naively would be 89 minutes in the future and implausible.
    expect(normalize({ created_at: "2026-09-12T13:29:30.000+01:30" }).ok).toBe(true)
    // And an offset that genuinely puts the event in the future is still caught.
    expect(normalize({ created_at: "2026-09-12T12:30:00.000-00:00" })).toEqual({
      ok: false,
      code: "IMPLAUSIBLE_TIMESTAMP",
    })
  })
})
