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

  const ASSESSOR_ON_BOR_HOST = provenance({
    sourceUrl: BOR_URL,
    finalUrl: BOR_URL,
  });
  const BOR_ON_ASSESSOR_HOST = provenance({
    authority: "cook_county_board_of_review",
  });
  const REDIRECTED_TO_BOR = provenance({ finalUrl: BOR_URL });

  // Every pairing below is official on its own; only the stage makes it wrong.
  it.each([
    ["assessor", "Board of Review provenance", BOR_PROVENANCE],
    ["assessor", "Assessor authority on the BOR host", ASSESSOR_ON_BOR_HOST],
    ["assessor", "a redirect onto the BOR host", REDIRECTED_TO_BOR],
    ["bor", "Assessor provenance", provenance()],
    ["bor", "Assessor authority on the BOR host", ASSESSOR_ON_BOR_HOST],
    ["bor", "BOR authority on the Assessor host", BOR_ON_ASSESSOR_HOST],
  ] as const)("refuses the %s stage from %s", (stage, _label, source) => {
    const snap = snapshot({ assessor: source, bor: source });
    expect(checkStageAuthority(snap, stage)?.reason).toBe("source_unofficial");
  });

  const STAGE_SOURCES = {
    assessor: provenance(),
    bor: BOR_PROVENANCE,
  } as const;

  // Each variant keeps the stage's exact official host; only the scheme or
  // the userinfo is wrong, so the host rule alone would wave it through.
  const withScheme = (url: string, scheme: string) =>
    url.replace(/^https:/, `${scheme}:`);
  const withUserinfo = (url: string, userinfo: string) =>
    url.replace(/^https:\/\//, `https://${userinfo}@`);
  const HOSTILE_URLS: ReadonlyArray<
    readonly [string, (url: string) => string]
  > = [
    ["http", (u) => withScheme(u, "http")],
    ["file", (u) => withScheme(u, "file")],
    ["ftp", (u) => withScheme(u, "ftp")],
    ["ws", (u) => withScheme(u, "ws")],
    ["wss", (u) => withScheme(u, "wss")],
    ["an arbitrary foo scheme", (u) => withScheme(u, "foo")],
    ["an upper-case HTTP scheme", (u) => withScheme(u, "HTTP")],
    ["username and password", (u) => withUserinfo(u, "user:pass")],
    ["username only", (u) => withUserinfo(u, "user")],
    ["password only", (u) => withUserinfo(u, ":pass")],
  ];
  const PLACEMENTS = [
    ["sourceUrl", (url: string) => ({ sourceUrl: url })],
    ["finalUrl", (url: string) => ({ finalUrl: url })],
    ["both URLs", (url: string) => ({ sourceUrl: url, finalUrl: url })],
  ] as const;

  describe.each(["assessor", "bor"] as const)(
    "on the %s stage's own host",
    (stage) => {
      const official = STAGE_SOURCES[stage];
      const cases = HOSTILE_URLS.flatMap(([variant, rewrite]) =>
        PLACEMENTS.map(
          ([where, place]) =>
            [variant, where, place(rewrite(official.sourceUrl))] as const,
        ),
      );

      it.each(cases)("refuses %s in %s", (_variant, _where, over) => {
        const snap = snapshot({ [stage]: { ...official, ...over } });
        expect(checkStageAuthority(snap, stage)?.reason).toBe(
          "source_unofficial",
        );
      });
    },
  );

  it.each([
    [
      "an upper-case scheme and host",
      "HTTPS://WWW.COOKCOUNTYASSESSORIL.GOV/assessment-calendar-and-deadlines",
    ],
    [
      "an explicit default port",
      "https://www.cookcountyassessoril.gov:443/assessment-calendar-and-deadlines",
    ],
    [
      "a fragment",
      "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines#2026",
    ],
    [
      "the apex host",
      "https://cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    ],
    [
      "an empty userinfo the parser drops",
      "https://@www.cookcountyassessoril.gov/assessment-calendar-and-deadlines",
    ],
  ])("still accepts an official HTTPS URL with %s", (_label, url) => {
    const snap = snapshot({
      assessor: provenance({ sourceUrl: url, finalUrl: url }),
    });
    expect(checkStageAuthority(snap, "assessor")).toBeNull();
  });

  it("refuses the official host on a non-default port", () => {
    const snap = snapshot({
      assessor: provenance({
        finalUrl:
          "https://www.cookcountyassessoril.gov:8443/assessment-calendar-and-deadlines",
      }),
    });
    expect(checkStageAuthority(snap, "assessor")?.reason).toBe(
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
