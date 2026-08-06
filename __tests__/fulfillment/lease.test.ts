/**
 * @jest-environment node
 *
 * Matrix row 9: the active/expired lease decision matrix, computed purely with no
 * database claim performed.
 */
import { evaluateLease } from "@/lib/fulfillment/lease"

const now = "2026-08-06T12:00:00.000Z"

describe("evaluateLease", () => {
  it("no lease → CLAIMABLE", () => {
    expect(evaluateLease({ lease: null, now, requester: "worker-1" })).toEqual({ decision: "CLAIMABLE", owner: null })
  })

  it("expired lease → EXPIRED_RECLAIMABLE regardless of owner", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: "2026-08-06T11:59:59.000Z" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE")
  })

  it("active lease owned by the requester → RENEWABLE", () => {
    const r = evaluateLease({
      lease: { owner: "worker-1", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
      requesterToken: "tok",
    })
    expect(r.decision).toBe("RENEWABLE")
  })

  it("active lease owned by the requester but with a mismatched token → HELD_BY_OTHER", () => {
    const r = evaluateLease({
      lease: { owner: "worker-1", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
      requesterToken: "WRONG",
    })
    expect(r.decision).toBe("HELD_BY_OTHER")
  })

  it("active lease held by another worker → HELD_BY_OTHER", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "tok", expiresAt: "2026-08-06T12:05:00.000Z" },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("HELD_BY_OTHER")
    expect(r.owner).toBe("worker-2")
  })

  it("a lease expiring exactly at now is treated as expired (fail forward to reclaim)", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: now },
      now,
      requester: "worker-1",
    })
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE")
  })
})
