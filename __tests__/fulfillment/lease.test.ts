/**
 * @jest-environment node
 *
 * Matrix row 9 + remediation blocker D: the lease decision matrix is computed
 * purely (no DB claim) AND fails closed — malformed clock/expiry/identity is never
 * claimable, and renewal requires possession of the matching token.
 */
import { evaluateLease } from "@/lib/fulfillment/lease"

const now = "2026-08-06T12:00:00.000Z"

describe("evaluateLease — happy paths", () => {
  it("no lease → CLAIMABLE", () => {
    expect(evaluateLease({ lease: null, now, requester: "worker-1" })).toEqual({ decision: "CLAIMABLE", reason: null })
  })

  it("expired lease → EXPIRED_RECLAIMABLE", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: "2026-08-06T11:59:59.000Z" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE")
  })

  it("a lease expiring exactly at now is reclaimable", () => {
    const r = evaluateLease({ lease: { owner: "w2", token: "t", expiresAt: now }, now, requester: "w1" })
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE")
  })

  it("active lease owned by requester WITH matching token → RENEWABLE", () => {
    const r = evaluateLease({
      lease: { owner: "worker-1", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
      requesterToken: "tok",
    })
    expect(r.decision).toBe("RENEWABLE")
  })

  it("active lease held by another worker → HELD_BY_OTHER (no owner echo)", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("HELD_BY_OTHER")
    expect(JSON.stringify(r)).not.toContain("worker-2") // never echoes raw input
  })
})

describe("evaluateLease — fail closed (blocker D)", () => {
  it("same owner but omitted token → HELD_BY_OTHER, not RENEWABLE", () => {
    const r = evaluateLease({
      lease: { owner: "worker-1", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("HELD_BY_OTHER")
  })

  it("same owner with wrong/empty token → HELD_BY_OTHER", () => {
    for (const requesterToken of ["WRONG", "", "   "]) {
      const r = evaluateLease({
        lease: { owner: "worker-1", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
        now,
        requester: "worker-1",
        requesterToken,
      })
      expect(r.decision).toBe("HELD_BY_OTHER")
    }
  })

  it("invalid `now` is never claimable/reclaimable/renewable → INVALID", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: "2026-08-06T11:00:00.000Z" },
      now: "not-a-date",
      requester: "worker-1",
    })
    expect(r.decision).toBe("INVALID")
  })

  it("invalid expiry is never reclaimable → INVALID", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: "whenever" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("INVALID")
  })

  it("empty/malformed requester or lease identity → INVALID", () => {
    expect(evaluateLease({ lease: null, now, requester: "" }).decision).toBe("INVALID")
    expect(evaluateLease({ lease: null, now, requester: "   " }).decision).toBe("INVALID")
    expect(
      evaluateLease({ lease: { owner: "", token: "t", expiresAt: "2026-08-06T13:00:00.000Z" }, now, requester: "w1" }).decision
    ).toBe("INVALID")
    expect(
      evaluateLease({ lease: { owner: "w2", token: "", expiresAt: "2026-08-06T13:00:00.000Z" }, now, requester: "w1" }).decision
    ).toBe("INVALID")
  })
})
