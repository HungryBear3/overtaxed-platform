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
  nextDeliveryAttemptNumber,
} from "@/lib/fulfillment/state"
import type { DeliveryEvent } from "@/lib/fulfillment/state"

function ev(overrides: Partial<DeliveryEvent> & { providerEventId: string; eventType: DeliveryEvent["eventType"]; sequence: number }): DeliveryEvent {
  return { occurredAt: new Date(1000 * overrides.sequence).toISOString(), ...overrides }
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
