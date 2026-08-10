/** @jest-environment node */

/**
 * OT T2 delivery-evidence Phase 2 Slice 2 — exact artifact identity and
 * provenance binding. These cover the PURE decision layer: every gate is
 * fail-closed and every refusal is a bounded, stable, non-PII blocker code.
 *
 * No database, no provider, no filesystem. The digest helper is exercised here
 * only to prove the hash is derived server-side from bytes and that caller text
 * can never substitute for it.
 */
import {
  ARTIFACT_BINDING_BLOCKERS,
  MAX_ARTIFACT_BYTES,
  REPLAYABLE_FULFILLMENT_STATUSES,
  classifyPropertyBinding,
  decideArtifactBinding,
  type ArtifactBindingInput,
} from "@/lib/fulfillment/artifact-binding";
import { UNTRUSTED_PROPERTY_BINDING_STATES } from "@/lib/fulfillment/types";
import {
  computeArtifactSha256,
  computePropertyBindingFingerprint,
} from "@/lib/fulfillment/artifact-digest";
import {
  OT_T2_ARTIFACT_BINDING_FLAG,
  t2ArtifactBindingEnabled,
} from "@/lib/fulfillment/flag";

const ORDER_ID = "ord_slice2_primary";
const FULFILLMENT_ID = "ful_slice2_primary";
const PIN = "09000000000000";
const ADDRESS = "123 Main St";
const GENERATED_AT = "2026-08-09T12:00:00.000Z";
/**
 * Trusted current time. In production this is PostgreSQL transaction time read
 * inside the binding transaction — never anything a caller supplies. Here the
 * test harness plays the store's role, which is exactly the boundary the
 * production `BindArtifactCommand` is proven NOT to expose.
 */
const TRUSTED_NOW = "2026-08-09T18:00:00.000Z";

const BYTES = Buffer.from("%PDF-1.7 exact packet bytes for slice 2\n");
const SHA = computeArtifactSha256(BYTES);

function input(
  overrides: Partial<ArtifactBindingInput> = {},
): ArtifactBindingInput {
  return {
    flagEnabled: true,
    trustedNow: TRUSTED_NOW,
    bytes: BYTES,
    order: {
      id: ORDER_ID,
      tier: "T2",
      status: "PAID",
      propertyPin: PIN,
      propertyAddress: ADDRESS,
      refunded: false,
      disputed: false,
    },
    fulfillment: {
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      kind: "T2_APPEAL_EVIDENCE",
      status: "ARTIFACT_PENDING",
      statusRevision: 0,
    },
    provenance: {
      sourceOrderId: ORDER_ID,
      propertyPin: PIN,
      propertyAddress: ADDRESS,
      generatorVersion: "gen_v1",
      templateVersion: "tpl_v1",
      generatedAt: GENERATED_AT,
    },
    storageLocator: "artifacts/ful_slice2_primary/v1.pdf",
    ...overrides,
  };
}

function blockerOf(result: ReturnType<typeof decideArtifactBinding>): string {
  return result.ok ? "OK" : result.blocker;
}

describe("Slice 2 — artifact identity is derived server-side from bytes", () => {
  it("computes a lowercase 64-hex SHA-256 of the exact bytes", () => {
    expect(SHA).toMatch(/^[0-9a-f]{64}$/);
    // Known-answer: SHA-256 is content-addressed, so identical bytes agree.
    expect(computeArtifactSha256(Buffer.from(BYTES))).toBe(SHA);
  });

  it("changes the digest when a single byte changes", () => {
    const mutated = Buffer.from(BYTES);
    mutated[0] = mutated[0]! ^ 0x01;
    expect(computeArtifactSha256(mutated)).not.toBe(SHA);
  });

  it("binds the server-computed digest, never caller-supplied hash text", () => {
    const fake = "f".repeat(64);
    const decision = decideArtifactBinding(input({ assertedSha256: fake }));
    // Test 5: a caller-supplied fake hash must not bypass server-side hashing.
    expect(blockerOf(decision)).toBe("SHA256_ASSERTION_MISMATCH");
  });

  it("accepts a correct caller assertion and still persists the computed digest", () => {
    const decision = decideArtifactBinding(input({ assertedSha256: SHA }));
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.artifact.artifactSha256).toBe(SHA);
  });

  it("derives byte length from the bytes, not from caller input", () => {
    const decision = decideArtifactBinding(input());
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.artifact.byteSize).toBe(BYTES.byteLength);
  });
});

describe("Slice 2 — eligibility and binding fail closed", () => {
  it("binds a correct eligible paid-T2 fulfillment", () => {
    // Test 1
    const decision = decideArtifactBinding(input());
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.artifact.sourceOrderId).toBe(ORDER_ID);
      expect(decision.artifact.generatorVersion).toBe("gen_v1");
      expect(decision.artifact.generatedAt).toBe(GENERATED_AT);
      expect(decision.nextStatus).toBe("ARTIFACT_READY");
      expect(decision.artifact.propertyBindingFingerprint).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });

  it("refuses when the feature flag is absent/default-off", () => {
    // Test 12
    expect(
      blockerOf(decideArtifactBinding(input({ flagEnabled: false }))),
    ).toBe("FLAG_DISABLED");
  });

  it("refuses a missing order or missing fulfillment", () => {
    // Test 6
    expect(blockerOf(decideArtifactBinding(input({ order: null })))).toBe(
      "ORDER_NOT_FOUND",
    );
    expect(blockerOf(decideArtifactBinding(input({ fulfillment: null })))).toBe(
      "FULFILLMENT_NOT_FOUND",
    );
  });

  it("refuses a fulfillment that belongs to a different order", () => {
    // Test 6
    const decision = decideArtifactBinding(
      input({
        fulfillment: {
          id: FULFILLMENT_ID,
          orderId: "ord_someone_else",
          kind: "T2_APPEAL_EVIDENCE",
          status: "ARTIFACT_PENDING",
          statusRevision: 0,
        },
      }),
    );
    expect(blockerOf(decision)).toBe("FULFILLMENT_ORDER_MISMATCH");
  });

  it.each([
    ["T1", "INELIGIBLE_TIER"],
    ["T3", "INELIGIBLE_TIER"],
    ["T4", "INELIGIBLE_TIER"],
    ["T9", "INELIGIBLE_TIER"],
  ])("refuses tier %s (T2-only slice)", (tier, expected) => {
    // Test 8
    const decision = decideArtifactBinding(
      input({ order: { ...input().order!, tier } }),
    );
    expect(blockerOf(decision)).toBe(expected);
  });

  it.each([
    ["CHECKOUT_CREATED"],
    ["PENDING"],
    ["PAID_RECOVERY_REQUIRED"],
    ["REFUNDED"],
    ["CANCELLED"],
    ["FAILED"],
  ])("refuses settlement status %s", (status) => {
    // Test 7
    const decision = decideArtifactBinding(
      input({ order: { ...input().order!, status } }),
    );
    expect(blockerOf(decision)).toBe("INELIGIBLE_SETTLEMENT");
  });

  it("refuses a refunded or disputed order even when status is PAID", () => {
    // Test 7 — refund/dispute overrides a PAID status.
    expect(
      blockerOf(
        decideArtifactBinding(
          input({ order: { ...input().order!, refunded: true } }),
        ),
      ),
    ).toBe("INELIGIBLE_SETTLEMENT");
    expect(
      blockerOf(
        decideArtifactBinding(
          input({ order: { ...input().order!, disputed: true } }),
        ),
      ),
    ).toBe("INELIGIBLE_SETTLEMENT");
  });

  it.each([
    ["missing pin", { propertyPin: null }],
    ["short pin", { propertyPin: "0900000000" }],
    ["non-numeric pin", { propertyPin: "0900000000000x" }],
    ["missing address", { propertyAddress: null }],
    ["blank address", { propertyAddress: "   " }],
  ])("refuses incomplete property binding: %s", (_label, patch) => {
    // Test 6
    const decision = decideArtifactBinding(
      input({ order: { ...input().order!, ...patch } }),
    );
    expect(blockerOf(decision)).toBe("INCOMPLETE_PROPERTY_BINDING");
  });

  it("refuses provenance that names a different order", () => {
    // Test 6 — packet provenance must name the same order.
    const decision = decideArtifactBinding(
      input({
        provenance: { ...input().provenance, sourceOrderId: "ord_other" },
      }),
    );
    expect(blockerOf(decision)).toBe("PROVENANCE_ORDER_MISMATCH");
  });

  it.each([
    ["different pin", { propertyPin: "09000000000001" }],
    ["different address", { propertyAddress: "999 Elsewhere Ave" }],
  ])("refuses provenance that names a different property: %s", (_l, patch) => {
    // Test 6
    const decision = decideArtifactBinding(
      input({ provenance: { ...input().provenance, ...patch } }),
    );
    expect(blockerOf(decision)).toBe("PROVENANCE_PROPERTY_MISMATCH");
  });

  it.each([
    ["INELIGIBLE"],
    ["MANUAL_REVIEW"],
    ["CANCELLED"],
    ["BOUNCED"],
    ["DELIVERED"],
    ["FAILED"],
  ])("refuses binding from non-bindable fulfillment status %s", (status) => {
    const decision = decideArtifactBinding(
      input({ fulfillment: { ...input().fulfillment!, status } }),
    );
    expect(blockerOf(decision)).toBe("INELIGIBLE_FULFILLMENT_STATUS");
  });
});

describe("Slice 2 — replay is confined to an explicit lifecycle allowlist", () => {
  const replayFrom = (status: string) =>
    decideArtifactBinding(
      input({
        existingBinding: true,
        fulfillment: { ...input().fulfillment!, status },
      }),
    );

  // The first successful bind advances the summary out of ARTIFACT_PENDING.
  // If the bindable-status gate also applied to replays, every idempotent
  // retry would refuse with INELIGIBLE_FULFILLMENT_STATUS and idempotency
  // would be unreachable. ARTIFACT_READY is therefore the ONLY status from
  // which a replay is permitted.
  it("permits an exact replay from ARTIFACT_READY and marks it REPLAY", () => {
    const decision = replayFrom("ARTIFACT_READY");
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.mode).toBe("REPLAY");
      expect(decision.artifact.artifactSha256).toBe(SHA);
    }
  });

  it("exports ARTIFACT_READY as the whole replay allowlist", () => {
    expect([...REPLAYABLE_FULFILLMENT_STATUSES]).toEqual(["ARTIFACT_READY"]);
  });

  // Terminal, held, delivered, and unrecognized states must never be able to
  // produce an `ok` decision proposing ARTIFACT_READY — an exact replay must
  // not resurrect a fulfillment that has already moved past that state.
  it.each([
    ["MANUAL_REVIEW"],
    ["CANCELLED"],
    ["FAILED"],
    ["BOUNCED"],
    ["COMPLAINED"],
    ["DELIVERED"],
    ["DELIVERY_PENDING"],
    ["PROVIDER_ACCEPTED"],
    ["NEEDS_RECONCILIATION"],
    ["INELIGIBLE"],
    ["INCOMPLETE_INPUT"],
    ["NOT_STARTED"],
    ["DELAYED"],
    ["not_a_status"],
    [""],
  ])("refuses an exact replay from %s", (status) => {
    const decision = replayFrom(status);
    expect(blockerOf(decision)).toBe("INELIGIBLE_FULFILLMENT_STATUS");
    // Explicitly: no `ok` decision proposing ARTIFACT_READY escapes.
    expect(decision.ok).toBe(false);
  });

  it("refuses the existing-row / ARTIFACT_PENDING inconsistency", () => {
    // A row that exists while the summary still claims ARTIFACT_PENDING means
    // the first bind's status advance did not stick. That is a contradiction,
    // not a replay, and it must fail closed rather than re-decide a create.
    const decision = replayFrom("ARTIFACT_PENDING");
    expect(blockerOf(decision)).toBe("INELIGIBLE_FULFILLMENT_STATUS");
  });

  it("still refuses a replay whose order is no longer eligible", () => {
    // The lifecycle allowlist narrows ONLY the status gate. Settlement, tier,
    // property binding and provenance gates keep failing closed.
    const decision = decideArtifactBinding(
      input({
        existingBinding: true,
        fulfillment: { ...input().fulfillment!, status: "ARTIFACT_READY" },
        order: { ...input().order!, status: "REFUNDED" },
      }),
    );
    expect(blockerOf(decision)).toBe("INELIGIBLE_SETTLEMENT");
  });

  it.each([
    ["tier", { order: { tier: "T3" } }, "INELIGIBLE_TIER"],
    [
      "property",
      { order: { propertyPin: null } },
      "INCOMPLETE_PROPERTY_BINDING",
    ],
  ])(
    "still enforces the %s gate on a permitted replay",
    (_label, patch, blocker) => {
      const decision = decideArtifactBinding(
        input({
          existingBinding: true,
          fulfillment: { ...input().fulfillment!, status: "ARTIFACT_READY" },
          order: { ...input().order!, ...(patch as { order: object }).order },
        }),
      );
      expect(blockerOf(decision)).toBe(blocker);
    },
  );

  it("keeps the status gate for a first binding", () => {
    const decision = decideArtifactBinding(
      input({
        existingBinding: false,
        fulfillment: { ...input().fulfillment!, status: "ARTIFACT_READY" },
      }),
    );
    expect(blockerOf(decision)).toBe("INELIGIBLE_FULFILLMENT_STATUS");
  });

  it("marks a first binding CREATE, never REPLAY", () => {
    const decision = decideArtifactBinding(input({ existingBinding: false }));
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.mode).toBe("CREATE");
  });
});

describe("Slice 2 — property binding is authenticated, not merely present", () => {
  const stored = computePropertyBindingFingerprint({
    orderId: ORDER_ID,
    propertyPin: PIN,
    propertyAddress: ADDRESS,
  });

  it("reports ABSENT for a pre-Slice-2 row", () => {
    for (const value of [null, undefined, ""]) {
      expect(
        classifyPropertyBinding({
          storedFingerprint: value,
          orderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
        }),
      ).toBe("ABSENT");
    }
  });

  it("reports MATCHES when the stored fingerprint describes this order", () => {
    expect(
      classifyPropertyBinding({
        storedFingerprint: stored,
        orderId: ORDER_ID,
        propertyPin: PIN,
        propertyAddress: ADDRESS,
      }),
    ).toBe("MATCHES");
  });

  it.each([
    ["a different order", { orderId: "ord_other" }],
    ["a different PIN", { propertyPin: "09000000000001" }],
    ["a different address", { propertyAddress: "999 Elsewhere Ave" }],
  ])("reports DRIFTED for %s", (_label, patch) => {
    expect(
      classifyPropertyBinding({
        storedFingerprint: stored,
        orderId: ORDER_ID,
        propertyPin: PIN,
        propertyAddress: ADDRESS,
        ...patch,
      }),
    ).toBe("DRIFTED");
  });

  it.each([["not-a-hash"], ["ABC"], ["f".repeat(63)], ["F".repeat(64)]])(
    "reports MALFORMED for stored value %s",
    (value) => {
      expect(
        classifyPropertyBinding({
          storedFingerprint: value,
          orderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
        }),
      ).toBe("MALFORMED");
    },
  );

  it.each([
    ["missing PIN", { propertyPin: null }],
    ["malformed PIN", { propertyPin: "not-a-pin" }],
    ["missing address", { propertyAddress: null }],
    ["blank address", { propertyAddress: "   " }],
  ])("reports UNVERIFIABLE when the current order has %s", (_label, patch) => {
    expect(
      classifyPropertyBinding({
        storedFingerprint: stored,
        orderId: ORDER_ID,
        propertyPin: PIN,
        propertyAddress: ADDRESS,
        ...patch,
      }),
    ).toBe("UNVERIFIABLE");
  });

  it("returns only a bounded enum — never a fingerprint, PIN, or address", () => {
    const state = classifyPropertyBinding({
      storedFingerprint: stored,
      orderId: ORDER_ID,
      propertyPin: PIN,
      propertyAddress: ADDRESS,
    });
    expect(typeof state).toBe("string");
    expect(state).not.toContain(PIN);
    expect(state).not.toContain(ADDRESS);
    expect(state).not.toContain(stored);
    expect([
      "ABSENT",
      "MATCHES",
      "DRIFTED",
      "MALFORMED",
      "UNVERIFIABLE",
    ]).toContain(state);
  });

  it("names DRIFTED, MALFORMED and UNVERIFIABLE as untrusted, MATCHES/ABSENT as not", () => {
    expect([...UNTRUSTED_PROPERTY_BINDING_STATES].sort()).toEqual([
      "DRIFTED",
      "MALFORMED",
      "UNVERIFIABLE",
    ]);
    expect(UNTRUSTED_PROPERTY_BINDING_STATES.has("MATCHES")).toBe(false);
    expect(UNTRUSTED_PROPERTY_BINDING_STATES.has("ABSENT")).toBe(false);
  });
});

describe("Slice 2 — artifact bytes and locator bounds", () => {
  it("refuses empty artifact bytes", () => {
    // Test 9
    expect(
      blockerOf(decideArtifactBinding(input({ bytes: Buffer.alloc(0) }))),
    ).toBe("EMPTY_ARTIFACT");
  });

  it("refuses an artifact above the explicit bounded size", () => {
    // Test 9 — asserted without allocating 50MB.
    const decision = decideArtifactBinding(
      input({ byteSizeOverrideForTest: MAX_ARTIFACT_BYTES + 1 }),
    );
    expect(blockerOf(decision)).toBe("ARTIFACT_TOO_LARGE");
  });

  it.each([
    ["https bearer url", "https://blob.example.com/packet.pdf?token=abc"],
    ["http bearer url", "http://example.com/p.pdf"],
    ["protocol-relative", "//example.com/p.pdf"],
    ["absolute path", "/etc/passwd"],
    ["data uri", "data:application/pdf;base64,AAAA"],
    ["parent traversal", "artifacts/../../secret.pdf"],
    ["query string", "artifacts/a.pdf?sig=1"],
    ["fragment", "artifacts/a.pdf#x"],
    ["percent encoded", "artifacts/%2e%2e/a.pdf"],
    ["backslash", "artifacts\\a.pdf"],
    ["empty", ""],
  ])("refuses a public/bearer or malformed storage locator: %s", (_l, loc) => {
    // Test 10
    expect(
      blockerOf(decideArtifactBinding(input({ storageLocator: loc }))),
    ).toBe("INVALID_STORAGE_LOCATOR");
  });

  it("accepts a private relative locator", () => {
    const decision = decideArtifactBinding(
      input({ storageLocator: "artifacts/ful_x/v1.pdf" }),
    );
    expect(decision.ok).toBe(true);
  });
});

describe("Slice 2 — provenance field validation", () => {
  it.each([
    ["missing generator version", { generatorVersion: "" }],
    ["whitespace generator version", { generatorVersion: "  " }],
  ])("refuses %s", (_l, patch) => {
    const decision = decideArtifactBinding(
      input({ provenance: { ...input().provenance, ...patch } }),
    );
    expect(blockerOf(decision)).toBe("INVALID_GENERATOR_VERSION");
  });

  it.each([
    ["naive local time", "2026-08-09T12:00:00"],
    ["date only", "2026-08-09"],
    ["impossible date", "2026-02-30T12:00:00.000Z"],
    ["empty", ""],
  ])("refuses a malformed generation timestamp: %s", (_l, generatedAt) => {
    const decision = decideArtifactBinding(
      input({ provenance: { ...input().provenance, generatedAt } }),
    );
    expect(blockerOf(decision)).toBe("INVALID_GENERATED_AT");
  });

  it("allows an absent template version but rejects a malformed one", () => {
    expect(
      decideArtifactBinding(
        input({
          provenance: { ...input().provenance, templateVersion: null },
        }),
      ).ok,
    ).toBe(true);
    expect(
      blockerOf(
        decideArtifactBinding(
          input({
            provenance: {
              ...input().provenance,
              templateVersion: "bad\nvalue",
            },
          }),
        ),
      ),
    ).toBe("INVALID_TEMPLATE_VERSION");
  });
});

describe("Slice 2 — privacy of the decision result", () => {
  it("never echoes packet bytes, PIN, address, or email in the result", () => {
    const decision = decideArtifactBinding(input());
    const serialized = JSON.stringify(decision);
    // Test 11
    expect(serialized).not.toContain(PIN);
    expect(serialized).not.toContain(ADDRESS);
    expect(serialized).not.toContain(BYTES.toString("utf8"));
    expect(serialized).not.toContain("%PDF");
  });

  it("emits only bounded stable blocker codes, never free text", () => {
    const decision = decideArtifactBinding(
      input({ order: { ...input().order!, status: "REFUNDED" } }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.blocker).toMatch(/^[A-Z0-9_]+$/);
  });
});

describe("Slice 2 — feature flag is strict and default-off", () => {
  it("is OFF when the env var is absent", () => {
    expect(t2ArtifactBindingEnabled({})).toBe(false);
  });

  it.each([["1"], ["yes"], ["TRUE"], ["True"], [""], ["false"]])(
    "is OFF for non-exact value %s",
    (value) => {
      expect(
        t2ArtifactBindingEnabled({ [OT_T2_ARTIFACT_BINDING_FLAG]: value }),
      ).toBe(false);
    },
  );

  it('is ON only for exact "true"', () => {
    expect(
      t2ArtifactBindingEnabled({ [OT_T2_ARTIFACT_BINDING_FLAG]: "true" }),
    ).toBe(true);
  });

  it("is independent from the Phase 1 fulfillment-evidence flag", () => {
    // The Phase 1 write flag is already true in Production; it must not enable
    // this slice by implication.
    expect(
      t2ArtifactBindingEnabled({ OT_T2_FULFILLMENT_EVIDENCE_ENABLED: "true" }),
    ).toBe(false);
  });
});

describe("Slice 2 — generation time must not follow the trusted transaction clock", () => {
  // The mutation boundary and the read boundary must agree on what is possible.
  // `deriveProvenanceState` classifies `generatedAt > now` as MISMATCHED, so a
  // binding that accepts a future timestamp manufactures a success-like row that
  // the console immediately rejects as impossible. The write side refuses first.

  it("refuses a syntactically valid instant strictly after trusted now", () => {
    const decision = decideArtifactBinding(
      input({
        provenance: {
          sourceOrderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          // Well-formed, canonical, and impossible.
          generatedAt: "2026-08-09T18:00:00.001Z",
        },
        trustedNow: TRUSTED_NOW,
      }),
    );
    expect(decision.ok).toBe(false);
    expect(blockerOf(decision)).toBe("GENERATED_AT_IN_FUTURE");
  });

  it("refuses a far-future instant", () => {
    const decision = decideArtifactBinding(
      input({
        provenance: {
          sourceOrderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: "2099-01-01T00:00:00.000Z",
        },
        trustedNow: TRUSTED_NOW,
      }),
    );
    expect(blockerOf(decision)).toBe("GENERATED_AT_IN_FUTURE");
  });

  it("admits generation exactly AT the trusted instant (boundary is inclusive)", () => {
    const decision = decideArtifactBinding(
      input({
        provenance: {
          sourceOrderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: TRUSTED_NOW,
        },
        trustedNow: TRUSTED_NOW,
      }),
    );
    expect(decision.ok).toBe(true);
  });

  it("admits generation before the trusted instant (positive control)", () => {
    const decision = decideArtifactBinding(input());
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.artifact.generatedAt).toBe(GENERATED_AT);
  });

  it.each([
    ["empty", ""],
    ["malformed", "not-a-timestamp"],
    ["non-UTC offset", "2026-08-09T18:00:00.000+02:00"],
    ["a bare date", "2026-08-09"],
    ["a Date object rather than an instant", new Date() as unknown as string],
  ])(
    "fails closed when the trusted clock itself is %s",
    (_label, trustedNow) => {
      // A clock we cannot parse is a clock we cannot trust. Refuse rather than
      // fall back to an ambient wall clock the caller could influence.
      const decision = decideArtifactBinding(
        input({ trustedNow: trustedNow as string }),
      );
      expect(decision.ok).toBe(false);
      expect(blockerOf(decision)).toBe("UNTRUSTED_CLOCK");
    },
  );

  it("accepts a second-precision trusted clock (millis optional per the Phase 1 instant contract)", () => {
    // Documents the deployed `parseStrictInstant` contract rather than asserting
    // a stricter one. Production always supplies the 24-char form because
    // TRUSTED_CLOCK_SQL renders the database clock with an explicit `.MS`
    // millisecond field.
    const decision = decideArtifactBinding(
      input({ trustedNow: "2026-08-09T18:00:00Z" }),
    );
    expect(decision.ok).toBe(true);
  });

  it("keeps the future-time refusal ordered AFTER identity/eligibility gates", () => {
    // A future timestamp on an already-ineligible order must still report the
    // eligibility blocker, so operators see the primary cause, not a symptom.
    const decision = decideArtifactBinding(
      input({
        order: {
          id: ORDER_ID,
          tier: "T1",
          status: "PAID",
          propertyPin: PIN,
          propertyAddress: ADDRESS,
        },
        provenance: {
          sourceOrderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    );
    expect(blockerOf(decision)).toBe("INELIGIBLE_TIER");
  });

  it("still refuses a malformed generatedAt with its own distinct code", () => {
    const decision = decideArtifactBinding(
      input({
        provenance: {
          sourceOrderId: ORDER_ID,
          propertyPin: PIN,
          propertyAddress: ADDRESS,
          generatorVersion: "gen_v1",
          templateVersion: "tpl_v1",
          generatedAt: "nonsense",
        },
      }),
    );
    expect(blockerOf(decision)).toBe("INVALID_GENERATED_AT");
  });

  it("exposes both new codes as bounded, stable, non-PII blockers", () => {
    for (const code of ["GENERATED_AT_IN_FUTURE", "UNTRUSTED_CLOCK"]) {
      expect(ARTIFACT_BINDING_BLOCKERS.has(code)).toBe(true);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });
});
