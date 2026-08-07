/**
 * @jest-environment node
 *
 * Matrix row 10: a complete non-PII logical contract yields a stable idempotency
 * key, and any change to order / kind / artifact hash / template / attempt cannot
 * alias the same key. Invalid components fail closed (also row 11).
 */
import { buildFulfillmentIdempotencyKey } from "@/lib/fulfillment/idempotency";
import type { FulfillmentIdempotencyContract } from "@/lib/fulfillment/idempotency";

const base: FulfillmentIdempotencyContract = {
  orderId: "ord_abc",
  kind: "T2_APPEAL_EVIDENCE",
  tier: "T2",
  attemptNumber: 1,
  artifactSha256: "a".repeat(64),
  generatorVersion: "gen_v1",
  templateVersion: "tpl_v1",
  purpose: "DELIVERY",
};

function keyOf(c: FulfillmentIdempotencyContract): string {
  const r = buildFulfillmentIdempotencyKey(c);
  if (!r.ok) throw new Error("expected ok key, got " + r.reason);
  return r.key;
}

describe("buildFulfillmentIdempotencyKey", () => {
  it("is deterministic for the same contract", () => {
    expect(keyOf(base)).toBe(keyOf({ ...base }));
  });

  it("changing any material contract dimension changes the key (no aliasing)", () => {
    const variants: FulfillmentIdempotencyContract[] = [
      { ...base, orderId: "ord_xyz" },
      { ...base, artifactSha256: "b".repeat(64) },
      { ...base, templateVersion: "tpl_v2" },
      { ...base, attemptNumber: 2 },
      { ...base, generatorVersion: "gen_v2" },
      { ...base, purpose: "REGENERATION" },
    ];
    const keys = new Set([keyOf(base), ...variants.map(keyOf)]);
    expect(keys.size).toBe(variants.length + 1);
  });

  // ---- Remediation blocker G: sentinel collision + T2-only tier ----
  it('an omitted templateVersion and an explicit literal "none" produce different keys', () => {
    const { templateVersion: _omit, ...withoutTemplate } = base;
    const omitted = keyOf(withoutTemplate as FulfillmentIdempotencyContract);
    const literalNone = keyOf({ ...base, templateVersion: "none" });
    expect(omitted).not.toBe(literalNone);
  });

  it("distinguishes absent from present for every literal, and empty stays invalid", () => {
    const { templateVersion: _omit, ...withoutTemplate } = base;
    const absent = keyOf(withoutTemplate as FulfillmentIdempotencyContract);
    for (const literal of ["none", "n", "absent", "present"]) {
      expect(keyOf({ ...base, templateVersion: literal })).not.toBe(absent);
    }
    // Absence must be expressed by omission — an explicit empty string is invalid.
    expect(
      buildFulfillmentIdempotencyKey({ ...base, templateVersion: "" }).ok,
    ).toBe(false);
  });

  it("accepts exactly tier T2 and rejects every other tier", () => {
    expect(buildFulfillmentIdempotencyKey({ ...base, tier: "T2" }).ok).toBe(
      true,
    );
    for (const tier of ["T1", "T3", "T4", "t2", "T2 ", "COMPS_ONLY", ""]) {
      const r = buildFulfillmentIdempotencyKey({ ...base, tier });
      expect(r.ok).toBe(false);
    }
  });

  it("cannot be aliased by delimiter injection across fields (regression)", () => {
    // Two materially different contracts that a ':'-permitting charset would have
    // folded to the same key. The ':' (and '=') are now rejected in segments.
    const a = buildFulfillmentIdempotencyKey({ ...base, orderId: "A:tier=X" });
    const b = buildFulfillmentIdempotencyKey({
      ...base,
      orderId: "A",
      tier: "X:tier=T2",
    });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });

  it("rejects segments containing the ':' delimiter or '=' separator", () => {
    expect(
      buildFulfillmentIdempotencyKey({ ...base, orderId: "ord:1" }).ok,
    ).toBe(false);
    expect(
      buildFulfillmentIdempotencyKey({ ...base, generatorVersion: "gen=1" }).ok,
    ).toBe(false);
    expect(
      buildFulfillmentIdempotencyKey({ ...base, templateVersion: "tpl:2" }).ok,
    ).toBe(false);
  });

  it("fails closed on an invalid SHA-256 (row 11)", () => {
    const r = buildFulfillmentIdempotencyKey({
      ...base,
      artifactSha256: "A".repeat(64),
    });
    expect(r.ok).toBe(false);
  });

  it("fails closed on a non-positive / non-integer attempt number", () => {
    expect(
      buildFulfillmentIdempotencyKey({ ...base, attemptNumber: 0 }).ok,
    ).toBe(false);
    expect(
      buildFulfillmentIdempotencyKey({ ...base, attemptNumber: -1 }).ok,
    ).toBe(false);
    expect(
      buildFulfillmentIdempotencyKey({ ...base, attemptNumber: 1.5 }).ok,
    ).toBe(false);
  });

  it("fails closed on an empty orderId or generatorVersion", () => {
    expect(buildFulfillmentIdempotencyKey({ ...base, orderId: "" }).ok).toBe(
      false,
    );
    expect(
      buildFulfillmentIdempotencyKey({ ...base, generatorVersion: "" }).ok,
    ).toBe(false);
  });

  it("carries no PII — only ids, hashes, versions and numbers", () => {
    const key = keyOf(base);
    for (const pii of ["@", "email", "gmail", "name", "address", " ", "\n"]) {
      expect(key.includes(pii)).toBe(false);
    }
  });

  // ---- Remediation-2 E: reject wrong runtime types (no String(...) coercion) ----
  it("rejects a non-string orderId instead of coercing it", () => {
    for (const orderId of [123, null, true, {}, [], Symbol("x") as unknown]) {
      const r = buildFulfillmentIdempotencyKey({
        ...base,
        orderId: orderId as unknown as string,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a non-string generatorVersion instead of coercing it", () => {
    for (const generatorVersion of [7, null, false, {}]) {
      const r = buildFulfillmentIdempotencyKey({
        ...base,
        generatorVersion: generatorVersion as unknown as string,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a non-string / null templateVersion (undefined is the only absent form)", () => {
    for (const templateVersion of [null, 0, false, {}, []]) {
      const r = buildFulfillmentIdempotencyKey({
        ...base,
        templateVersion: templateVersion as unknown as string,
      });
      expect(r.ok).toBe(false);
    }
    // undefined omission is accepted (absent)
    const { templateVersion: _omit, ...noTpl } = base;
    expect(
      buildFulfillmentIdempotencyKey(noTpl as FulfillmentIdempotencyContract)
        .ok,
    ).toBe(true);
  });

  // ---- Remediation-2 C: attempt number is a schema-safe PostgreSQL Int ----
  it.each([
    9007199254740992,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    2147483648,
  ])("rejects an unsafe / over-range attemptNumber %p", (attemptNumber) => {
    expect(buildFulfillmentIdempotencyKey({ ...base, attemptNumber }).ok).toBe(
      false,
    );
  });

  it("accepts the maximum in-range attempt number", () => {
    expect(
      buildFulfillmentIdempotencyKey({ ...base, attemptNumber: 2147483647 }).ok,
    ).toBe(true);
  });
});
