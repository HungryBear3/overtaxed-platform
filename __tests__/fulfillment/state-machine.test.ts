/**
 * @jest-environment node
 *
 * Matrix rows 4, 5, 6: provider-accepted is distinct from delivered; duplicate
 * events are idempotent; out-of-order delayed/delivered/bounced/complained/failed
 * events remain monotonic and safe; terminal states are never resurrected.
 */
import {
  canTransition,
  initialFoldState,
  foldDeliveryEvent,
  foldDeliveryEvents,
  deliveryEventKey,
  validateDeliveryEvent,
  nextDeliveryAttemptNumber,
} from "@/lib/fulfillment/state"
import type { DeliveryEvent } from "@/lib/fulfillment/state"

function ev(
  overrides: Partial<DeliveryEvent> & { providerEventId: string; eventType: DeliveryEvent["eventType"]; sequence: number }
): DeliveryEvent {
  // Derive a stable timestamp; fall back for non-finite sequences (invalid fixtures).
  const seq = Number.isFinite(overrides.sequence) ? overrides.sequence : 1
  return {
    provider: "resend",
    occurredAt: new Date(1000 * seq).toISOString(),
    ...overrides,
  }
}

describe("allowed monotonic transitions", () => {
  it("ARTIFACT_READY may begin delivery but cannot jump straight to DELIVERED", () => {
    expect(canTransition("ARTIFACT_READY", "DELIVERY_PENDING")).toBe(true)
    expect(canTransition("ARTIFACT_READY", "DELIVERED")).toBe(false)
  })

  it("terminal states cannot transition anywhere", () => {
    for (const t of ["BOUNCED", "COMPLAINED", "CANCELLED", "FAILED", "INELIGIBLE"] as const) {
      expect(canTransition(t, "DELIVERED")).toBe(false)
      expect(canTransition(t, "ARTIFACT_PENDING")).toBe(false)
    }
  })

  it("provider acceptance and delivery are distinct adjacent states", () => {
    expect(canTransition("DELIVERY_PENDING", "PROVIDER_ACCEPTED")).toBe(true)
    expect(canTransition("PROVIDER_ACCEPTED", "DELIVERED")).toBe(true)
  })
})

describe("foldDeliveryEvent — provider accepted is NOT delivered", () => {
  it("ACCEPTED yields PROVIDER_ACCEPTED, not DELIVERED", () => {
    const s0 = initialFoldState("DELIVERY_PENDING")
    const s1 = foldDeliveryEvent(s0, ev({ providerEventId: "e1", eventType: "ACCEPTED", sequence: 1 }))
    expect(s1.applied).toBe(true)
    expect(s1.state.status).toBe("PROVIDER_ACCEPTED")
    expect(s1.state.status).not.toBe("DELIVERED")
    const s2 = foldDeliveryEvent(s1.state, ev({ providerEventId: "e2", eventType: "DELIVERED", sequence: 2 }))
    expect(s2.state.status).toBe("DELIVERED")
    expect(s2.state.statusRevision).toBe(2)
  })
})

describe("foldDeliveryEvent — duplicate events are idempotent (row 5)", () => {
  it("replaying the same providerEventId does not advance status or revision", () => {
    const s0 = initialFoldState("DELIVERY_PENDING")
    const s1 = foldDeliveryEvent(s0, ev({ providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }))
    const s2 = foldDeliveryEvent(s1.state, ev({ providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }))
    expect(s2.applied).toBe(false)
    expect(s2.reason).toBe("DUPLICATE_EVENT")
    expect(s2.state.statusRevision).toBe(s1.state.statusRevision)
  })
})

describe("foldDeliveryEvents — out-of-order safety (row 6)", () => {
  it("a delayed event arriving after delivered does not regress the status", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
      ev({ providerEventId: "l", eventType: "DELAYED", sequence: 1 }),
    ])
    expect(final.status).toBe("DELIVERED")
  })

  it("folding is order-independent for the final status", () => {
    const events = [
      ev({ providerEventId: "a", eventType: "ACCEPTED", sequence: 1 }),
      ev({ providerEventId: "b", eventType: "DELIVERED", sequence: 2 }),
    ]
    const forward = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), events)
    const reversed = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [...events].reverse())
    expect(forward.status).toBe("DELIVERED")
    expect(reversed.status).toBe("DELIVERED")
  })

  it("a terminal bounce cannot be resurrected by a later delivered event", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 1 }),
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
    ])
    expect(final.status).toBe("BOUNCED")
  })

  it("a complaint may follow a delivered success, but a delayed cannot regress it", () => {
    const complained = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 1 }),
      ev({ providerEventId: "c", eventType: "COMPLAINED", sequence: 2 }),
    ])
    expect(complained.status).toBe("COMPLAINED")
  })

  it("provider events never apply to a fulfillment that has not started delivery", () => {
    const s = foldDeliveryEvent(initialFoldState("NEEDS_RECONCILIATION"), ev({ providerEventId: "x", eventType: "DELIVERED", sequence: 1 }))
    expect(s.applied).toBe(false)
    expect(s.state.status).toBe("NEEDS_RECONCILIATION")
  })
})

describe("nextDeliveryAttemptNumber", () => {
  it("is monotonic starting at 1", () => {
    expect(nextDeliveryAttemptNumber(0)).toBe(1)
    expect(nextDeliveryAttemptNumber(1)).toBe(2)
    expect(nextDeliveryAttemptNumber(4)).toBe(5)
  })
})

// ---- Remediation blocker C: schema-aligned, deterministic, fail-closed folding ----

describe("dedupe identity is the (provider, providerEventId) tuple", () => {
  it("the same event id from two providers does NOT alias", () => {
    const s0 = initialFoldState("DELIVERY_PENDING")
    const s1 = foldDeliveryEvent(s0, ev({ provider: "resend", providerEventId: "shared", eventType: "ACCEPTED", sequence: 1 }))
    const s2 = foldDeliveryEvent(s1.state, ev({ provider: "postmark", providerEventId: "shared", eventType: "DELIVERED", sequence: 2 }))
    expect(s1.applied).toBe(true)
    expect(s2.applied).toBe(true) // distinct composite key → processed, not collapsed
    expect(s2.state.status).toBe("DELIVERED")
  })

  it("an exact provider+id duplicate is idempotent", () => {
    const s0 = initialFoldState("DELIVERY_PENDING")
    const s1 = foldDeliveryEvent(s0, ev({ provider: "resend", providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }))
    const s2 = foldDeliveryEvent(s1.state, ev({ provider: "resend", providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }))
    expect(s2.applied).toBe(false)
    expect(s2.reason).toBe("DUPLICATE_EVENT")
    expect(s2.state.statusRevision).toBe(s1.state.statusRevision)
  })

  it("deliveryEventKey combines provider and event id", () => {
    expect(deliveryEventKey({ provider: "resend", providerEventId: "e1" })).not.toBe(
      deliveryEventKey({ provider: "postmark", providerEventId: "e1" })
    )
  })
})

describe("invalid events fail closed without advancing pointers", () => {
  it.each([
    ["INVALID_PROVIDER", ev({ providerEventId: "e", eventType: "DELIVERED", sequence: 1, provider: "" })],
    ["INVALID_PROVIDER_EVENT_ID", ev({ providerEventId: "", eventType: "DELIVERED", sequence: 1 })],
    ["INVALID_SEQUENCE", ev({ providerEventId: "e", eventType: "DELIVERED", sequence: Number.NaN })],
    ["INVALID_SEQUENCE", ev({ providerEventId: "e", eventType: "DELIVERED", sequence: 0 })],
    ["INVALID_SEQUENCE", ev({ providerEventId: "e", eventType: "DELIVERED", sequence: -1 })],
    ["INVALID_SEQUENCE", ev({ providerEventId: "e", eventType: "DELIVERED", sequence: 1.5 })],
    ["INVALID_TIMESTAMP", { provider: "resend", providerEventId: "e", eventType: "DELIVERED" as const, sequence: 1, occurredAt: "not-a-date" }],
  ])("rejects %s without changing status or pointers", (reason, event) => {
    expect(validateDeliveryEvent(event as DeliveryEvent)).toBe(reason)
    const s0 = initialFoldState("DELIVERY_PENDING")
    const r = foldDeliveryEvent(s0, event as DeliveryEvent)
    expect(r.applied).toBe(false)
    expect(r.reason).toBe(reason)
    expect(r.state.status).toBe("DELIVERY_PENDING")
    expect(r.state.lastSequence).toBeNull()
    expect(r.state.seenKeys).toHaveLength(0)
  })
})

describe("conflicting duplicate local sequences fail closed deterministically", () => {
  const conflict = [
    ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 1 }),
    ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 1 }),
  ]
  it("canonical fold yields the same fail-closed result in both input orders", () => {
    const forward = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), conflict)
    const reversed = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [...conflict].reverse())
    expect(forward.conflicted).toBe(true)
    expect(forward.reason).toBe("SEQUENCE_CONFLICT")
    expect(forward.status).toBe("DELIVERY_PENDING") // never advanced from initial
    expect(reversed).toEqual(forward) // acceptance verdict + status are order-independent
  })

  it("a later delivered event cannot resurrect an earlier terminal bounce", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 2 }),
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 5 }),
    ])
    expect(final.status).toBe("BOUNCED")
  })

  it("invalid events are dropped from the canonical fold rather than poisoning it", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "a", eventType: "ACCEPTED", sequence: 1 }),
      { provider: "resend", providerEventId: "bad", eventType: "DELIVERED", sequence: Number.NaN, occurredAt: "x" } as DeliveryEvent,
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
    ])
    expect(final.status).toBe("DELIVERED")
    expect(final.conflicted).toBe(false)
  })
})
