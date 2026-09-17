/**
 * The candidate-pool accounting invariant is enforced in production
 * construction, not only asserted in tests.
 *
 * `buildT2ArtifactContent` requires every raw candidate row to be either
 * accepted or rejected for exactly one reason. Selection satisfies that by
 * construction; this suite replaces selection with one that does not, and
 * proves the packet refuses `CANDIDATE_ACCOUNTING_MISMATCH` with no text and
 * no manifest rather than printing an accounting it cannot show.
 *
 * Synthetic fixtures only (99-prefixed PINs).
 */
import {
  buildT2ArtifactContent,
  type T2ArtifactInputs,
} from "@/lib/fulfillment/t2-artifact-content";
import type { ComparableSelection } from "@/lib/fulfillment/t2-comparables";

jest.mock("@/lib/fulfillment/t2-comparables", () => {
  const actual = jest.requireActual("@/lib/fulfillment/t2-comparables");
  return {
    ...actual,
    selectNonDirectionalComparables: jest.fn(
      actual.selectNonDirectionalComparables,
    ),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const comparables = require("@/lib/fulfillment/t2-comparables") as {
  selectNonDirectionalComparables: jest.Mock;
};
const actualSelect = jest.requireActual("@/lib/fulfillment/t2-comparables")
  .selectNonDirectionalComparables as (
  ...args: unknown[]
) => ComparableSelection | null;

const SUBJECT_PIN = "99030030030000";

function inputs(): T2ArtifactInputs {
  const candidates = [];
  const values = new Map<string, number>();
  const addresses = new Map<string, string>();
  for (let i = 1; i <= 6; i += 1) {
    const pin = `990300300400${String(i).padStart(2, "0")}`;
    candidates.push({
      pin,
      neighborhoodCode: "99030",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
    });
    values.set(pin, 24000);
    addresses.set(pin, `${i} INVARIANT AVE`);
  }
  return {
    orderId: "ord_invariant_0001",
    orderPropertyPin: SUBJECT_PIN,
    orderPropertyAddress: "3 INVARIANT ST",
    subject: {
      pin: SUBJECT_PIN,
      address: "3 INVARIANT ST",
      city: "Chicago",
      township: "Example",
      neighborhoodCode: "99030",
      propertyClass: "203",
      residentialSubtype: "1 Story",
      buildingSqft: 1200,
      yearBuilt: 1955,
      assessedTotalValue: 30000,
      assessmentStage: "mailed",
      taxYear: 2025,
      pinCount: 1,
      inCookCounty: true,
    },
    comparableCandidates: candidates,
    comparableAssessedValues: values,
    comparableAddresses: addresses,
    policy: {
      version: "test-only-policy",
      ownerDecisions: ["OD-2", "OD-3"],
      signedAt: "2026-06-08",
      evidenceThreshold: { minRelativeAssessmentGap: 0.2, minComparables: 5 },
    },
    deadline: {
      trusted: true,
      status: "open",
      closeDate: "2026-06-30",
      sourceName: "Cook County Assessor",
      sourceUrl: "https://example.invalid/deadline",
      retrievedAt: "2026-06-08T12:00:00Z",
      businessDaysRemainingAtGeneration: 16,
      businessDayCutoffAllowed: true,
    },
    sources: [
      {
        datasetId: "uzyt-m557",
        datasetTitle: "Assessor - Assessed Values",
        url: "https://example.invalid/uzyt-m557",
        retrievedAt: "2026-06-08T12:00:00Z",
        contentSha256: null,
      },
    ],
    generatedAt: "2026-06-08T12:00:00Z",
  };
}

afterEach(() => {
  comparables.selectNonDirectionalComparables.mockImplementation(actualSelect);
});

describe("the candidate accounting invariant is enforced at construction", () => {
  it("produces a packet when selection partitions the pool (control)", () => {
    const result = buildT2ArtifactContent(inputs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = Object.values(
      result.manifest.candidateRejectedByReason,
    ).reduce((a, b) => a + b, 0);
    expect(result.manifest.candidateAcceptedCount + total).toBe(
      result.manifest.candidateCount,
    );
  });

  it("refuses with no bytes when a row silently vanishes from both partitions", () => {
    comparables.selectNonDirectionalComparables.mockImplementation(
      (...args: unknown[]) => {
        const selection = actualSelect(...args);
        if (!selection) return selection;
        // Drop one accepted row without recording a rejection for it.
        return { ...selection, accepted: selection.accepted.slice(1) };
      },
    );
    const result = buildT2ArtifactContent(inputs());
    expect(result).toEqual({
      ok: false,
      blocker: "CANDIDATE_ACCOUNTING_MISMATCH",
    });
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("manifest");
  });

  it("refuses when a row is counted twice", () => {
    comparables.selectNonDirectionalComparables.mockImplementation(
      (...args: unknown[]) => {
        const selection = actualSelect(...args);
        if (!selection) return selection;
        return {
          ...selection,
          rejected: [
            ...selection.rejected,
            { pin: selection.accepted[0].pin, reason: "duplicate_pin" },
          ],
        };
      },
    );
    expect(buildT2ArtifactContent(inputs())).toEqual({
      ok: false,
      blocker: "CANDIDATE_ACCOUNTING_MISMATCH",
    });
  });
});
