/**
 * @jest-environment node
 *
 * Matrix row 9 + remediation blocker D: the lease decision matrix is computed
 * purely (no DB claim) AND fails closed — malformed clock/expiry/identity is never
 * claimable, and renewal requires possession of the matching token.
 */
import { evaluateLease } from "@/lib/fulfillment/lease";

const now = "2026-08-06T12:00:00.000Z";

describe("evaluateLease — happy paths", () => {
  it("no lease → CLAIMABLE", () => {
    expect(evaluateLease({ lease: null, now, requester: "worker-1" })).toEqual({
      decision: "CLAIMABLE",
      reason: null,
    });
  });

  it("expired lease → EXPIRED_RECLAIMABLE", () => {
    const r = evaluateLease({
      lease: {
        owner: "worker-2",
        token: "t",
        expiresAt: "2026-08-06T11:59:59.000Z",
      },
      now,
      requester: "worker-1",
    });
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE");
  });

  it("a lease expiring exactly at now is reclaimable", () => {
    const r = evaluateLease({
      lease: { owner: "w2", token: "t", expiresAt: now },
      now,
      requester: "w1",
    });
    expect(r.decision).toBe("EXPIRED_RECLAIMABLE");
  });

  it("active lease owned by requester WITH matching token → RENEWABLE", () => {
    const r = evaluateLease({
      lease: {
        owner: "worker-1",
        token: "tok",
        expiresAt: "2026-08-06T12:05:00.000Z",
      },
      now,
      requester: "worker-1",
      requesterToken: "tok",
    });
    expect(r.decision).toBe("RENEWABLE");
  });

  it("active lease held by another worker → HELD_BY_OTHER (no owner echo)", () => {
    const r = evaluateLease({
      lease: {
        owner: "worker-2",
        token: "tok",
        expiresAt: "2026-08-06T12:05:00.000Z",
      },
      now,
      requester: "worker-1",
    });
    expect(r.decision).toBe("HELD_BY_OTHER");
    expect(JSON.stringify(r)).not.toContain("worker-2"); // never echoes raw input
  });
});

describe("evaluateLease — fail closed (blocker D)", () => {
  it("same owner but omitted token → HELD_BY_OTHER, not RENEWABLE", () => {
    const r = evaluateLease({
      lease: {
        owner: "worker-1",
        token: "tok",
        expiresAt: "2026-08-06T12:05:00.000Z",
      },
      now,
      requester: "worker-1",
    });
    expect(r.decision).toBe("HELD_BY_OTHER");
  });

  it("same owner with wrong/empty token → HELD_BY_OTHER", () => {
    for (const requesterToken of ["WRONG", "", "   "]) {
      const r = evaluateLease({
        lease: {
          owner: "worker-1",
          token: "tok",
          expiresAt: "2026-08-06T12:05:00.000Z",
        },
        now,
        requester: "worker-1",
        requesterToken,
      });
      expect(r.decision).toBe("HELD_BY_OTHER");
    }
  });

  it("invalid `now` is never claimable/reclaimable/renewable → INVALID", () => {
    const r = evaluateLease({
      lease: {
        owner: "worker-2",
        token: "t",
        expiresAt: "2026-08-06T11:00:00.000Z",
      },
      now: "not-a-date",
      requester: "worker-1",
    });
    expect(r.decision).toBe("INVALID");
  });

  it("invalid expiry is never reclaimable → INVALID", () => {
    const r = evaluateLease({
      lease: { owner: "worker-2", token: "t", expiresAt: "whenever" },
      now,
      requester: "worker-1",
    });
    expect(r.decision).toBe("INVALID");
  });

  it("empty/malformed requester or lease identity → INVALID", () => {
    expect(evaluateLease({ lease: null, now, requester: "" }).decision).toBe(
      "INVALID",
    );
    expect(evaluateLease({ lease: null, now, requester: "   " }).decision).toBe(
      "INVALID",
    );
    expect(
      evaluateLease({
        lease: { owner: "", token: "t", expiresAt: "2026-08-06T13:00:00.000Z" },
        now,
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
    expect(
      evaluateLease({
        lease: {
          owner: "w2",
          token: "",
          expiresAt: "2026-08-06T13:00:00.000Z",
        },
        now,
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
  });
});

// ---- Remediation-2 D: strict canonical timestamps + bounded opaque identities ----

describe("evaluateLease — strict instant + opaque identity hardening", () => {
  const active = "2026-08-06T13:00:00.000Z";
  it('expiry "0" is not a valid instant → INVALID (never EXPIRED_RECLAIMABLE)', () => {
    expect(
      evaluateLease({
        lease: { owner: "w2", token: "t", expiresAt: "0" },
        now,
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
  });

  it("an impossible calendar date (Feb 30) → INVALID", () => {
    expect(
      evaluateLease({
        lease: {
          owner: "w2",
          token: "t",
          expiresAt: "2026-02-30T12:00:00.000Z",
        },
        now,
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
  });

  it.each(["2026-08-06T13:00:00", "2026-08-06", " 2026-08-06T13:00:00.000Z"])(
    "naive/date-only/padded expiry %p → INVALID",
    (expiresAt) => {
      expect(
        evaluateLease({
          lease: { owner: "w2", token: "t", expiresAt },
          now,
          requester: "w1",
        }).decision,
      ).toBe("INVALID");
    },
  );

  it("a naive `now` (no Z) → INVALID", () => {
    expect(
      evaluateLease({
        lease: { owner: "w2", token: "t", expiresAt: active },
        now: "2026-08-06T12:00:00",
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
  });

  it("a newline-bearing lease token → INVALID (never RENEWABLE)", () => {
    expect(
      evaluateLease({
        lease: { owner: "w1", token: "tok\nline", expiresAt: active },
        now,
        requester: "w1",
        requesterToken: "tok\nline",
      }).decision,
    ).toBe("INVALID");
  });

  it("a newline-bearing owner → INVALID", () => {
    expect(
      evaluateLease({
        lease: { owner: "w1\nx", token: "tok", expiresAt: active },
        now,
        requester: "w1\nx",
        requesterToken: "tok",
      }).decision,
    ).toBe("INVALID");
  });

  it("a same-owner request with a newline-bearing provided token cannot renew", () => {
    const r = evaluateLease({
      lease: { owner: "w1", token: "tok", expiresAt: active },
      now,
      requester: "w1",
      requesterToken: "to\nk",
    });
    expect(r.decision).toBe("HELD_BY_OTHER");
  });

  it("an over-bound owner/token → INVALID", () => {
    const huge = "x".repeat(256);
    expect(
      evaluateLease({
        lease: { owner: huge, token: "t", expiresAt: active },
        now,
        requester: "w1",
      }).decision,
    ).toBe("INVALID");
  });
});

// ---- Remediation-4 blocker 1: Unicode/C1 controls cannot authorize a lease ----

describe("evaluateLease — Unicode/C1 control identities fail closed", () => {
  const now = "2026-08-06T12:00:00.000Z";
  const active = "2026-08-06T13:00:00.000Z";
  const withCp = (cp: number) => "tok" + String.fromCharCode(cp) + "x";

  it.each([
    ["U+2028 LINE SEPARATOR", 0x2028],
    ["U+2029 PARAGRAPH SEPARATOR", 0x2029],
    ["U+0085 NEXT LINE", 0x0085],
    ["U+00A0 NO-BREAK SPACE", 0x00a0],
    ["U+200B ZERO WIDTH SPACE", 0x200b],
    ["U+D800 lone surrogate", 0xd800],
  ])(
    "a matching owner+token containing %s cannot RENEW (fails closed)",
    (_label, cp) => {
      const bad = withCp(cp);
      const r = evaluateLease({
        lease: { owner: bad, token: bad, expiresAt: active },
        now,
        requester: bad,
        requesterToken: bad,
      });
      expect(r.decision).not.toBe("RENEWABLE");
      expect(r.decision).not.toBe("CLAIMABLE");
      expect(r.decision).not.toBe("EXPIRED_RECLAIMABLE");
      expect(r.decision).toBe("INVALID");
    },
  );

  it("a valid owner but a requester token bearing U+2028 cannot renew", () => {
    const r = evaluateLease({
      lease: { owner: "worker-1", token: "tok", expiresAt: active },
      now,
      requester: "worker-1",
      requesterToken: "to" + String.fromCharCode(0x2028) + "k",
    });
    expect(r.decision).toBe("HELD_BY_OTHER");
  });

  it("does not echo the raw rejected identity in the reason", () => {
    const bad = withCp(0x2028);
    const r = evaluateLease({
      lease: { owner: bad, token: bad, expiresAt: active },
      now,
      requester: bad,
    });
    expect(r.reason ?? "").not.toContain(String.fromCharCode(0x2028));
  });
});
