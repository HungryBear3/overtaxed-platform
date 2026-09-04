/**
 * The T2 packet document and its provenance manifest.
 *
 * PURE: no database, no provider, no network, no clock, no randomness. Given
 * identical inputs it returns identical bytes, which is what makes the
 * content-addressed binding in `lib/fulfillment-runtime/t2-artifact-workflow.ts`
 * meaningful.
 *
 * What this document is
 * ---------------------
 * A rendering of published Cook County records for one parcel, the
 * non-directionally selected comparable set, the arithmetic relating them, the
 * source manifest behind every figure, and the canonical consumer copy. It is
 * the "comparable-property analysis for one PIN, drawn from public Cook County
 * records, with source URL and retrieval timestamp for every figure" that the
 * $69 scope defines, and nothing beyond it.
 *
 * What this document is deliberately NOT
 * --------------------------------------
 * It contains no savings estimate, no probability, no score, grade or ordinal,
 * no statement that the reader is over-assessed, no recommendation to file, and
 * no prediction of any county decision. Those are banned by BL-B and BL-C in the
 * frozen canonical-copy lexicon, and none of them is derivable from the inputs
 * here anyway.
 *
 * It also omits the drafted uniformity argument that the free-versus-paid
 * evidence matrix lists as part of the paid delta. That component is persuasive
 * prose written in the homeowner's voice, its content policy sits under OD-5,
 * and OD-5 is unsigned. Generating it would be inventing product content, so
 * the packet states plainly that it is an evidence packet and the manifest
 * records the omission. See `draftArgumentIncluded` in the manifest.
 */
import {
  CC_01,
  CC_07,
  CC_10,
  CC_12,
  CC_13,
  CC_14,
  CC_17,
  cc08,
} from "@/lib/copy/canonical";
import {
  CANDIDATE_POOL_HASH_DOMAIN,
  NON_DIRECTIONAL_RULE_ID,
  RULE15_RECOMMENDED_MINIMUM,
  RULE15_REQUIRED_MINIMUM,
  SQFT_TOLERANCE,
  YEAR_BUILT_TOLERANCE,
  attachAssessedValues,
  candidatePoolSha256,
  measureUniformity,
  rejectionCountsByReason,
  selectNonDirectionalComparables,
  type ComparableMatchAttributes,
  type ComparableRejectionReason,
  type ValuedComparable,
} from "@/lib/fulfillment/t2-comparables";

/**
 * Bump when the rendered layout or the manifest shape changes.
 *
 * 1.1.0 (2026-09-04, after independent review): the manifest binds the complete
 * candidate pool (count, exhaustive rejection counts, domain-separated pool
 * digest) and per-source content hashes; the generation instant is the stable
 * fulfillment creation instant rather than the wall clock; business days
 * remaining are recorded relative to that instant; county-supplied text is
 * control-character-safe in the body.
 *
 * 1.1.1 (2026-09-04, after independent re-review): rejection accounting is per
 * row, so `candidateAcceptedCount + sum(candidateRejectedByReason)` equals
 * `candidateCount` for every duplicate shape and construction refuses if it
 * does not; the order id and the deadline close date, retrieval instant and
 * source URL are rendered through the same one-line-safe policy as county
 * text; that policy now also covers C1 controls and the Unicode line and
 * paragraph separators.
 */
export const T2_PRODUCER_VERSION = "t2-evidence-packet/1.1.1";
export const T2_TEMPLATE_VERSION = "t2-evidence-packet-text/1.1.1";

/** Bounded, stable, non-PII refusal vocabulary. Every ambiguity fails closed. */
export type T2ArtifactRefusal =
  | "ELIGIBILITY_POLICY_UNSIGNED"
  | "UNTRUSTED_DEADLINE_AUTHORITY"
  | "DEADLINE_SNAPSHOT_STALE"
  | "FILING_WINDOW_NOT_OPEN"
  | "INSUFFICIENT_BUSINESS_DAYS"
  | "ORDER_PROPERTY_MISMATCH"
  | "MISSING_PROPERTY_IDENTITY"
  | "OUTSIDE_COOK_COUNTY"
  | "UNSUPPORTED_PROPERTY_CLASS"
  | "MULTI_PIN_PROPERTY"
  | "MISSING_BUILDING_SQFT"
  | "MISSING_ASSESSED_VALUE"
  | "MISSING_PROPERTY_CHARACTERISTICS"
  | "INSUFFICIENT_COMPARABLES"
  | "COMPARABLE_VALUE_INCOMPLETE"
  | "COMPARABLE_ADDRESS_MISSING"
  | "UNIFORMITY_NOT_COMPUTABLE"
  | "BELOW_SIGNED_EVIDENCE_THRESHOLD"
  | "INCOMPLETE_SOURCE_MANIFEST"
  | "CANDIDATE_ACCOUNTING_MISMATCH";

export type SignedPolicySnapshot = {
  version: string;
  ownerDecisions: string[];
  signedAt: string;
  evidenceThreshold: {
    minRelativeAssessmentGap: number;
    minComparables: number;
  };
};

export type DeadlineAuthoritySnapshot = {
  /** False for the committed synthetic fixture. A synthetic source never produces a packet. */
  trusted: boolean;
  status: "open" | "closed" | "upcoming" | "unknown";
  closeDate: string | null;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  /**
   * Business days from the STABLE generation instant to the close date, by the
   * Chicago cutoff module. Deliberately not the attempt-time figure: this value
   * is embedded in the bytes, so it must derive from the same stable instant
   * as `generatedAt`, or two attempts on different days would disagree.
   */
  businessDaysRemainingAtGeneration: number | null;
  /**
   * The attempt-time gate decision. Consulted only to refuse; never rendered,
   * so it does not enter the bytes.
   */
  businessDayCutoffAllowed: boolean;
};

export type SourceRecord = {
  datasetId: string;
  datasetTitle: string;
  url: string;
  retrievedAt: string;
  /**
   * SHA-256 of the source bytes or an authoritative content hash published by
   * the source, when one is available; `null` when it is not. Unavailability is
   * represented explicitly and never filled in.
   */
  contentSha256: string | null;
};

export type SubjectRecord = {
  pin: string;
  address: string;
  city: string;
  township: string;
  neighborhoodCode: string;
  propertyClass: string;
  residentialSubtype: string;
  buildingSqft: number;
  yearBuilt: number;
  assessedTotalValue: number;
  assessmentStage: string;
  taxYear: number;
  pinCount: number;
  inCookCounty: boolean;
};

export type T2ArtifactInputs = {
  orderId: string;
  orderPropertyPin: string;
  orderPropertyAddress: string;
  subject: SubjectRecord;
  comparableCandidates: ReadonlyArray<ComparableMatchAttributes>;
  comparableAssessedValues: ReadonlyMap<string, number>;
  comparableAddresses: ReadonlyMap<string, string>;
  policy: SignedPolicySnapshot | null;
  deadline: DeadlineAuthoritySnapshot;
  sources: ReadonlyArray<SourceRecord>;
  /** Strict RFC3339 UTC instant. Supplied, never read from a clock in here. */
  generatedAt: string;
};

export type T2ArtifactManifest = {
  producerVersion: string;
  templateVersion: string;
  generatedAt: string;
  orderId: string;
  subjectPin: string;
  policyVersion: string;
  policyOwnerDecisions: string[];
  policySignedAt: string;
  policyMinRelativeAssessmentGap: number;
  policyMinComparables: number;
  selectionRuleId: string;
  selectionSqftTolerance: number;
  selectionYearBuiltTolerance: number;
  selectionIsDirectional: false;
  /**
   * The candidate universe handed to selection, bound so a later reader can
   * distinguish a whole neighbourhood from a pre-filtered subset. The selector
   * is value-blind, but it can only be as honest as the pool it is shown; these
   * fields make the pool itself part of the evidence.
   */
  candidateCount: number;
  candidateAcceptedCount: number;
  candidateRejectedByReason: Record<ComparableRejectionReason, number>;
  candidatePoolSha256: string;
  candidatePoolHashDomain: string;
  comparablePins: string[];
  comparableCount: number;
  rule15RequiredMinimum: number;
  rule15RecommendedMinimum: number;
  rule15RecommendationMet: boolean;
  subjectAssessedPerSqft: string;
  comparableMedianAssessedPerSqft: string;
  relativeGap: string;
  deadlineSourceName: string;
  deadlineSourceUrl: string | null;
  deadlineRetrievedAt: string | null;
  deadlineCloseDate: string | null;
  businessDaysRemainingAtGeneration: number | null;
  sources: SourceRecord[];
  draftArgumentIncluded: false;
  draftArgumentOmissionReason: string;
};

export type T2ArtifactContentResult =
  | { ok: true; text: string; manifest: T2ArtifactManifest }
  | { ok: false; blocker: T2ArtifactRefusal };

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Body-safe rendering of every externally supplied string. Every C0 control
 * character and DEL — newline, carriage return, tab and the rest — every C1
 * control (including NEL, U+0085) and the Unicode line and paragraph
 * separators (U+2028, U+2029) collapse to a single space, and the result is
 * trimmed. The packet body is line-oriented plain text, so a stray separator
 * inside an address would otherwise start a line of its own. Applied at render
 * time only: the manifest is canonical JSON, which escapes the C0 range and
 * carries the rest verbatim, so it is left exactly as received.
 *
 * Applied to county text AND to the order id and the deadline close date,
 * retrieval instant and source URL (independent re-review of e5383bbc, L2):
 * those reach this module through the same untrusted-input contract, whatever
 * the default gateway validates upstream.
 */
function safeText(value: unknown): string {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}
// Built from code points so the source itself carries no control characters.
const CONTROL_CHARACTERS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}` +
    `${String.fromCharCode(127)}-${String.fromCharCode(159)}` +
    `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`,
  "g",
);

/**
 * Class 2 is Cook County's residential class; the packet is defined for it
 * alone. The class gate is deliberately coarse: class 200 (vacant residential
 * land) passes it and is then refused by the building-area gate below, because
 * without a published building area there is nothing to divide by. That is
 * the intended refusal, recorded here so it is not mistaken for an oversight.
 */
function isClass2Residential(propertyClass: string): boolean {
  const digits = propertyClass.replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
  return /^2\d{2}$/.test(digits);
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Fixed-precision so the rendered bytes never depend on the host locale. */
function fixed(value: number, places: number): string {
  return value.toFixed(places);
}

function signedPercent(value: number): string {
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compose the packet, or refuse.
 *
 * The order of checks is deliberate: authority and policy first, then property
 * coverage, then evidence sufficiency. A reader of a refusal blocker should be
 * able to tell "we are not allowed to sell this" from "we do not have the data
 * for this" without inspecting anything else.
 */
export function buildT2ArtifactContent(
  input: T2ArtifactInputs,
): T2ArtifactContentResult {
  const { subject, deadline, policy } = input;

  // 1. Authority to produce anything at all.
  if (!policy || !policy.version || !policy.evidenceThreshold) {
    return { ok: false, blocker: "ELIGIBILITY_POLICY_UNSIGNED" };
  }
  if (!deadline.trusted)
    return { ok: false, blocker: "UNTRUSTED_DEADLINE_AUTHORITY" };
  if (!deadline.retrievedAt || !deadline.sourceUrl) {
    return { ok: false, blocker: "DEADLINE_SNAPSHOT_STALE" };
  }
  if (deadline.status !== "open")
    return { ok: false, blocker: "FILING_WINDOW_NOT_OPEN" };
  if (!deadline.businessDayCutoffAllowed) {
    return { ok: false, blocker: "INSUFFICIENT_BUSINESS_DAYS" };
  }

  // 2. The parcel this packet is for is the parcel that was bought.
  //
  // The PIN is the canonical subject identity. Township and street address are
  // rendered from the county record but are NOT cross-checked against the order
  // here: the county's own formatting of both varies, the PIN does not, and the
  // binder separately verifies the order's PIN and normalized address against
  // the provenance it is handed. Recorded after independent review (N1).
  const orderPin = (input.orderPropertyPin || "").replace(/\D/g, "");
  const subjectPin = (subject.pin || "").replace(/\D/g, "");
  if (!/^\d{14}$/.test(subjectPin) || !subject.address.trim()) {
    return { ok: false, blocker: "MISSING_PROPERTY_IDENTITY" };
  }
  if (orderPin !== subjectPin)
    return { ok: false, blocker: "ORDER_PROPERTY_MISMATCH" };

  // 3. Product coverage.
  // Distinct from the class blocker on purpose: an out-of-county parcel and a
  // class-517 parcel are different coverage facts, and operations cannot tell
  // them apart from a shared code.
  if (!subject.inCookCounty)
    return { ok: false, blocker: "OUTSIDE_COOK_COUNTY" };
  if (subject.pinCount !== 1)
    return { ok: false, blocker: "MULTI_PIN_PROPERTY" };
  if (!isClass2Residential(subject.propertyClass)) {
    return { ok: false, blocker: "UNSUPPORTED_PROPERTY_CLASS" };
  }
  if (
    !subject.residentialSubtype.trim() ||
    !Number.isFinite(subject.yearBuilt)
  ) {
    return { ok: false, blocker: "MISSING_PROPERTY_CHARACTERISTICS" };
  }
  // Condominiums land here: Cook County publishes no improvement
  // characteristics for class 299, so there is no building area to divide by.
  if (!Number.isFinite(subject.buildingSqft) || subject.buildingSqft <= 0) {
    return { ok: false, blocker: "MISSING_BUILDING_SQFT" };
  }
  if (
    !Number.isFinite(subject.assessedTotalValue) ||
    subject.assessedTotalValue <= 0
  ) {
    return { ok: false, blocker: "MISSING_ASSESSED_VALUE" };
  }

  // 4. Source manifest completeness, before any figure is rendered.
  if (
    input.sources.length === 0 ||
    input.sources.some(
      (s) =>
        !s.datasetId?.trim() ||
        !s.datasetTitle?.trim() ||
        !s.url?.trim() ||
        !RFC3339_UTC.test(s.retrievedAt ?? "") ||
        // Explicit null is "not available"; anything else must be a real digest.
        !(s.contentSha256 === null || SHA256_HEX.test(s.contentSha256 ?? "")),
    )
  ) {
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" };
  }
  if (!RFC3339_UTC.test(input.generatedAt)) {
    return { ok: false, blocker: "INCOMPLETE_SOURCE_MANIFEST" };
  }

  // 5. Non-directional selection. Selection cannot read a value: see
  //    [[selectNonDirectionalComparables]].
  const selection = selectNonDirectionalComparables(
    {
      pin: subjectPin,
      neighborhoodCode: subject.neighborhoodCode,
      propertyClass: subject.propertyClass,
      residentialSubtype: subject.residentialSubtype,
      buildingSqft: subject.buildingSqft,
      yearBuilt: subject.yearBuilt,
    },
    input.comparableCandidates,
  );
  if (!selection)
    return { ok: false, blocker: "MISSING_PROPERTY_CHARACTERISTICS" };

  // Bind the pool selection was shown, exactly as received: raw row count
  // before any filtering or deduplication, an exhaustive zero-filled count of
  // rejections by reason, and a domain-separated digest over every row.
  const candidateCount = input.comparableCandidates.length;
  const candidateRejectedByReason = rejectionCountsByReason(selection.rejected);
  const poolSha256 = candidatePoolSha256(input.comparableCandidates);

  // Hard invariant, enforced here and not only in tests: every raw candidate
  // row is either accepted or rejected for exactly one reason, so the counts
  // the manifest carries and the sentence the body prints must reconcile to
  // the raw row count. Selection is built to satisfy this for every duplicate
  // shape; if it ever does not, the packet would be asserting an accounting it
  // cannot show, so nothing is rendered.
  const candidateRejectedTotal = Object.values(
    candidateRejectedByReason,
  ).reduce((sum, count) => sum + count, 0);
  if (
    candidateRejectedTotal !== selection.rejected.length ||
    selection.accepted.length + candidateRejectedTotal !== candidateCount
  ) {
    return { ok: false, blocker: "CANDIDATE_ACCOUNTING_MISMATCH" };
  }

  const requiredComparables = Math.max(
    policy.evidenceThreshold.minComparables,
    RULE15_REQUIRED_MINIMUM,
  );
  if (selection.accepted.length < requiredComparables) {
    return { ok: false, blocker: "INSUFFICIENT_COMPARABLES" };
  }

  const { valued, missingValue } = attachAssessedValues(
    selection.accepted,
    input.comparableAssessedValues,
  );
  if (missingValue.length > 0)
    return { ok: false, blocker: "COMPARABLE_VALUE_INCOMPLETE" };
  if (valued.length < requiredComparables) {
    return { ok: false, blocker: "INSUFFICIENT_COMPARABLES" };
  }
  // A missing address is a different gap from a missing value, and the packet
  // tells the reader to verify each comparable by address and PIN.
  if (valued.some((c) => !input.comparableAddresses.get(c.pin)?.trim())) {
    return { ok: false, blocker: "COMPARABLE_ADDRESS_MISSING" };
  }

  const measurement = measureUniformity(
    {
      buildingSqft: subject.buildingSqft,
      assessedTotalValue: subject.assessedTotalValue,
    },
    valued,
  );
  if (!measurement) return { ok: false, blocker: "UNIFORMITY_NOT_COMPUTABLE" };

  // 6. The packet must not assert an evidence position the signed policy does
  //    not support. A paid order that lands here is a reconciliation event
  //    under CC-13, not something to paper over with a weaker document.
  if (
    measurement.relativeGap < policy.evidenceThreshold.minRelativeAssessmentGap
  ) {
    return { ok: false, blocker: "BELOW_SIGNED_EVIDENCE_THRESHOLD" };
  }

  const manifest: T2ArtifactManifest = {
    producerVersion: T2_PRODUCER_VERSION,
    templateVersion: T2_TEMPLATE_VERSION,
    generatedAt: input.generatedAt,
    orderId: input.orderId,
    subjectPin,
    policyVersion: policy.version,
    policyOwnerDecisions: [...policy.ownerDecisions].sort(),
    policySignedAt: policy.signedAt,
    policyMinRelativeAssessmentGap:
      policy.evidenceThreshold.minRelativeAssessmentGap,
    policyMinComparables: policy.evidenceThreshold.minComparables,
    selectionRuleId: NON_DIRECTIONAL_RULE_ID,
    selectionSqftTolerance: SQFT_TOLERANCE,
    selectionYearBuiltTolerance: YEAR_BUILT_TOLERANCE,
    selectionIsDirectional: false,
    candidateCount,
    candidateAcceptedCount: selection.accepted.length,
    candidateRejectedByReason,
    candidatePoolSha256: poolSha256,
    candidatePoolHashDomain: CANDIDATE_POOL_HASH_DOMAIN,
    comparablePins: valued.map((c) => c.pin),
    comparableCount: valued.length,
    rule15RequiredMinimum: RULE15_REQUIRED_MINIMUM,
    rule15RecommendedMinimum: RULE15_RECOMMENDED_MINIMUM,
    rule15RecommendationMet: valued.length >= RULE15_RECOMMENDED_MINIMUM,
    subjectAssessedPerSqft: fixed(measurement.subjectAssessedPerSqft, 4),
    comparableMedianAssessedPerSqft: fixed(
      measurement.comparableMedianAssessedPerSqft,
      4,
    ),
    relativeGap: fixed(measurement.relativeGap, 6),
    deadlineSourceName: deadline.sourceName,
    deadlineSourceUrl: deadline.sourceUrl,
    deadlineRetrievedAt: deadline.retrievedAt,
    deadlineCloseDate: deadline.closeDate,
    businessDaysRemainingAtGeneration:
      deadline.businessDaysRemainingAtGeneration,
    sources: [...input.sources]
      .map((s) => ({ ...s }))
      .sort((a, b) =>
        a.datasetId < b.datasetId ? -1 : a.datasetId > b.datasetId ? 1 : 0,
      ),
    draftArgumentIncluded: false,
    draftArgumentOmissionReason:
      "A drafted uniformity argument in the homeowner's voice is part of the paid " +
      "scope specification, but its content policy sits under Owner Decision OD-5, " +
      "which is unsigned. It is omitted rather than invented.",
  };

  return {
    ok: true,
    text: renderPacket(input, subject, valued, measurement, manifest),
    manifest,
  };
}

function renderPacket(
  input: T2ArtifactInputs,
  subject: SubjectRecord,
  valued: ReadonlyArray<ValuedComparable>,
  measurement: NonNullable<ReturnType<typeof measureUniformity>>,
  manifest: T2ArtifactManifest,
): string {
  const lines: string[] = [];
  const w = (line = "") => lines.push(line);
  const addresses = input.comparableAddresses;

  w("OVERTAXED IL — ASSESSOR-STAGE EVIDENCE PACKET");
  w("=============================================");
  w();
  w(CC_01);
  w();
  w(CC_10);
  w();
  w(`Prepared: ${manifest.generatedAt}`);
  w(`Order reference: ${safeText(manifest.orderId)}`);
  w(`Producer: ${manifest.producerVersion}`);
  w();

  w("1. YOUR PROPERTY, AS THE COUNTY PUBLISHES IT");
  w("--------------------------------------------");
  w(`PIN:                     ${safeText(subject.pin)}`);
  w(`Address:                 ${safeText(subject.address)}`);
  w(`City:                    ${safeText(subject.city)}`);
  w(`Township:                ${safeText(subject.township)}`);
  w(`Assessor neighborhood:   ${safeText(subject.neighborhoodCode)}`);
  w(`Property class:          ${safeText(subject.propertyClass)}`);
  w(`Residence type:          ${safeText(subject.residentialSubtype)}`);
  w(
    `Building area:           ${subject.buildingSqft.toLocaleString("en-US")} sq ft`,
  );
  w(`Year built:              ${subject.yearBuilt}`);
  w(`Tax year:                ${subject.taxYear}`);
  w(`Assessment stage:        ${safeText(subject.assessmentStage)}`);
  w(`Assessed total value:    ${money(subject.assessedTotalValue)}`);
  w(
    `Assessed value per sq ft: $${fixed(measurement.subjectAssessedPerSqft, 2)}`,
  );
  w();
  w(
    "Check every figure above against the county's own record for your PIN before",
  );
  w(
    "you file. If any characteristic is wrong, that error is itself grounds for an",
  );
  w("appeal and you should correct it with the Assessor.");
  w();

  w("2. HOW THE COMPARABLE PROPERTIES WERE CHOSEN");
  w("--------------------------------------------");
  w(`Selection rule: ${manifest.selectionRuleId}`);
  w();
  w(
    "A property qualified as a comparable only if ALL of the following were true",
  );
  w("of the county's published record for it:");
  w(`  - same Assessor neighborhood (${safeText(subject.neighborhoodCode)});`);
  w(`  - same property class (${safeText(subject.propertyClass)});`);
  w(`  - same residence type (${safeText(subject.residentialSubtype)});`);
  w(
    `  - building area within ${Math.round(SQFT_TOLERANCE * 100)}% of yours ` +
      `(${Math.round(subject.buildingSqft * (1 - SQFT_TOLERANCE)).toLocaleString("en-US")}` +
      `-${Math.round(subject.buildingSqft * (1 + SQFT_TOLERANCE)).toLocaleString("en-US")} sq ft);`,
  );
  w(
    `  - year built within ${YEAR_BUILT_TOLERANCE} years of yours ` +
      `(${subject.yearBuilt - YEAR_BUILT_TOLERANCE}-${subject.yearBuilt + YEAR_BUILT_TOLERANCE}).`,
  );
  w();
  // Printed from the per-reason counts themselves, which the construction
  // invariant has already reconciled to the raw row count.
  const rejectedCount = Object.values(
    manifest.candidateRejectedByReason,
  ).reduce((sum, count) => sum + count, 0);
  w(`Candidate rows handed to selection: ${manifest.candidateCount}`);
  w(
    `  ${manifest.candidateAcceptedCount} qualified; ${rejectedCount} did not, counted by ` +
      "reason in the provenance manifest.",
  );
  w(
    "The manifest also carries a SHA-256 over every candidate row exactly as it",
  );
  w("was received, so a reviewer holding the county's published neighbourhood");
  w("records can confirm that selection was shown the whole neighbourhood and");
  w("not a subset of it.");
  w();
  w(
    "Every candidate row that met those conditions is listed. None was excluded",
  );
  w(
    "for having a higher or lower assessment, and the list was not ranked, filtered",
  );
  w(
    "or trimmed by value in any way. Cook County Assessor Rule 15 directs filers to",
  );
  w(
    '"refrain from cherry picking only those comparable properties which are lower',
  );
  w(
    'in value than the subject property", and this selection is built so that it',
  );
  w("cannot: the step that chooses the properties is not given their values.");
  w();
  w(
    `Rule 15 requires at least ${RULE15_REQUIRED_MINIMUM} comparable properties and ` +
      `recommends at least ${RULE15_RECOMMENDED_MINIMUM}.`,
  );
  w(
    `This packet lists ${valued.length}` +
      (manifest.rule15RecommendationMet
        ? ", which meets the recommendation."
        : `, which meets the requirement but is below the recommendation of ${RULE15_RECOMMENDED_MINIMUM}.`),
  );
  w();

  w("3. THE COMPARABLE PROPERTIES");
  w("----------------------------");
  // The address column is sized to the widest address actually present. It used
  // to be sliced to 36 characters, which silently truncated long addresses in a
  // document whose whole instruction is to verify every line against the
  // county's records.
  const addressWidth = Math.max(
    "Address".length,
    ...valued.map((c) => safeText(addresses.get(c.pin)).length),
  );
  w(
    `${"PIN".padEnd(16)}${"Address".padEnd(addressWidth)}   Sq ft   Built    Assessed    $/sq ft`,
  );
  for (const c of valued) {
    const address = safeText(addresses.get(c.pin)).padEnd(addressWidth);
    w(
      `${c.pin.padEnd(16)}${address} ${String(c.buildingSqft.toLocaleString("en-US")).padStart(7)}  ` +
        `${String(c.yearBuilt).padStart(5)}  ${money(c.assessedTotalValue).padStart(10)}  ` +
        `${("$" + fixed(c.assessedPerSqft, 2)).padStart(9)}`,
    );
  }
  w();
  w(
    "Each comparable is identified by its Cook County PIN so that you, and the",
  );
  w("Assessor, can verify every line against the county's own records.");
  w();

  w("4. THE COMPARISON");
  w("-----------------");
  // One column width for all three lines, computed rather than hand-spaced, so
  // the block stays aligned whatever the comparable count is.
  const comparisonRows: Array<[string, string]> = [
    [
      "Your assessed value per square foot:",
      `$${fixed(measurement.subjectAssessedPerSqft, 2)}`,
    ],
    [
      `Median across the ${valued.length} comparables above:`,
      `$${fixed(measurement.comparableMedianAssessedPerSqft, 2)}`,
    ],
    [
      "Difference, as a share of the comparable median:",
      signedPercent(measurement.relativeGap),
    ],
  ];
  const labelWidth =
    Math.max(...comparisonRows.map(([label]) => label.length)) + 2;
  for (const [label, value] of comparisonRows)
    w(`${label.padEnd(labelWidth)}${value}`);
  w();
  w(
    "That is arithmetic on published assessed values and published building areas.",
  );
  w(
    "It is a description of the public record and nothing more. It is not a finding",
  );
  w(
    "that your assessment is wrong, not an estimate of any tax change, and not a",
  );
  w("prediction of what the Assessor or the Board of Review will decide.");
  w();
  w("This packet does not contain a drafted argument in your own voice.");
  w(manifest.draftArgumentOmissionReason);
  w();

  w("5. YOUR FILING WINDOW");
  w("---------------------");
  w(`Township:            ${safeText(subject.township)}`);
  w(
    `Assessor window closes: ${
      manifest.deadlineCloseDate === null
        ? "not published"
        : safeText(manifest.deadlineCloseDate)
    }`,
  );
  if (manifest.deadlineRetrievedAt && manifest.deadlineSourceName) {
    w(
      cc08({
        source: safeText(manifest.deadlineSourceName),
        timestamp: safeText(manifest.deadlineRetrievedAt),
      }),
    );
  }
  if (manifest.deadlineSourceUrl) {
    w(`Source: ${safeText(manifest.deadlineSourceUrl)}`);
  }
  w();
  w(
    "File your appeal with the Cook County Assessor yourself, through the county's",
  );
  w(
    "own filing route. Filing is free and the county publishes the route and its",
  );
  w("own comparable-property tool at no charge.");
  w();

  w("6. SOURCES BEHIND EVERY FIGURE");
  w("------------------------------");
  for (const s of manifest.sources) {
    w(`${safeText(s.datasetTitle)} (${safeText(s.datasetId)})`);
    w(`  ${safeText(s.url)}`);
    w(`  retrieved ${s.retrievedAt}`);
    w(
      s.contentSha256
        ? `  content sha256 ${s.contentSha256}`
        : "  content hash not available from source",
    );
  }
  w();
  w(CC_07);
  w();

  w("7. SCOPE, REFUNDS AND SUPPORT");
  w("-----------------------------");
  w(CC_17);
  w();
  w(CC_13);
  w();
  w(CC_14);
  w();
  w(CC_12);
  w();

  w("8. PROVENANCE MANIFEST");
  w("----------------------");
  w("Canonical JSON. Every field below is bound to these exact bytes.");
  w(canonicalJson(manifest));
  w();

  return lines.join("\n");
}

/** UTF-8 bytes of the packet. The workflow hashes exactly these. */
export function encodeT2Artifact(text: string): Buffer {
  return Buffer.from(text, "utf8");
}
