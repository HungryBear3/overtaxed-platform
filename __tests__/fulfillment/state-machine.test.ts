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
  deliveryEventSignature,
  validateDeliveryEvent,
  nextDeliveryAttemptNumber,
} from "@/lib/fulfillment/state";
import type { DeliveryEvent } from "@/lib/fulfillment/state";

function ev(
  overrides: Partial<DeliveryEvent> & {
    providerEventId: string;
    eventType: DeliveryEvent["eventType"];
    sequence: number;
  },
): DeliveryEvent {
  // Derive a stable timestamp; fall back for non-finite / out-of-Date-range
  // sequences (invalid fixtures) so the factory never throws.
  const seq =
    Number.isFinite(overrides.sequence) && Math.abs(overrides.sequence) < 1e11
      ? overrides.sequence
      : 1;
  return {
    provider: "resend",
    occurredAt: new Date(1000 * seq).toISOString(),
    ...overrides,
  };
}

describe("allowed monotonic transitions", () => {
  it("ARTIFACT_READY may begin delivery but cannot jump straight to DELIVERED", () => {
    expect(canTransition("ARTIFACT_READY", "DELIVERY_PENDING")).toBe(true);
    expect(canTransition("ARTIFACT_READY", "DELIVERED")).toBe(false);
  });

  it("terminal states cannot transition anywhere", () => {
    for (const t of [
      "BOUNCED",
      "COMPLAINED",
      "CANCELLED",
      "FAILED",
      "INELIGIBLE",
    ] as const) {
      expect(canTransition(t, "DELIVERED")).toBe(false);
      expect(canTransition(t, "ARTIFACT_PENDING")).toBe(false);
    }
  });

  it("provider acceptance and delivery are distinct adjacent states", () => {
    expect(canTransition("DELIVERY_PENDING", "PROVIDER_ACCEPTED")).toBe(true);
    expect(canTransition("PROVIDER_ACCEPTED", "DELIVERED")).toBe(true);
  });
});

describe("foldDeliveryEvent — provider accepted is NOT delivered", () => {
  it("ACCEPTED yields PROVIDER_ACCEPTED, not DELIVERED", () => {
    const s0 = initialFoldState("DELIVERY_PENDING");
    const s1 = foldDeliveryEvent(
      s0,
      ev({ providerEventId: "e1", eventType: "ACCEPTED", sequence: 1 }),
    );
    expect(s1.applied).toBe(true);
    expect(s1.state.status).toBe("PROVIDER_ACCEPTED");
    expect(s1.state.status).not.toBe("DELIVERED");
    const s2 = foldDeliveryEvent(
      s1.state,
      ev({ providerEventId: "e2", eventType: "DELIVERED", sequence: 2 }),
    );
    expect(s2.state.status).toBe("DELIVERED");
    expect(s2.state.statusRevision).toBe(2);
  });
});

describe("foldDeliveryEvent — exact replays are idempotent (row 5)", () => {
  it("replaying the same event (identical content) does not advance status or revision", () => {
    const s0 = initialFoldState("DELIVERY_PENDING");
    const s1 = foldDeliveryEvent(
      s0,
      ev({ providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }),
    );
    const s2 = foldDeliveryEvent(
      s1.state,
      ev({ providerEventId: "dup", eventType: "DELIVERED", sequence: 1 }),
    );
    expect(s2.applied).toBe(false);
    expect(s2.reason).toBe("EXACT_REPLAY");
    expect(s2.state.statusRevision).toBe(s1.state.statusRevision);
  });
});

describe("foldDeliveryEvents — out-of-order safety (row 6)", () => {
  it("a delayed event arriving after delivered does not regress the status", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
      ev({ providerEventId: "l", eventType: "DELAYED", sequence: 1 }),
    ]);
    expect(final.status).toBe("DELIVERED");
  });

  it("folding is order-independent for the final status", () => {
    const events = [
      ev({ providerEventId: "a", eventType: "ACCEPTED", sequence: 1 }),
      ev({ providerEventId: "b", eventType: "DELIVERED", sequence: 2 }),
    ];
    const forward = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      events,
    );
    const reversed = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      [...events].reverse(),
    );
    expect(forward.status).toBe("DELIVERED");
    expect(reversed.status).toBe("DELIVERED");
  });

  it("a terminal bounce cannot be resurrected by a later delivered event", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 1 }),
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
    ]);
    expect(final.status).toBe("BOUNCED");
  });

  it("a complaint may follow a delivered success, but a delayed cannot regress it", () => {
    const complained = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      [
        ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 1 }),
        ev({ providerEventId: "c", eventType: "COMPLAINED", sequence: 2 }),
      ],
    );
    expect(complained.status).toBe("COMPLAINED");
  });

  it("provider events never apply to a fulfillment that has not started delivery", () => {
    const s = foldDeliveryEvent(
      initialFoldState("NEEDS_RECONCILIATION"),
      ev({ providerEventId: "x", eventType: "DELIVERED", sequence: 1 }),
    );
    expect(s.applied).toBe(false);
    expect(s.state.status).toBe("NEEDS_RECONCILIATION");
  });
});

describe("nextDeliveryAttemptNumber — discriminated, fail-closed", () => {
  it("is monotonic starting at 1 for valid counts", () => {
    expect(nextDeliveryAttemptNumber(0)).toEqual({ ok: true, value: 1 });
    expect(nextDeliveryAttemptNumber(1)).toEqual({ ok: true, value: 2 });
    expect(nextDeliveryAttemptNumber(4)).toEqual({ ok: true, value: 5 });
  });

  it("fails closed on malformed / out-of-range counts (never normalizes to 1)", () => {
    for (const bad of [
      Number.NaN,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER,
      2147483647,
      undefined as unknown as number,
    ]) {
      expect(nextDeliveryAttemptNumber(bad)).toEqual({
        ok: false,
        reason: "INVALID_ATTEMPT_COUNT",
      });
    }
  });
});

// ---- Remediation blocker C: schema-aligned, deterministic, fail-closed folding ----

describe("dedupe identity is the (provider, providerEventId) tuple", () => {
  it("the same event id from two providers does NOT alias", () => {
    const s0 = initialFoldState("DELIVERY_PENDING");
    const s1 = foldDeliveryEvent(
      s0,
      ev({
        provider: "resend",
        providerEventId: "shared",
        eventType: "ACCEPTED",
        sequence: 1,
      }),
    );
    const s2 = foldDeliveryEvent(
      s1.state,
      ev({
        provider: "postmark",
        providerEventId: "shared",
        eventType: "DELIVERED",
        sequence: 2,
      }),
    );
    expect(s1.applied).toBe(true);
    expect(s2.applied).toBe(true); // distinct composite key → processed, not collapsed
    expect(s2.state.status).toBe("DELIVERED");
  });

  it("an exact provider+id replay (identical content) is idempotent", () => {
    const s0 = initialFoldState("DELIVERY_PENDING");
    const s1 = foldDeliveryEvent(
      s0,
      ev({
        provider: "resend",
        providerEventId: "dup",
        eventType: "DELIVERED",
        sequence: 1,
      }),
    );
    const s2 = foldDeliveryEvent(
      s1.state,
      ev({
        provider: "resend",
        providerEventId: "dup",
        eventType: "DELIVERED",
        sequence: 1,
      }),
    );
    expect(s2.applied).toBe(false);
    expect(s2.reason).toBe("EXACT_REPLAY");
    expect(s2.state.statusRevision).toBe(s1.state.statusRevision);
    expect(s2.state.conflicted).toBe(false);
  });

  it("deliveryEventKey combines provider and event id", () => {
    expect(
      deliveryEventKey({ provider: "resend", providerEventId: "e1" }),
    ).not.toBe(
      deliveryEventKey({ provider: "postmark", providerEventId: "e1" }),
    );
  });
});

describe("invalid events fail closed without advancing pointers", () => {
  it.each([
    [
      "INVALID_PROVIDER",
      ev({
        providerEventId: "e",
        eventType: "DELIVERED",
        sequence: 1,
        provider: "",
      }),
    ],
    [
      "INVALID_PROVIDER_EVENT_ID",
      ev({ providerEventId: "", eventType: "DELIVERED", sequence: 1 }),
    ],
    [
      "INVALID_SEQUENCE",
      ev({
        providerEventId: "e",
        eventType: "DELIVERED",
        sequence: Number.NaN,
      }),
    ],
    [
      "INVALID_SEQUENCE",
      ev({ providerEventId: "e", eventType: "DELIVERED", sequence: 0 }),
    ],
    [
      "INVALID_SEQUENCE",
      ev({ providerEventId: "e", eventType: "DELIVERED", sequence: -1 }),
    ],
    [
      "INVALID_SEQUENCE",
      ev({ providerEventId: "e", eventType: "DELIVERED", sequence: 1.5 }),
    ],
    [
      "INVALID_TIMESTAMP",
      {
        provider: "resend",
        providerEventId: "e",
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt: "not-a-date",
      },
    ],
  ])("rejects %s without changing status or pointers", (reason, event) => {
    expect(validateDeliveryEvent(event as DeliveryEvent)).toBe(reason);
    const s0 = initialFoldState("DELIVERY_PENDING");
    const r = foldDeliveryEvent(s0, event as DeliveryEvent);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe(reason);
    expect(r.state.status).toBe("DELIVERY_PENDING");
    expect(r.state.lastSequence).toBeNull();
    expect(r.state.seen).toHaveLength(0);
    expect(r.state.conflicted).toBe(false);
  });
});

describe("conflicting duplicate local sequences fail closed deterministically", () => {
  const conflict = [
    ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 1 }),
    ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 1 }),
  ];
  it("canonical fold yields the same fail-closed result in both input orders", () => {
    const forward = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      conflict,
    );
    const reversed = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      [...conflict].reverse(),
    );
    expect(forward.conflicted).toBe(true);
    expect(forward.reason).toBe("SEQUENCE_CONFLICT");
    expect(forward.status).toBe("DELIVERY_PENDING"); // never advanced from initial
    expect(reversed).toEqual(forward); // acceptance verdict + status are order-independent
  });

  it("a later delivered event cannot resurrect an earlier terminal bounce", () => {
    const final = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      ev({ providerEventId: "b", eventType: "BOUNCED", sequence: 2 }),
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 5 }),
    ]);
    expect(final.status).toBe("BOUNCED");
  });

  it("canonical fold fails closed (not silently) when ANY event is malformed", () => {
    const mixed = [
      ev({ providerEventId: "a", eventType: "ACCEPTED", sequence: 1 }),
      {
        provider: "resend",
        providerEventId: "bad",
        eventType: "DELIVERED",
        sequence: Number.NaN,
        occurredAt: "x",
      } as DeliveryEvent,
      ev({ providerEventId: "d", eventType: "DELIVERED", sequence: 2 }),
    ];
    const forward = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      mixed,
    );
    const reversed = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      [...mixed].reverse(),
    );
    expect(forward.conflicted).toBe(true);
    expect(forward.reason).toBe("INVALID_EVENT");
    expect(forward.status).toBe("DELIVERY_PENDING"); // never advanced to DELIVERED
    expect(reversed).toEqual(forward);
  });
});

// ---- Remediation-2 A: exact-replay vs conflicting-reuse; deterministic fail-closed ----

describe("same identity with conflicting content fails closed deterministically", () => {
  const idA = { provider: "resend", providerEventId: "evt-1" };
  it.each([
    [
      "different event type",
      {
        ...idA,
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt: "2026-08-06T10:00:00.000Z",
      },
      {
        ...idA,
        eventType: "BOUNCED" as const,
        sequence: 1,
        occurredAt: "2026-08-06T10:00:00.000Z",
      },
    ],
    [
      "different sequence",
      {
        ...idA,
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt: "2026-08-06T10:00:00.000Z",
      },
      {
        ...idA,
        eventType: "DELIVERED" as const,
        sequence: 2,
        occurredAt: "2026-08-06T10:00:00.000Z",
      },
    ],
    [
      "different occurredAt",
      {
        ...idA,
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt: "2026-08-06T10:00:00.000Z",
      },
      {
        ...idA,
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt: "2026-08-06T11:00:00.000Z",
      },
    ],
  ])("%s → EVENT_IDENTITY_CONFLICT in both input orders", (_label, a, b) => {
    const forward = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      a as DeliveryEvent,
      b as DeliveryEvent,
    ]);
    const reversed = foldDeliveryEvents(initialFoldState("DELIVERY_PENDING"), [
      b as DeliveryEvent,
      a as DeliveryEvent,
    ]);
    expect(forward.conflicted).toBe(true);
    expect(forward.reason).toBe("EVENT_IDENTITY_CONFLICT");
    expect(forward.status).toBe("DELIVERY_PENDING");
    expect(reversed).toEqual(forward);
  });

  it("single-step distinguishes exact replay from conflicting reuse via content signature", () => {
    const base = ev({
      providerEventId: "e",
      eventType: "DELIVERED",
      sequence: 1,
    });
    const s1 = foldDeliveryEvent(initialFoldState("DELIVERY_PENDING"), base);
    const replay = foldDeliveryEvent(s1.state, { ...base });
    expect(replay.reason).toBe("EXACT_REPLAY");
    const conflict = foldDeliveryEvent(s1.state, {
      ...base,
      eventType: "BOUNCED",
    });
    expect(conflict.reason).toBe("EVENT_IDENTITY_CONFLICT");
    expect(conflict.state.conflicted).toBe(true);
  });

  it("three-event permutations yield an identical final state", () => {
    const evs: DeliveryEvent[] = [
      ev({ providerEventId: "a", eventType: "ACCEPTED", sequence: 1 }),
      ev({ providerEventId: "b", eventType: "DELIVERED", sequence: 2 }),
      ev({ providerEventId: "c", eventType: "COMPLAINED", sequence: 3 }),
    ];
    const perms = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [0, 2, 1],
      [2, 0, 1],
      [1, 2, 0],
    ];
    const results = perms.map((p) =>
      foldDeliveryEvents(
        initialFoldState("DELIVERY_PENDING"),
        p.map((i) => evs[i]!),
      ),
    );
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]!.status).toBe("COMPLAINED");
  });
});

// ---- Remediation-2 B: runtime field validation before any pointer advance ----

describe("runtime event-field validation is fail-closed", () => {
  it("a forged event type is rejected and advances nothing", () => {
    const forged = {
      provider: "resend",
      providerEventId: "e",
      eventType: "FORGED",
      sequence: 1,
      occurredAt: "2026-08-06T10:00:00.000Z",
    } as unknown as DeliveryEvent;
    expect(validateDeliveryEvent(forged)).toBe("INVALID_EVENT_TYPE");
    const r = foldDeliveryEvent(initialFoldState("DELIVERY_PENDING"), forged);
    expect(r.applied).toBe(false);
    expect(r.state.lastSequence).toBeNull();
    expect(r.state.seen).toHaveLength(0);
    expect(r.state.seenSequences).toHaveLength(0);
  });

  it("an unsafe / out-of-range integer sequence is rejected", () => {
    for (const sequence of [
      9007199254740992,
      Number.MAX_SAFE_INTEGER,
      2147483648,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        validateDeliveryEvent(
          ev({ providerEventId: "e", eventType: "DELIVERED", sequence }),
        ),
      ).toBe("INVALID_SEQUENCE");
    }
  });

  it("naive/date-only/impossible timestamps are rejected", () => {
    for (const occurredAt of [
      "2026-08-06T10:00:00",
      "2026-08-06",
      "2026-02-30T10:00:00.000Z",
      "0",
      " 2026-08-06T10:00:00.000Z",
    ]) {
      const e = {
        provider: "resend",
        providerEventId: "e",
        eventType: "DELIVERED" as const,
        sequence: 1,
        occurredAt,
      };
      expect(validateDeliveryEvent(e)).toBe("INVALID_TIMESTAMP");
    }
  });
});

// ---- Remediation-2 F: text-safe, NUL-free, collision-free identity encoding ----

describe("deliveryEventKey / signature are text-safe and collision-free", () => {
  it("contains no NUL byte", () => {
    expect(
      deliveryEventKey({ provider: "resend", providerEventId: "e1" }).includes(
        String.fromCharCode(0),
      ),
    ).toBe(false);
  });
  it("distinguishes adversarial delimiter-like values via length prefixing", () => {
    // "a" + "bc" vs "ab" + "c" must not collide.
    expect(deliveryEventKey({ provider: "a", providerEventId: "bc" })).not.toBe(
      deliveryEventKey({ provider: "ab", providerEventId: "c" }),
    );
    // A "~"-bearing value cannot forge the length frame.
    expect(
      deliveryEventKey({ provider: "1~x", providerEventId: "y" }),
    ).not.toBe(deliveryEventKey({ provider: "1", providerEventId: "xy" }));
  });
});

// ---- Remediation-3: incremental stale events must reserve their local sequence ----

describe("incremental fold reserves a stale sequence (SEQUENCE_CONFLICT parity)", () => {
  // Authoritative state after an applied ACCEPTED at sequence 2.
  const accepted = ev({
    providerEventId: "seq2",
    eventType: "ACCEPTED",
    sequence: 2,
  });
  const staleA = ev({
    providerEventId: "stale-a",
    eventType: "DELIVERED",
    sequence: 1,
  });
  const staleB = ev({
    providerEventId: "stale-b",
    eventType: "BOUNCED",
    sequence: 1,
  });

  function afterAccepted() {
    const s0 = initialFoldState("DELIVERY_PENDING");
    return foldDeliveryEvent(s0, accepted).state; // PROVIDER_ACCEPTED, rev 1, lastSequence 2
  }

  it("a valid first-seen out-of-order event returns OUT_OF_ORDER, reserves its sequence once, and moves no authoritative pointer", () => {
    const s1 = afterAccepted();
    const r = foldDeliveryEvent(s1, staleA);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("OUT_OF_ORDER");
    expect(r.state.seen.map((s) => s.key)).toContain(deliveryEventKey(staleA));
    expect(r.state.seenSequences.filter((x) => x === 1)).toHaveLength(1); // reserved exactly once
    expect(r.state.conflicted).toBe(false);
    // no authoritative movement
    expect(r.state.status).toBe(s1.status);
    expect(r.state.statusRevision).toBe(s1.statusRevision);
    expect(r.state.lastSequence).toBe(s1.lastSequence);
    expect(r.state.lastOccurredAt).toBe(s1.lastOccurredAt);
  });

  it("exact replay of the stale event stays EXACT_REPLAY, adds no duplicate identity or sequence, and changes nothing", () => {
    const s2 = foldDeliveryEvent(afterAccepted(), staleA).state;
    const r = foldDeliveryEvent(s2, { ...staleA });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("EXACT_REPLAY");
    expect(r.state.seen).toHaveLength(s2.seen.length);
    expect(r.state.seenSequences).toEqual(s2.seenSequences);
    expect(r.state.status).toBe(s2.status);
    expect(r.state.statusRevision).toBe(s2.statusRevision);
    expect(r.state.lastSequence).toBe(s2.lastSequence);
    expect(r.state.conflicted).toBe(false);
  });

  it("a distinct identity reusing the stale sequence returns SEQUENCE_CONFLICT and freezes without moving pointers", () => {
    const s1 = afterAccepted();
    const s2 = foldDeliveryEvent(s1, staleA).state;
    const r = foldDeliveryEvent(s2, staleB);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("SEQUENCE_CONFLICT");
    expect(r.state.conflicted).toBe(true);
    expect(r.state.reason).toBe("SEQUENCE_CONFLICT");
    // authoritative status/pointers preserved (never regressed by conflicting stale evidence)
    expect(r.state.status).toBe(s1.status);
    expect(r.state.statusRevision).toBe(s1.statusRevision);
    expect(r.state.lastSequence).toBe(s1.lastSequence);
    expect(r.state.lastOccurredAt).toBe(s1.lastOccurredAt);
  });

  it("reversing which distinct stale identity arrives first yields the same conflict verdict and authoritative state", () => {
    const s1 = afterAccepted();
    const fold = (events: (typeof staleA)[]) => {
      let st = s1;
      for (const e of events) st = foldDeliveryEvent(st, e).state;
      return st;
    };
    const forward = fold([staleA, staleB]);
    const reversed = fold([staleB, staleA]);
    for (const st of [forward, reversed]) {
      expect(st.conflicted).toBe(true);
      expect(st.reason).toBe("SEQUENCE_CONFLICT");
    }
    expect(reversed.status).toBe(forward.status);
    expect(reversed.statusRevision).toBe(forward.statusRevision);
    expect(reversed.lastSequence).toBe(forward.lastSequence);
    expect(reversed.lastOccurredAt).toBe(forward.lastOccurredAt);
  });

  it("canonical and incremental folds AGREE on the conflict verdict for the hostile set", () => {
    const hostile = [accepted, staleA, staleB];
    const canonical = foldDeliveryEvents(
      initialFoldState("DELIVERY_PENDING"),
      hostile,
    );
    let incremental = initialFoldState("DELIVERY_PENDING");
    for (const e of hostile)
      incremental = foldDeliveryEvent(incremental, e).state;
    expect(canonical.conflicted).toBe(true);
    expect(incremental.conflicted).toBe(true);
    expect(incremental.reason).toBe("SEQUENCE_CONFLICT");
    expect(canonical.reason).toBe("SEQUENCE_CONFLICT");
  });

  it("preserves existing behavior: malformed reserves nothing; normal replay idempotent; higher sequence advances; terminal never resurrects", () => {
    const s1 = afterAccepted();
    // malformed event reserves nothing
    const bad = {
      provider: "resend",
      providerEventId: "x",
      eventType: "FORGED",
      sequence: 1,
      occurredAt: "2026-08-06T10:00:00.000Z",
    } as unknown as DeliveryEvent;
    const rBad = foldDeliveryEvent(s1, bad);
    expect(rBad.state.seen).toEqual(s1.seen);
    expect(rBad.state.seenSequences).toEqual(s1.seenSequences);
    // exact normal replay of the applied event remains idempotent
    const rReplay = foldDeliveryEvent(s1, { ...accepted });
    expect(rReplay.reason).toBe("EXACT_REPLAY");
    // a valid higher sequence advances normally
    const rHi = foldDeliveryEvent(
      s1,
      ev({ providerEventId: "seq3", eventType: "DELIVERED", sequence: 3 }),
    );
    expect(rHi.applied).toBe(true);
    expect(rHi.state.status).toBe("DELIVERED");
    expect(rHi.state.lastSequence).toBe(3);
    // terminal states never resurrect after a reserved stale conflict
    const frozenState = foldDeliveryEvent(
      foldDeliveryEvent(s1, staleA).state,
      staleB,
    ).state;
    const afterFreeze = foldDeliveryEvent(
      frozenState,
      ev({ providerEventId: "seq9", eventType: "DELIVERED", sequence: 9 }),
    );
    expect(afterFreeze.reason).toBe("CONFLICTED");
    expect(afterFreeze.state.status).toBe(s1.status);
  });
});

// ---- Remediation-4 blocker 3: exported encoders are text-safe for ANY string ----

describe("deliveryEventKey / deliveryEventSignature emit no control/separator/surrogate text", () => {
  const CONTROL_OR_SEP = /[\p{C}\p{Z}]/u;
  const cp = (n: number) => String.fromCharCode(n);
  // Adversarial values built from char codes so this test source stays pure ASCII.
  const hostile = [
    "",
    "a" + cp(0x0000) + "b", // NUL
    "a" + cp(0x001f) + "b", // C0
    "a" + cp(0x007f) + "b", // DEL
    "a" + cp(0x0085) + "b", // C1 NEL
    "a" + cp(0x2028) + "b", // line separator
    "a" + cp(0x2029) + "b", // paragraph separator
    "a" + cp(0x00a0) + "b", // no-break space
    "a~b",
    "a.b",
    "a:b",
    "3~abc", // length-frame-like
    String.fromCodePoint(0x1f600), // astral
    "a" + cp(0xd800) + "b", // lone high surrogate
    "a" + cp(0xdc00) + "b", // lone low surrogate
    "x".repeat(64),
  ];

  it("output of both helpers contains no raw C0/C1, Unicode separator, or surrogate", () => {
    for (const provider of hostile) {
      for (const providerEventId of hostile) {
        const key = deliveryEventKey({ provider, providerEventId });
        expect(CONTROL_OR_SEP.test(key)).toBe(false);
        expect(key.includes(String.fromCharCode(0))).toBe(false);
        const sig = deliveryEventSignature({
          provider,
          providerEventId,
          eventType: "DELIVERED",
          sequence: 1,
          occurredAt: "2026-08-06T10:00:00.000Z",
        });
        expect(CONTROL_OR_SEP.test(sig)).toBe(false);
      }
    }
  });

  it("is deterministic for identical inputs", () => {
    const a = deliveryEventKey({
      provider: "a" + cp(0x2028) + "b",
      providerEventId: "e",
    });
    const b = deliveryEventKey({
      provider: "a" + cp(0x2028) + "b",
      providerEventId: "e",
    });
    expect(a).toBe(b);
  });

  it("distinct input tuples never alias across the hostile matrix", () => {
    const keys = new Set<string>();
    const tuples: Array<[string, string]> = [];
    for (const p of hostile) for (const e of hostile) tuples.push([p, e]);
    for (const [p, e] of tuples)
      keys.add(deliveryEventKey({ provider: p, providerEventId: e }));
    expect(keys.size).toBe(tuples.length);
  });

  it("classic delimiter-injection pairs stay distinct", () => {
    expect(deliveryEventKey({ provider: "a", providerEventId: "bc" })).not.toBe(
      deliveryEventKey({ provider: "ab", providerEventId: "c" }),
    );
    expect(
      deliveryEventKey({ provider: "1~x", providerEventId: "y" }),
    ).not.toBe(deliveryEventKey({ provider: "1", providerEventId: "xy" }));
  });

  it("key and signature domains stay distinct (prefix separation)", () => {
    const e: DeliveryEvent = {
      provider: "resend",
      providerEventId: "evt-1",
      eventType: "DELIVERED",
      sequence: 1,
      occurredAt: "2026-08-06T10:00:00.000Z",
    };
    expect(deliveryEventKey(e)).not.toBe(deliveryEventSignature(e));
    expect(deliveryEventKey(e).startsWith("k1.")).toBe(true);
    expect(deliveryEventSignature(e).startsWith("s1")).toBe(true);
  });

  it("normal validated events preserve exact-replay and identity-conflict behavior", () => {
    const s0 = initialFoldState("DELIVERY_PENDING");
    const base = ev({
      providerEventId: "e",
      eventType: "DELIVERED",
      sequence: 1,
    });
    const s1 = foldDeliveryEvent(s0, base);
    expect(foldDeliveryEvent(s1.state, { ...base }).reason).toBe(
      "EXACT_REPLAY",
    );
    expect(
      foldDeliveryEvent(s1.state, { ...base, eventType: "BOUNCED" }).reason,
    ).toBe("EVENT_IDENTITY_CONFLICT");
  });
});
