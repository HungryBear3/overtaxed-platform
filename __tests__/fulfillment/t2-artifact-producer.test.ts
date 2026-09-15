/**
 * The T2 artifact producer.
 *
 * Two things have to be true at once and they pull in opposite directions:
 * the producer must really produce a packet, and production must be unable to
 * reach that path while OD-2 and OD-3 are unsigned. Both are proven here.
 *
 * Every fixture below is synthetic. The PINs are in a reserved 99-prefixed
 * block that Cook County does not issue, and no owner name, buyer name, seller
 * name or real address appears anywhere in this file.
 */
import {
  buildT2ArtifactContent,
  encodeT2Artifact,
  T2_PRODUCER_VERSION,
  T2_TEMPLATE_VERSION,
  type DeadlineAuthoritySnapshot,
  type SignedPolicySnapshot,
  type SourceRecord,
  type SubjectRecord,
  type T2ArtifactInputs,
} from "@/lib/fulfillment/t2-artifact-content";
import {
  CC_01,
  CC_07,
  CC_10,
  CC_12,
  CC_13,
  CC_14,
  CC_17,
} from "@/lib/copy/canonical";
import {
  resolveEligibilityPolicy,
  signedPolicyVersion,
} from "@/lib/checkout/ot-contract";
import {
  COMPARABLE_REJECTION_REASONS,
  NON_DIRECTIONAL_RULE_ID,
  attachAssessedValues,
  candidatePoolSha256,
  measureUniformity,
  selectNonDirectionalComparables,
  type ComparableMatchAttributes,
} from "@/lib/fulfillment/t2-comparables";
import {
  generateT2Artifact,
  type T2ArtifactGateway,
  type T2ProducerCountyData,
  type T2ProducerFulfillment,
  type T2ProducerOrder,
} from "@/lib/fulfillment-runtime/t2-artifact-producer";
import { isIdenticalBinding } from "@/lib/fulfillment/artifact-binding";

jest.mock("server-only", () => ({}));

/* ── synthetic fixtures ─────────────────────────────────────────────────── */

const SUBJECT_PIN = "99010010010000";
const ORDER: T2ProducerOrder = {
  id: "ord_synthetic_0001",
  propertyPin: SUBJECT_PIN,
  propertyAddress: "1 EXAMPLE ST",
  township: "Example",
};

const SUBJECT: SubjectRecord = {
  pin: SUBJECT_PIN,
  address: "1 EXAMPLE ST",
  city: "Chicago",
  township: "Example",
  neighborhoodCode: "99010",
  propertyClass: "203",
  residentialSubtype: "1 Story",
  buildingSqft: 1200,
  yearBuilt: 1955,
  assessedTotalValue: 30000, // $25.00/sqft
  assessmentStage: "mailed",
  taxYear: 2025,
  pinCount: 1,
  inCookCounty: true,
};

/** Six qualifying comparables at $20.00/sqft, so the subject sits +25% above. */
function comparableFixtures(): {
  candidates: ComparableMatchAttributes[];
  values: Map<string, number>;
  addresses: Map<string, string>;
} {
  const candidates: ComparableMatchAttributes[] = [];
  const values = new Map<string, number>();
  const addresses = new Map<string, string>();
  for (let i = 1; i <= 6; i += 1) {
    const pin = `990100100200${String(i).padStart(2, "0")}`;
    candidates.push({
      pin,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    });
    values.set(pin, 24000); // 24000 / 1200 = $20.00/sqft
    addresses.set(pin, `${i} EXAMPLE AVE`);
  }
  return { candidates, values, addresses };
}

/** A synthetic 64-hex digest standing in for an authoritative source content hash. */
const SYNTHETIC_SOURCE_SHA256 = "a".repeat(32) + "b".repeat(32);

const SOURCES: SourceRecord[] = [
  {
    datasetId: "uzyt-m557",
    datasetTitle: "Assessor - Assessed Values",
    url: "https://datacatalog.cookcountyil.gov/resource/uzyt-m557.json",
    retrievedAt: "2026-06-08T12:00:00Z",
    contentSha256: SYNTHETIC_SOURCE_SHA256,
  },
  {
    datasetId: "x54s-btds",
    datasetTitle:
      "Assessor - Single and Multi-Family Improvement Characteristics",
    url: "https://datacatalog.cookcountyil.gov/resource/x54s-btds.json",
    retrievedAt: "2026-06-08T12:00:00Z",
    // Explicitly unavailable, never fabricated.
    contentSha256: null,
  },
];

/** The immutable instant the fulfillment row was created (entered ARTIFACT_PENDING). */
const FULFILLMENT_CREATED_AT = new Date("2026-06-08T10:15:30.250Z");
const FULFILLMENT: T2ProducerFulfillment = {
  id: "ful_1",
  orderId: ORDER.id,
  kind: "T2_APPEAL_EVIDENCE",
  status: "ARTIFACT_PENDING",
  createdAt: FULFILLMENT_CREATED_AT,
};

const SIGNED_POLICY: SignedPolicySnapshot = {
  version: "test-only-policy-2026-06-08",
  ownerDecisions: ["OD-2", "OD-3"],
  signedAt: "2026-06-08",
  evidenceThreshold: { minRelativeAssessmentGap: 0.2, minComparables: 5 },
};

const TRUSTED_DEADLINE: DeadlineAuthoritySnapshot = {
  trusted: true,
  status: "open",
  closeDate: "2026-06-30",
  sourceName: "Cook County Assessor",
  sourceUrl:
    "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
  retrievedAt: "2026-06-08T12:00:00Z",
  businessDaysRemainingAtGeneration: 16,
  businessDayCutoffAllowed: true,
};

function contentInputs(
  overrides: Partial<T2ArtifactInputs> = {},
): T2ArtifactInputs {
  const { candidates, values, addresses } = comparableFixtures();
  return {
    orderId: ORDER.id,
    orderPropertyPin: ORDER.propertyPin,
    orderPropertyAddress: ORDER.propertyAddress,
    subject: SUBJECT,
    comparableCandidates: candidates,
    comparableAssessedValues: values,
    comparableAddresses: addresses,
    policy: SIGNED_POLICY,
    deadline: TRUSTED_DEADLINE,
    sources: SOURCES,
    generatedAt: "2026-06-08T12:00:00Z",
    ...overrides,
  };
}

/** True if any character other than LF is a C0 control or DEL. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code < 32 && code !== 10) || code === 127) return true;
  }
  return false;
}

function testGateway(
  overrides: Partial<T2ArtifactGateway> = {},
): T2ArtifactGateway {
  const { candidates, values, addresses } = comparableFixtures();
  const county: T2ProducerCountyData = {
    subject: SUBJECT,
    comparableCandidates: candidates,
    comparableAssessedValues: values,
    comparableAddresses: addresses,
    sources: SOURCES,
  };
  return {
    loadOrder: async () => ORDER,
    loadFulfillment: async () => FULFILLMENT,
    loadCountyData: async () => county,
    resolvePolicy: () => SIGNED_POLICY,
    resolveDeadline: async () => ({
      trusted: true,
      status: "open",
      closeDate: "2026-06-30",
      sourceName: "Cook County Assessor",
      sourceUrl:
        "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
      retrievedAt: "2026-06-08T12:00:00Z",
    }),
    now: () => new Date("2026-06-08T12:00:00Z"),
    ...overrides,
  };
}

/* ── production cannot reach success ────────────────────────────────────── */

describe("the live policy registry keeps production closed", () => {
  it("refuses with the unsigned-policy blocker when an injected resolver returns no policy", async () => {
    // Injected stub. The live-resolver proof is the "audit remediation" case
    // below that calls `generateT2Artifact` with NO gateway at all; this case
    // only pins the blocker vocabulary for a null resolver.
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({ resolvePolicy: () => null }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "ELIGIBILITY_POLICY_UNSIGNED",
    });
  });

  it("refuses before loading an order, so no lookup masks the real blocker", async () => {
    const loadOrder = jest.fn(async () => ORDER);
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({ resolvePolicy: () => null, loadOrder }),
    );
    expect(result.ok).toBe(false);
    expect(loadOrder).not.toHaveBeenCalled();
  });

  it("emits no bytes and no provenance on any refusal", async () => {
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({ resolvePolicy: () => null }),
    );
    expect(result).not.toHaveProperty("bytes");
    expect(result).not.toHaveProperty("provenance");
  });
});

/* ── success is reachable only through injected fixtures ────────────────── */

describe("injected signed policy and trusted deadline", () => {
  it("produces a packet", async () => {
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.provenance).toMatchObject({
      sourceOrderId: ORDER.id,
      propertyPin: SUBJECT_PIN,
      generatorVersion: T2_PRODUCER_VERSION,
      // The fulfillment's creation instant at second precision — not the
      // gateway clock, which is 12:00 in this fixture.
      generatedAt: "2026-06-08T10:15:30Z",
    });
  });

  it("produces byte-identical output on repeated runs", async () => {
    const a = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway(),
    );
    const b = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway(),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  it("produces byte-identical output when the candidate order is shuffled", () => {
    const forward = buildT2ArtifactContent(contentInputs());
    const reversed = buildT2ArtifactContent(
      contentInputs({
        comparableCandidates: [...comparableFixtures().candidates].reverse(),
      }),
    );
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(
      encodeT2Artifact(forward.text).equals(encodeT2Artifact(reversed.text)),
    ).toBe(true);
  });
});

/* ── the packet's content is bounded and truthful ───────────────────────── */

describe("packet content", () => {
  const built = buildT2ArtifactContent(contentInputs());

  it("records complete, non-directional comparable provenance", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const m = built.manifest;
    expect(m.selectionRuleId).toBe(NON_DIRECTIONAL_RULE_ID);
    expect(m.selectionIsDirectional).toBe(false);
    expect(m.comparableCount).toBe(6);
    expect(m.comparablePins).toHaveLength(6);
    expect(m.policyVersion).toBe(SIGNED_POLICY.version);
    expect(m.policyOwnerDecisions).toEqual(["OD-2", "OD-3"]);
    expect(m.producerVersion).toBe(T2_PRODUCER_VERSION);
    expect(m.sources).toHaveLength(2);
    expect(m.deadlineRetrievedAt).toBe("2026-06-08T12:00:00Z");
    expect(m.relativeGap).toBe("0.250000");
    expect(m.rule15RecommendationMet).toBe(true);
  });

  it("names every source with a retrieval timestamp", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const source of SOURCES) {
      expect(built.text).toContain(source.datasetId);
      expect(built.text).toContain(source.url);
    }
    expect(built.text).toContain("retrieved 2026-06-08T12:00:00Z");
  });

  it("states no savings, probability, grade, or recommendation to file", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // The negation trap named in the frozen banned-claims lexicon: CC-12
    // legitimately contains "guarantee a reduction" and "legal advice". Strip
    // the approved canonical strings before asserting, or a correct packet
    // red-lines on its own required disclosures.
    const withoutCanonicalCopy = [
      CC_01,
      CC_07,
      CC_10,
      CC_12,
      CC_13,
      CC_14,
      CC_17,
    ].reduce((text, canonical) => text.split(canonical).join(" "), built.text);
    for (const canonical of [CC_12, CC_13]) {
      expect(built.text).toContain(canonical);
      expect(withoutCanonicalCopy).not.toContain(canonical);
    }
    const banned = [
      /you (will|could|may) save/i,
      /estimated savings/i,
      /potential savings/i,
      /\bper year\b.*\$/i,
      /likely (to )?(win|succeed)/i,
      /\bprobability\b/i,
      /\bscore\b/i,
      /\bgrade\b/i,
      /you are (over-?assessed|overpaying)/i,
      /you should (appeal|file)/i,
      /we recommend appealing/i,
      /strong (case|comps)/i,
      /guarantee/i,
    ];
    for (const pattern of banned) {
      expect(withoutCanonicalCopy).not.toMatch(pattern);
    }
  });

  it("carries the homeowner-files posture and the standing disclosures", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.text).toContain(
      "You review it, sign it, and file it yourself.",
    );
    expect(built.text).toContain("The $69 packet is a preparation service.");
    expect(built.text).toContain("OverTaxed IL is not a law firm");
  });

  it("discloses that the drafted argument is omitted rather than invented", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.manifest.draftArgumentIncluded).toBe(false);
    expect(built.text).toContain(
      "does not contain a drafted argument in your own voice",
    );
    expect(built.manifest.draftArgumentOmissionReason).toContain("OD-5");
  });
});

/* ── refusals ───────────────────────────────────────────────────────────── */

describe("refusals fail closed and produce nothing", () => {
  const cases: Array<[string, Partial<T2ArtifactInputs>, string]> = [
    ["unsigned policy", { policy: null }, "ELIGIBILITY_POLICY_UNSIGNED"],
    [
      "synthetic deadline authority",
      { deadline: { ...TRUSTED_DEADLINE, trusted: false } },
      "UNTRUSTED_DEADLINE_AUTHORITY",
    ],
    [
      "stale deadline with no retrieval instant",
      { deadline: { ...TRUSTED_DEADLINE, retrievedAt: null } },
      "DEADLINE_SNAPSHOT_STALE",
    ],
    [
      "window not open",
      { deadline: { ...TRUSTED_DEADLINE, status: "closed" } },
      "FILING_WINDOW_NOT_OPEN",
    ],
    [
      "fewer than three business days",
      { deadline: { ...TRUSTED_DEADLINE, businessDayCutoffAllowed: false } },
      "INSUFFICIENT_BUSINESS_DAYS",
    ],
    [
      // Class 299 IS a class-2 code, so a condominium is inside the served
      // class. What it lacks is a published building area, and the blocker
      // says exactly that rather than blaming the class.
      "condominium with no published building area",
      { subject: { ...SUBJECT, propertyClass: "299", buildingSqft: 0 } },
      "MISSING_BUILDING_SQFT",
    ],
    [
      "missing building area",
      { subject: { ...SUBJECT, buildingSqft: 0 } },
      "MISSING_BUILDING_SQFT",
    ],
    [
      "missing assessed value",
      { subject: { ...SUBJECT, assessedTotalValue: 0 } },
      "MISSING_ASSESSED_VALUE",
    ],
    [
      "multi-PIN property",
      { subject: { ...SUBJECT, pinCount: 2 } },
      "MULTI_PIN_PROPERTY",
    ],
    [
      "outside Cook County",
      { subject: { ...SUBJECT, inCookCounty: false } },
      "OUTSIDE_COOK_COUNTY",
    ],
    [
      "non-residential class",
      { subject: { ...SUBJECT, propertyClass: "517" } },
      "UNSUPPORTED_PROPERTY_CLASS",
    ],
    [
      "order bought a different parcel",
      { orderPropertyPin: "99010010019999" },
      "ORDER_PROPERTY_MISMATCH",
    ],
    ["empty source manifest", { sources: [] }, "INCOMPLETE_SOURCE_MANIFEST"],
    [
      "source with no retrieval timestamp",
      { sources: [{ ...SOURCES[0], retrievedAt: "" }] },
      "INCOMPLETE_SOURCE_MANIFEST",
    ],
    [
      "unusable generation instant",
      { generatedAt: "yesterday" },
      "INCOMPLETE_SOURCE_MANIFEST",
    ],
  ];

  it.each(cases)("refuses: %s", (_label, overrides, blocker) => {
    const result = buildT2ArtifactContent(contentInputs(overrides));
    expect(result).toEqual({ ok: false, blocker });
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("manifest");
  });

  it("refuses when too few comparables qualify", () => {
    const { candidates, values, addresses } = comparableFixtures();
    const result = buildT2ArtifactContent(
      contentInputs({
        comparableCandidates: candidates.slice(0, 3),
        comparableAssessedValues: values,
        comparableAddresses: addresses,
      }),
    );
    expect(result).toEqual({ ok: false, blocker: "INSUFFICIENT_COMPARABLES" });
  });

  it("refuses when a selected comparable has no assessed value", () => {
    const { candidates, values, addresses } = comparableFixtures();
    values.delete(candidates[0].pin);
    const result = buildT2ArtifactContent(
      contentInputs({
        comparableCandidates: candidates,
        comparableAssessedValues: values,
        comparableAddresses: addresses,
      }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "COMPARABLE_VALUE_INCOMPLETE",
    });
  });

  it("refuses when the measured gap is below the signed threshold", () => {
    const result = buildT2ArtifactContent(
      contentInputs({
        policy: {
          ...SIGNED_POLICY,
          evidenceThreshold: {
            minRelativeAssessmentGap: 0.5,
            minComparables: 5,
          },
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "BELOW_SIGNED_EVIDENCE_THRESHOLD",
    });
  });

  it("refuses when the injected policy carries no threshold", () => {
    const result = buildT2ArtifactContent(
      contentInputs({ policy: { ...SIGNED_POLICY, version: "" } }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "ELIGIBILITY_POLICY_UNSIGNED",
    });
  });

  it("refuses at the producer when county data is unavailable", async () => {
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({ loadCountyData: async () => null }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "COMPARABLE_SOURCE_UNAVAILABLE",
    });
  });

  it("refuses at the producer when the order is missing", async () => {
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({ loadOrder: async () => null }),
    );
    expect(result).toEqual({ ok: false, blocker: "ORDER_NOT_FOUND" });
  });

  it("applies the Chicago cutoff to a real close date inside the producer", async () => {
    const result = await generateT2Artifact(
      { orderId: ORDER.id, fulfillmentId: "ful_1" },
      testGateway({
        resolveDeadline: async () => ({
          trusted: true,
          status: "open",
          closeDate: "2026-06-09", // one business day after Monday 2026-06-08
          sourceName: "Cook County Assessor",
          sourceUrl:
            "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
          retrievedAt: "2026-06-08T12:00:00Z",
        }),
      }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "INSUFFICIENT_BUSINESS_DAYS",
    });
  });
});

/* ── the selector cannot be directional ─────────────────────────────────── */

describe("selection is structurally non-directional", () => {
  it("accepts the same set no matter how assessed values are permuted", () => {
    const { candidates } = comparableFixtures();
    const subject = {
      pin: SUBJECT_PIN,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    };
    const first = selectNonDirectionalComparables(subject, candidates);
    // Values are not an input to selection at all, so no permutation of them
    // can reach it. Prove the accepted set is identical across wildly
    // different value assignments.
    for (const scale of [1, 100, 0.01]) {
      const values = new Map(
        candidates.map((c, i) => [c.pin, 1000 * (i + 1) * scale]),
      );
      const attached = attachAssessedValues(first!.accepted, values);
      expect(attached.valued.map((c) => c.pin)).toEqual(
        first!.accepted.map((c) => c.pin),
      );
    }
    const second = selectNonDirectionalComparables(
      subject,
      [...candidates].reverse(),
    );
    expect(second!.accepted.map((c) => c.pin)).toEqual(
      first!.accepted.map((c) => c.pin),
    );
  });

  it("never returns the subject as its own comparable", () => {
    const { candidates } = comparableFixtures();
    const subject = {
      pin: SUBJECT_PIN,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    };
    const withSelf = selectNonDirectionalComparables(subject, [
      { ...subject },
      ...candidates,
    ]);
    expect(withSelf!.accepted.some((c) => c.pin === SUBJECT_PIN)).toBe(false);
    expect(withSelf!.rejected).toContainEqual({
      pin: SUBJECT_PIN,
      reason: "same_parcel_as_subject",
    });
  });

  it("excludes candidates outside the preregistered bands, with a reason each", () => {
    const subject = {
      pin: SUBJECT_PIN,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    };
    const selection = selectNonDirectionalComparables(subject, [
      { ...subject, pin: "99010010030001", neighborhoodCode: "99011" },
      { ...subject, pin: "99010010030002", propertyClass: "204" },
      { ...subject, pin: "99010010030003", residentialSubtype: "2 Story" },
      { ...subject, pin: "99010010030004", buildingSqft: 3000 },
      { ...subject, pin: "99010010030005", yearBuilt: 1900 },
    ]);
    expect(selection!.accepted).toHaveLength(0);
    expect(selection!.rejected.map((r) => r.reason).sort()).toEqual([
      "building_sqft_out_of_band",
      "different_class",
      "different_neighborhood",
      "different_subtype",
      "year_built_out_of_band",
    ]);
  });

  it("computes the uniformity gap from published values and areas", () => {
    const { candidates, values } = comparableFixtures();
    const { valued } = attachAssessedValues(candidates, values);
    const measurement = measureUniformity(
      { buildingSqft: 1200, assessedTotalValue: 30000 },
      valued,
    );
    expect(measurement).not.toBeNull();
    expect(measurement!.subjectAssessedPerSqft).toBeCloseTo(25, 10);
    expect(measurement!.comparableMedianAssessedPerSqft).toBeCloseTo(20, 10);
    expect(measurement!.relativeGap).toBeCloseTo(0.25, 10);
  });

  it("is not the degenerate assessed-value-times-ten metric", () => {
    // The metric on main divides assessed value by (assessed value x 10) on both
    // sides, so its gap is exactly zero for every parcel. This one moves.
    const { candidates, values } = comparableFixtures();
    const { valued } = attachAssessedValues(candidates, values);
    const gaps = [24000, 27000, 30000, 36000].map(
      (av) =>
        measureUniformity(
          { buildingSqft: 1200, assessedTotalValue: av },
          valued,
        )!.relativeGap,
    );
    expect(new Set(gaps.map((g) => g.toFixed(6))).size).toBe(gaps.length);
    expect(gaps.some((g) => g !== 0)).toBe(true);
  });
});

/* ── remediation of the independent audit findings ──────────────────────── */

describe("audit remediation", () => {
  it("uses the real default gateway when none is injected, and still refuses", async () => {
    // The prior version of this suite passed an injected `resolvePolicy: () => null`
    // to a test named "when the real resolver is used", so the candidate's most
    // important claim had no coverage at all. This call passes NO gateway, so it
    // exercises `defaultGateway()` and the live `resolveEligibilityPolicy`.
    delete process.env.OT_ELIGIBILITY_POLICY_VERSION;
    const result = await generateT2Artifact({
      orderId: ORDER.id,
      fulfillmentId: "ful_1",
    });
    expect(result).toEqual({
      ok: false,
      blocker: "ELIGIBILITY_POLICY_UNSIGNED",
    });
  });

  it("cannot be opened by an inherited Object.prototype key in the policy version", async () => {
    // An empty `{}` registry inherits from Object.prototype, so a lookup of
    // `constructor` or `toString` returned a truthy member and the registry
    // reported a signed policy. That let an environment variable alone satisfy
    // the policy half of the paid-checkout gate.
    const inherited = [
      "constructor",
      "hasOwnProperty",
      "toString",
      "valueOf",
      "__proto__",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__defineGetter__",
      "__defineSetter__",
      "__lookupGetter__",
      "__lookupSetter__",
    ];
    for (const key of inherited) {
      process.env.OT_ELIGIBILITY_POLICY_VERSION = key;
      expect(resolveEligibilityPolicy()).toEqual({
        signed: false,
        version: null,
        reason: "eligibility_policy_unsigned",
      });
      expect(signedPolicyVersion()).toBeNull();
      const result = await generateT2Artifact({
        orderId: ORDER.id,
        fulfillmentId: "ful_1",
      });
      expect(result).toEqual({
        ok: false,
        blocker: "ELIGIBILITY_POLICY_UNSIGNED",
      });
    }
    delete process.env.OT_ELIGIBILITY_POLICY_VERSION;
  });

  it("refuses ordinary unsigned policy versions too", () => {
    for (const key of ["v1", "2026-09-01", "true", "*", "", "   "]) {
      process.env.OT_ELIGIBILITY_POLICY_VERSION = key;
      expect(resolveEligibilityPolicy().signed).toBe(false);
    }
    delete process.env.OT_ELIGIBILITY_POLICY_VERSION;
  });

  it("selects the same set whatever order conflicting duplicate rows arrive in", () => {
    // A row rejected for a wrong neighbourhood used to consume the PIN, so a
    // later good row for the same parcel was dropped as a duplicate and the
    // accepted set depended on source ordering.
    const subject = {
      pin: SUBJECT_PIN,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    };
    const good = { ...subject, pin: "99010010020007" };
    const conflicting = { ...good, neighborhoodCode: "99099" };

    const forward = selectNonDirectionalComparables(subject, [
      conflicting,
      good,
    ])!;
    const reverse = selectNonDirectionalComparables(subject, [
      good,
      conflicting,
    ])!;
    expect(forward.accepted).toEqual(reverse.accepted);
    // Contradictory rows for one parcel are dropped rather than resolved by
    // arrival order: choosing between them would be choosing what to believe.
    expect(forward.accepted).toHaveLength(0);
    expect(forward.rejected).toContainEqual({
      pin: "99010010020007",
      reason: "conflicting_duplicate_rows",
    });
  });

  it("collapses identical repeated rows to one instead of dropping the parcel", () => {
    const subject = {
      pin: SUBJECT_PIN,
      neighborhoodCode: "99010",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    };
    const good = { ...subject, pin: "99010010020007" };
    const selection = selectNonDirectionalComparables(subject, [
      good,
      { ...good },
    ])!;
    expect(selection.accepted.map((c) => c.pin)).toEqual(["99010010020007"]);
    expect(selection.rejected).toContainEqual({
      pin: "99010010020007",
      reason: "duplicate_pin",
    });
  });

  it("distinguishes a missing comparable address from a missing value", () => {
    const { candidates, values, addresses } = comparableFixtures();
    addresses.set(candidates[0].pin, "   ");
    const result = buildT2ArtifactContent(
      contentInputs({
        comparableCandidates: candidates,
        comparableAssessedValues: values,
        comparableAddresses: addresses,
      }),
    );
    expect(result).toEqual({
      ok: false,
      blocker: "COMPARABLE_ADDRESS_MISSING",
    });
  });

  it("does not truncate a long comparable address", () => {
    const { candidates, values, addresses } = comparableFixtures();
    const long = "12345 WEST SOUTH SAMPLE BOULEVARD EXTENSION APARTMENT 1234";
    addresses.set(candidates[0].pin, long);
    const result = buildT2ArtifactContent(
      contentInputs({
        comparableCandidates: candidates,
        comparableAssessedValues: values,
        comparableAddresses: addresses,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain(long);
  });
});

/* ── remediation of the independent exact-SHA review of a5628ced ────────── */

describe("independent review remediation (2026-09-04)", () => {
  /** A ten-parcel neighbourhood: five at $20/sqft and five at $40/sqft. */
  function neighbourhood(): {
    candidates: ComparableMatchAttributes[];
    values: Map<string, number>;
    addresses: Map<string, string>;
  } {
    const candidates: ComparableMatchAttributes[] = [];
    const values = new Map<string, number>();
    const addresses = new Map<string, string>();
    for (let i = 1; i <= 10; i += 1) {
      const pin = `990100100300${String(i).padStart(2, "0")}`;
      candidates.push({
        pin,
        neighborhoodCode: "99010",
        propertyClass: "203",
        residentialSubtype: "1 Story",
        buildingSqft: 1200,
        yearBuilt: 1955,
      });
      values.set(pin, (i <= 5 ? 20 : 40) * 1200);
      addresses.set(pin, `${i} EXAMPLE BLVD`);
    }
    return { candidates, values, addresses };
  }

  describe("M2: artifact bytes are deterministic given the stable generation instant", () => {
    it("bumps the producer and template versions because bytes and manifest semantics changed", () => {
      // 1.1.0 was this bump; 1.1.1 followed (re-review M1). The exact current
      // value is pinned in the re-review block; here only the bump itself.
      expect(T2_PRODUCER_VERSION).not.toBe("t2-evidence-packet/1.0.0");
      expect(T2_TEMPLATE_VERSION).not.toBe("t2-evidence-packet-text/1.0.0");
      expect(T2_PRODUCER_VERSION).toMatch(/^t2-evidence-packet\/1\.1\.\d+$/);
      expect(T2_TEMPLATE_VERSION).toMatch(
        /^t2-evidence-packet-text\/1\.1\.\d+$/,
      );
    });

    it("produces byte-identical packets and hashes across attempts with different wall clocks", async () => {
      const first = await generateT2Artifact(
        { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
        testGateway({ now: () => new Date("2026-06-08T12:00:00.000Z") }),
      );
      // A different day, a different hour, still inside the filing window.
      const second = await generateT2Artifact(
        { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
        testGateway({ now: () => new Date("2026-06-11T21:45:10.999Z") }),
      );
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.bytes.equals(second.bytes)).toBe(true);
      expect(first.provenance).toEqual(second.provenance);
      expect(first.provenance.generatedAt).toBe("2026-06-08T10:15:30Z");
    });

    it("embeds the fulfillment creation instant, never the wall clock, in the packet", async () => {
      const result = await generateT2Artifact(
        { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
        testGateway({ now: () => new Date("2026-06-11T21:45:10.999Z") }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const text = result.bytes.toString("utf8");
      expect(text).toContain("Prepared: 2026-06-08T10:15:30Z");
      expect(text).not.toContain("2026-06-11T21:45:10");
      expect(text).not.toContain("2026-06-11");
    });

    it("samples the runtime clock exactly once and hands that instant to deadline resolution", async () => {
      const sampled = new Date("2026-06-08T12:00:00.000Z");
      const now = jest.fn(() => sampled);
      const resolveDeadline = jest.fn(
        async (_order: T2ProducerOrder, at: Date) => {
          expect(at).toBe(sampled);
          return {
            trusted: true as const,
            status: "open" as const,
            closeDate: "2026-06-30",
            sourceName: "Cook County Assessor",
            sourceUrl:
              "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
            retrievedAt: "2026-06-08T12:00:00Z",
          };
        },
      );
      const result = await generateT2Artifact(
        { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
        testGateway({ now, resolveDeadline }),
      );
      expect(result.ok).toBe(true);
      expect(now).toHaveBeenCalledTimes(1);
      expect(resolveDeadline).toHaveBeenCalledTimes(1);
    });

    it("records business days remaining relative to the generation instant, not the attempt", () => {
      const built = buildT2ArtifactContent(contentInputs());
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.manifest.businessDaysRemainingAtGeneration).toBe(16);
      expect(built.manifest).not.toHaveProperty("businessDaysRemaining");
    });

    it("still applies the three-business-day gate at attempt time", async () => {
      // Generation instant is 2026-06-08; the attempt is on 2026-06-29 with the
      // window closing 2026-06-30. The bytes would be stable, but the packet is
      // not produced for a window the buyer can no longer file into.
      const result = await generateT2Artifact(
        { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
        testGateway({ now: () => new Date("2026-06-29T12:00:00.000Z") }),
      );
      expect(result).toEqual({
        ok: false,
        blocker: "INSUFFICIENT_BUSINESS_DAYS",
      });
    });

    it.each([
      [
        "missing fulfillment",
        { loadFulfillment: async () => null },
        "FULFILLMENT_NOT_FOUND",
      ],
      [
        "fulfillment bound to a different order",
        {
          loadFulfillment: async () => ({
            ...FULFILLMENT,
            orderId: "ord_other",
          }),
        },
        "FULFILLMENT_ORDER_MISMATCH",
      ],
      [
        "fulfillment with an invalid creation instant",
        {
          loadFulfillment: async () => ({
            ...FULFILLMENT,
            createdAt: new Date("nope"),
          }),
        },
        "GENERATION_INSTANT_UNAVAILABLE",
      ],
      [
        "fulfillment of another kind",
        { loadFulfillment: async () => ({ ...FULFILLMENT, kind: "T3_DFY" }) },
        "FULFILLMENT_ORDER_MISMATCH",
      ],
    ] as Array<[string, Partial<T2ArtifactGateway>, string]>)(
      "fails closed with no bytes on a %s",
      async (_label, overrides, blocker) => {
        const result = await generateT2Artifact(
          { orderId: ORDER.id, fulfillmentId: FULFILLMENT.id },
          testGateway(overrides),
        );
        expect(result).toEqual({ ok: false, blocker });
        expect(result).not.toHaveProperty("bytes");
      },
    );
  });

  describe("M3: the candidate pool is bound into provenance", () => {
    it("gives the whole neighbourhood and a stripped pool different candidate-pool hashes", () => {
      const whole = neighbourhood();
      const stripped = whole.candidates.slice(0, 5);
      expect(candidatePoolSha256(whole.candidates)).not.toBe(
        candidatePoolSha256(stripped),
      );
      // Order-independent: the hash is over sorted canonical rows.
      expect(candidatePoolSha256([...whole.candidates].reverse())).toBe(
        candidatePoolSha256(whole.candidates),
      );
      expect(candidatePoolSha256(whole.candidates)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("lets a later reviewer tell the two apart from the manifest alone", () => {
      const whole = neighbourhood();
      const wholeResult = buildT2ArtifactContent(
        contentInputs({
          comparableCandidates: whole.candidates,
          comparableAssessedValues: whole.values,
          comparableAddresses: whole.addresses,
        }),
      );
      // Honest pool: median $30/sqft, subject $25/sqft, gap negative — refused.
      expect(wholeResult).toEqual({
        ok: false,
        blocker: "BELOW_SIGNED_EVIDENCE_THRESHOLD",
      });

      const strippedResult = buildT2ArtifactContent(
        contentInputs({
          comparableCandidates: whole.candidates.slice(0, 5),
          comparableAssessedValues: whole.values,
          comparableAddresses: whole.addresses,
        }),
      );
      // A pre-filtered pool can still yield a packet — the selector cannot know
      // what it was not shown — but the manifest now says exactly what it saw.
      expect(strippedResult.ok).toBe(true);
      if (!strippedResult.ok) return;
      const m = strippedResult.manifest;
      expect(m.candidateCount).toBe(5);
      expect(m.candidateAcceptedCount).toBe(5);
      expect(m.candidatePoolSha256).toBe(
        candidatePoolSha256(whole.candidates.slice(0, 5)),
      );
      expect(m.candidatePoolSha256).not.toBe(
        candidatePoolSha256(whole.candidates),
      );
      expect(m.candidatePoolHashDomain).toBe("ot-t2-candidate-pool/v1");
      expect(strippedResult.text).toContain(
        "Candidate rows handed to selection: 5",
      );
    });

    it("records exhaustive rejected counts by bounded reason, zero-filled", () => {
      const { candidates, values, addresses } = comparableFixtures();
      const extra: ComparableMatchAttributes[] = [
        { ...candidates[0], pin: "99010010040001", neighborhoodCode: "99011" },
        { ...candidates[0], pin: "99010010040002", propertyClass: "204" },
        { ...candidates[0], pin: "99010010040003", buildingSqft: 3000 },
        { ...candidates[0] }, // identical repeat -> duplicate_pin
        { ...candidates[1], yearBuilt: 1901 }, // conflicting repeat -> conflicting_duplicate_rows
        { ...candidates[0], pin: "bad" }, // invalid
      ];
      const result = buildT2ArtifactContent(
        contentInputs({
          comparableCandidates: [...candidates, ...extra],
          comparableAssessedValues: values,
          comparableAddresses: addresses,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const counts = result.manifest.candidateRejectedByReason;
      expect(Object.keys(counts).sort()).toEqual(
        [...COMPARABLE_REJECTION_REASONS].sort(),
      );
      expect(counts).toMatchObject({
        different_neighborhood: 1,
        different_class: 1,
        building_sqft_out_of_band: 1,
        duplicate_pin: 1,
        // Per row (re-review M1): BOTH rows of the contradictory pair are
        // rejected, so the count is 2, not 1 per PIN.
        conflicting_duplicate_rows: 2,
        missing_or_invalid_attributes: 1,
        same_parcel_as_subject: 0,
        different_subtype: 0,
        year_built_out_of_band: 0,
      });
      expect(result.manifest.candidateCount).toBe(12);
      // Six original comparables, less the one dropped as conflicting.
      expect(result.manifest.candidateAcceptedCount).toBe(5);
      expect(result.text).toContain("Candidate rows handed to selection: 12");
      // The partition identity, not just the individual counts: every one of
      // the 12 rows is accepted or rejected for exactly one reason.
      const rejectedTotal = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(rejectedTotal).toBe(7);
      expect(result.manifest.candidateAcceptedCount + rejectedTotal).toBe(
        result.manifest.candidateCount,
      );
      expect(result.text).toContain(
        "  5 qualified; 7 did not, counted by reason in the provenance manifest.",
      );
    });

    it("carries a source content hash when one is available and says so when it is not", () => {
      const built = buildT2ArtifactContent(contentInputs());
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const byId = new Map(
        built.manifest.sources.map((s) => [s.datasetId, s.contentSha256]),
      );
      expect(byId.get("uzyt-m557")).toBe(SYNTHETIC_SOURCE_SHA256);
      expect(byId.get("x54s-btds")).toBeNull();
      expect(built.text).toContain(`content sha256 ${SYNTHETIC_SOURCE_SHA256}`);
      expect(built.text).toContain("content hash not available from source");
    });

    it("refuses a malformed source content hash rather than rendering it", () => {
      const result = buildT2ArtifactContent(
        contentInputs({
          sources: [{ ...SOURCES[0], contentSha256: "not-a-hash" }],
        }),
      );
      expect(result).toEqual({
        ok: false,
        blocker: "INCOMPLETE_SOURCE_MANIFEST",
      });
    });
  });

  describe("L2: county-supplied text cannot inject lines into the packet body", () => {
    it("collapses newline, carriage return and tab in subject and comparable text", () => {
      const { candidates, values, addresses } = comparableFixtures();
      addresses.set(
        candidates[0].pin,
        "1 EXAMPLE AVE\nYOUR ASSESSMENT IS WRONG. FILE NOW.",
      );
      addresses.set(candidates[1].pin, "2 EXAMPLE AVE\r\nUNIT\t2");
      const result = buildT2ArtifactContent(
        contentInputs({
          subject: {
            ...SUBJECT,
            address: "1 EXAMPLE ST\nFAKE SECTION",
            city: "Chi\tcago",
            township: "Ex\rample",
            residentialSubtype: "1 Story",
          },
          comparableCandidates: candidates,
          comparableAssessedValues: values,
          comparableAddresses: addresses,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const lines = result.text.split("\n");
      expect(lines.some((l) => l.startsWith("YOUR ASSESSMENT IS WRONG"))).toBe(
        false,
      );
      expect(lines.some((l) => l.startsWith("FAKE SECTION"))).toBe(false);
      // No control character survives into the body: only LF line breaks remain.
      expect(hasControlCharacter(result.text)).toBe(false);
      expect(result.text).toContain(
        "1 EXAMPLE AVE YOUR ASSESSMENT IS WRONG. FILE NOW.",
      );
      expect(result.text).toContain("2 EXAMPLE AVE UNIT 2");
      expect(result.text).toContain(
        "Address:                 1 EXAMPLE ST FAKE SECTION",
      );
      expect(result.text).toContain("City:                    Chi cago");
    });
  });
});

/* ── remediation of the independent exact-SHA re-review of e5383bbc ─────── */

describe("independent re-review remediation (2026-09-04, e5383bbc)", () => {
  const subjectMatch = {
    pin: SUBJECT_PIN,
    neighborhoodCode: "99010",
    propertyClass: "203",
    residentialSubtype: "1 Story",
    buildingSqft: 1200,
    yearBuilt: 1955,
  };
  const reasonTotal = (counts: Record<string, number>) =>
    Object.values(counts).reduce((a, b) => a + b, 0);
  /** A deterministic shuffle so the permutation evidence is reproducible. */
  function permutations<T>(rows: T[], count: number): T[][] {
    let seed = 11;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    return Array.from({ length: count }, () =>
      [...rows].sort(() => rnd() - 0.5),
    );
  }

  describe("M1: rejection accounting is per row and partitions the pool", () => {
    it("bumps the producer and template versions because manifest semantics changed", () => {
      expect(T2_PRODUCER_VERSION).toBe("t2-evidence-packet/1.1.1");
      expect(T2_TEMPLATE_VERSION).toBe("t2-evidence-packet-text/1.1.1");
    });

    it("a 1.1.0 binding never replays as identical to a 1.1.1 artifact", () => {
      const next = {
        artifactSha256: "a".repeat(64),
        byteSize: 10,
        storageLocator: "loc",
        generatorVersion: T2_PRODUCER_VERSION,
        templateVersion: T2_TEMPLATE_VERSION,
        sourceOrderId: ORDER.id,
        propertyBindingFingerprint: "fp",
        generatedAt: "2026-06-08T10:15:30Z",
      };
      const existing110 = {
        ...next,
        generatorVersion: "t2-evidence-packet/1.1.0",
        templateVersion: "t2-evidence-packet-text/1.1.0",
        generatedAt: new Date("2026-06-08T10:15:30Z"),
      };
      expect(isIdenticalBinding(existing110, next as never)).toBe(false);
      expect(
        isIdenticalBinding(
          { ...next, generatedAt: new Date("2026-06-08T10:15:30Z") },
          next as never,
        ),
      ).toBe(true);
    });

    it("three identical rows: one accepted, two duplicate_pin rejections", () => {
      const good = { ...subjectMatch, pin: "99010010050001" };
      const selection = selectNonDirectionalComparables(subjectMatch, [
        { ...good },
        { ...good },
        { ...good },
      ])!;
      expect(selection.accepted.map((c) => c.pin)).toEqual(["99010010050001"]);
      expect(selection.rejected).toEqual([
        { pin: "99010010050001", reason: "duplicate_pin" },
        { pin: "99010010050001", reason: "duplicate_pin" },
      ]);
      expect(selection.accepted.length + selection.rejected.length).toBe(3);
    });

    it("a contradictory group of four rows: none accepted, four conflicting rejections", () => {
      const base = { ...subjectMatch, pin: "99010010050002" };
      const rows = [
        { ...base },
        { ...base, yearBuilt: 1901 },
        { ...base },
        { ...base, buildingSqft: 1300 },
      ];
      const selection = selectNonDirectionalComparables(subjectMatch, rows)!;
      expect(selection.accepted).toHaveLength(0);
      expect(selection.rejected).toEqual(
        rows.map(() => ({
          pin: "99010010050002",
          reason: "conflicting_duplicate_rows",
        })),
      );
      expect(selection.rejected).toHaveLength(4);
    });

    it("mixed pool: every row lands in exactly one partition, the manifest and body agree, and bytes are permutation-invariant", () => {
      const { candidates, values, addresses } = comparableFixtures(); // 6 accepted
      const dupA = { ...candidates[0] }; // identical repeats of an accepted PIN
      const conflictPin = "99010010050003";
      const conflictRows = [
        { ...subjectMatch, pin: conflictPin },
        { ...subjectMatch, pin: conflictPin, yearBuilt: 1900 },
        { ...subjectMatch, pin: conflictPin, buildingSqft: 3000 },
      ];
      const invalid = [
        { ...candidates[0], pin: "bad" },
        { ...candidates[0], pin: "99010010050004", buildingSqft: 0 },
      ];
      const outOfBand = [
        { ...subjectMatch, pin: "99010010050005", neighborhoodCode: "99011" },
        { ...subjectMatch, pin: "99010010050006", yearBuilt: 1900 },
      ];
      const selfRow = { ...subjectMatch };
      const rows: ComparableMatchAttributes[] = [
        ...candidates,
        dupA,
        { ...dupA },
        ...conflictRows,
        ...invalid,
        ...outOfBand,
        selfRow,
      ];
      expect(rows).toHaveLength(16);

      const expectedCounts = {
        same_parcel_as_subject: 1,
        different_neighborhood: 1,
        different_class: 0,
        different_subtype: 0,
        building_sqft_out_of_band: 0,
        year_built_out_of_band: 1,
        missing_or_invalid_attributes: 2,
        duplicate_pin: 2,
        conflicting_duplicate_rows: 3,
      };

      let firstText: string | null = null;
      for (const permuted of [rows, ...permutations(rows, 25)]) {
        const selection = selectNonDirectionalComparables(
          subjectMatch,
          permuted,
        )!;
        // Stable ordering regardless of arrival order.
        expect(selection.accepted.map((c) => c.pin)).toEqual(
          candidates.map((c) => c.pin).sort(),
        );
        expect(selection.rejected).toEqual(
          [...selection.rejected].sort((a, b) =>
            `${a.pin}|${a.reason}` < `${b.pin}|${b.reason}` ? -1 : 1,
          ),
        );
        const result = buildT2ArtifactContent(
          contentInputs({
            comparableCandidates: permuted,
            comparableAssessedValues: values,
            comparableAddresses: addresses,
          }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const m = result.manifest;
        expect(m.candidateCount).toBe(16);
        expect(m.candidateAcceptedCount).toBe(6);
        expect(m.candidateRejectedByReason).toEqual(expectedCounts);
        expect(reasonTotal(m.candidateRejectedByReason)).toBe(10);
        expect(
          m.candidateAcceptedCount + reasonTotal(m.candidateRejectedByReason),
        ).toBe(m.candidateCount);
        expect(result.text).toContain("Candidate rows handed to selection: 16");
        expect(result.text).toContain(
          "  6 qualified; 10 did not, counted by reason in the provenance manifest.",
        );
        // The manifest rendered in the body is the manifest returned.
        const rendered = result.text
          .split("\n")
          .find((l) => l.startsWith('{"businessDaysRemainingAtGeneration"'));
        expect(JSON.parse(rendered ?? "null")).toEqual(
          JSON.parse(JSON.stringify(m)),
        );
        if (firstText === null) firstText = result.text;
        else
          expect(
            encodeT2Artifact(result.text).equals(encodeT2Artifact(firstText)),
          ).toBe(true);
      }
    });
  });

  describe("L2: the order id and deadline fields render one-line-safe", () => {
    // Every injection is built from code points so the source carries none.
    const cp = (...codes: number[]) => String.fromCodePoint(...codes);
    const INJECTIONS: Array<[string, string]> = [
      ["LF", "\n"],
      ["CR", "\r"],
      ["CRLF", "\r\n"],
      ["TAB", "\t"],
      ["NUL", cp(0)],
      ["ESC", cp(27)],
      ["DEL", cp(127)],
      ["NEL U+0085", cp(0x85)],
      ["LS U+2028", cp(0x2028)],
      ["PS U+2029", cp(0x2029)],
    ];
    const SEPARATOR = new RegExp(
      `[${cp(0)}-${cp(31)}${cp(127)}-${cp(159)}${cp(0x2028)}${cp(0x2029)}]`,
    );
    const bodyOf = (text: string) => text.split("\n8. PROVENANCE MANIFEST")[0];

    it.each(INJECTIONS)(
      "%s in orderId, closeDate, retrievedAt and sourceUrl starts no line and leaves no separator",
      (_label, inj) => {
        const inputs = contentInputs({
          orderId: `ord_x${inj}INJECTED-ORDER`,
          deadline: {
            ...TRUSTED_DEADLINE,
            closeDate: `2026-06-30${inj}INJECTED-CLOSE`,
            retrievedAt: `2026-06-08T12:00:00Z${inj}INJECTED-RETRIEVED`,
            sourceUrl: `https://example.invalid/x${inj}INJECTED-URL`,
          },
        });
        const first = buildT2ArtifactContent(inputs);
        const second = buildT2ArtifactContent(inputs);
        expect(first.ok).toBe(true);
        if (!first.ok || !second.ok) return;
        expect(
          encodeT2Artifact(first.text).equals(encodeT2Artifact(second.text)),
        ).toBe(true);
        const body = bodyOf(first.text);
        const lines = body.split("\n");
        expect(lines.some((l) => /^INJECTED-/.test(l))).toBe(false);
        expect(SEPARATOR.test(body.replace(/\n/g, ""))).toBe(false);
        expect(body).toContain("Order reference: ord_x INJECTED-ORDER");
        expect(body).toContain(
          "Assessor window closes: 2026-06-30 INJECTED-CLOSE",
        );
        expect(body).toContain("2026-06-08T12:00:00Z INJECTED-RETRIEVED");
        expect(body).toContain(
          "Source: https://example.invalid/x INJECTED-URL",
        );
        // The manifest keeps the value exactly as received.
        expect(first.manifest.orderId).toBe(`ord_x${inj}INJECTED-ORDER`);
        expect(first.manifest.deadlineSourceUrl).toBe(
          `https://example.invalid/x${inj}INJECTED-URL`,
        );
      },
    );

    it.each(INJECTIONS)(
      "%s in county text (subject, comparables, sources) still leaves no separator",
      (_label, inj) => {
        const { candidates, values, addresses } = comparableFixtures();
        addresses.set(candidates[0].pin, `1 EXAMPLE AVE${inj}INJECTED-ADDRESS`);
        const result = buildT2ArtifactContent(
          contentInputs({
            subject: {
              ...SUBJECT,
              address: `1 EXAMPLE ST${inj}INJECTED-SUBJECT`,
              city: `Chi${inj}cago`,
              township: `Ex${inj}ample`,
              assessmentStage: `mai${inj}led`,
            },
            comparableCandidates: candidates,
            comparableAssessedValues: values,
            comparableAddresses: addresses,
            sources: SOURCES.map((s) => ({
              ...s,
              datasetTitle: `${s.datasetTitle}${inj}INJECTED-TITLE`,
              url: `${s.url}${inj}INJECTED-SOURCE-URL`,
            })),
          }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const body = bodyOf(result.text);
        expect(body.split("\n").some((l) => /^INJECTED-/.test(l))).toBe(false);
        expect(SEPARATOR.test(body.replace(/\n/g, ""))).toBe(false);
        expect(body).toContain("1 EXAMPLE AVE INJECTED-ADDRESS");
        expect(body).toContain("City:                    Chi cago");
      },
    );
  });
});
