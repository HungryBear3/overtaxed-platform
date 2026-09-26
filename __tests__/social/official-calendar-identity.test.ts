/**
 * Slice A1: which township, and is the source official and unchanged?
 *
 * The provenance below is the real pinned capture — the URLs and SHA-256
 * digests recorded in `__tests__/fixtures/deadlines/SOURCES.md` — and the
 * township keys are the ones the committed parser produces from it: `calumet`,
 * `lemont`, and the defect this slice exists for, `lakeview`, which the
 * governed roster spells `lake-view`.
 */

import {
  AMBIGUOUS_TOWNSHIP_ALIASES,
  checkStageAuthority,
  resolveCandidateTownship,
  type ResolveTownshipResult,
  type TownshipAliasResolver,
} from "@/lib/social/official-calendar-identity";
import type {
  OfficialDeadlineSnapshot,
  SourceProvenance,
} from "@/lib/deadlines/official-source-state";

const ASSESSOR_SHA =
  "bb3b7a8747ae39140c8c8b09d508f9dc65ab5321b5be3a356caa136caa0248ca";
const BOR_SHA =
  "04eaa4db1b0be4bc00dd3ec5834cd67bc16ab0cba4bb0380e676461a16b7925b";
const ASSESSOR_URL =
  "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines";
const BOR_URL =
  "https://www.cookcountyboardofreview.com/sites/g/files/ywwepo261/files/document/file/2026-08/2026TOWNSHIPOPEN-CLOSE.pdf";

function provenance(over: Partial<SourceProvenance> = {}): SourceProvenance {
  return {
    authority: "cook_county_assessor",
    sourceUrl: ASSESSOR_URL,
    retrievedAt: "2026-08-27T15:00:00.000Z",
    sourceUpdatedAt: null,
    contentSha256: ASSESSOR_SHA,
    httpStatus: 200,
    finalUrl: ASSESSOR_URL,
    parseStatus: "ok",
    parserVersion: "2.0.0",
    ...over,
  };
}

const BOR_PROVENANCE = provenance({
  authority: "cook_county_board_of_review",
  sourceUrl: BOR_URL,
  finalUrl: BOR_URL,
  contentSha256: BOR_SHA,
});

function snapshot(
  sources: OfficialDeadlineSnapshot["sources"] = {
    assessor: provenance(),
    bor: BOR_PROVENANCE,
  },
): OfficialDeadlineSnapshot {
  return {
    schemaVersion: 1,
    synthetic: false,
    sources,
    townships: {
      calumet: { townshipName: "Calumet", stages: {} },
      lemont: { townshipName: "Lemont", stages: {} },
      lake: { townshipName: "Lake", stages: {} },
      lakeview: { townshipName: "Lakeview", stages: {} },
      unincorporated: { townshipName: "Unincorporated", stages: {} },
    },
  };
}

const SNAP = snapshot();

/** The failure reason, or "resolved" — keeps the assertions one line each. */
const why = (r: ResolveTownshipResult) =>
  r.ok ? "resolved" : r.failure.reason;

describe("resolveCandidateTownship", () => {
  it("resolves a township the county and the roster name the same way", () => {
    expect(resolveCandidateTownship("Calumet", SNAP)).toEqual({
      ok: true,
      township: {
        governedSlug: "calumet",
        snapshotKey: "calumet",
        townshipName: "Calumet",
        aliasesUsed: ["Calumet"],
        resolvedBy: "direct_key_match",
      },
    });
  });

  it("strips a Township suffix and is case-insensitive", () => {
    const r = resolveCandidateTownship("  lemont Township ", SNAP);
    expect(r.ok && r.township.snapshotKey).toBe("lemont");
    expect(r.ok && r.township.aliasesUsed).toEqual(["Lemont", "lemont"]);
  });

  it.each(["Lakeview", "Lake View", "Lake", "lake-view"])(
    "refuses the ambiguous alias %p rather than choosing a township",
    (label) => {
      expect(why(resolveCandidateTownship(label, SNAP))).toBe(
        "township_alias_ambiguous",
      );
    },
  );

  it("declares the whole Lake family, so none of it resolves by accident", () => {
    const family = [...AMBIGUOUS_TOWNSHIP_ALIASES].sort();
    expect(family).toEqual(["lake", "lake-view", "lakeview"]);
  });

  it("accepts the ambiguous label only when governance names both keys", () => {
    const resolveAlias: TownshipAliasResolver = (label) =>
      label === "Lakeview"
        ? { governedSlug: "lake-view", snapshotKey: "lakeview" }
        : null;
    expect(resolveCandidateTownship("Lakeview", SNAP, resolveAlias)).toEqual({
      ok: true,
      township: {
        governedSlug: "lake-view",
        snapshotKey: "lakeview",
        townshipName: "Lakeview",
        aliasesUsed: ["Lakeview"],
        resolvedBy: "governance_mapping",
      },
    });
  });

  it("refuses a governance mapping that points at no published row", () => {
    const toMissingRow: TownshipAliasResolver = () => ({
      governedSlug: "lake-view",
      snapshotKey: "lake-view",
    });
    expect(why(resolveCandidateTownship("Lakeview", SNAP, toMissingRow))).toBe(
      "township_missing_from_snapshot",
    );
  });

  it("refuses a county row that has no governed roster entry", () => {
    expect(why(resolveCandidateTownship("Unincorporated", SNAP))).toBe(
      "township_missing_from_roster",
    );
  });

  it("refuses a township the county does not publish at all", () => {
    expect(why(resolveCandidateTownship("Barrington", SNAP))).toBe(
      "township_missing_from_snapshot",
    );
  });

  it("refuses a blank label", () => {
    expect(why(resolveCandidateTownship("  Township ", SNAP))).toBe(
      "township_label_empty",
    );
  });
});

describe("checkStageAuthority", () => {
  it("accepts both official Cook County publications", () => {
    expect(checkStageAuthority(SNAP, "assessor")).toBeNull();
    expect(checkStageAuthority(SNAP, "bor")).toBeNull();
  });

  it("refuses a stage with no provenance", () => {
    const only = snapshot({ assessor: provenance() });
    expect(checkStageAuthority(only, "bor")?.reason).toBe("source_unavailable");
  });

  it("refuses an aggregator even when the retrieval looks perfect", () => {
    const realie = snapshot({
      assessor: provenance({
        sourceUrl: "https://api.realie.ai/cook-county/deadlines",
        finalUrl: "https://api.realie.ai/cook-county/deadlines",
      }),
    });
    expect(checkStageAuthority(realie, "assessor")?.reason).toBe(
      "source_unofficial",
    );
  });

  it("refuses an official URL redirected off the authority's host", () => {
    const moved = snapshot({
      assessor: provenance({ finalUrl: "https://mirror.example.com/cal" }),
    });
    expect(checkStageAuthority(moved, "assessor")?.reason).toBe(
      "source_unofficial",
    );
  });

  it("binds the claim to the reviewed bytes", () => {
    expect(checkStageAuthority(SNAP, "assessor", ASSESSOR_SHA)).toBeNull();
    expect(checkStageAuthority(SNAP, "assessor", BOR_SHA)?.reason).toBe(
      "source_hash_changed",
    );
  });
});
