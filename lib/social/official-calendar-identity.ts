/**
 * Township identity and source authority for official-calendar content.
 *
 * Slice A1 of the review-only calendar content engine: the two questions that
 * must be settled before a date may be quoted in social copy — *which*
 * township is this, and is the thing we would cite an official Cook County
 * publication that still says what the drafter read? Neither was previously
 * asked: EXAMPLE_OT_DEADLINE_POST in [[lib/social/ot-deadline-approval]] names
 * a township "Lakeview", which is neither the roster's "Lake View" nor the
 * separate township called "Lake".
 *
 * Nothing here reads a clock, fetches, or touches a date. Window freshness
 * stays with [[evaluateOfficialDeadlineState]].
 */

import {
  type DeadlineStage,
  type OfficialDeadlineSnapshot,
  type SourceAuthority,
} from "@/lib/deadlines/official-source-state";
import { townshipKeyFromName } from "@/lib/deadlines/township-resolution";
import { isOfficialSourceUrl } from "@/lib/social/ot-deadline-approval";
import { TOWNSHIPS_BY_SLUG } from "@/lib/townships";

/** The authorities whose own publications may support a deadline claim. */
export const OFFICIAL_AUTHORITIES: ReadonlySet<SourceAuthority> = new Set([
  "cook_county_assessor",
  "cook_county_board_of_review",
]);

/**
 * Township labels this module refuses to resolve on its own.
 *
 * The Assessor's 2026 calendar prints "Lakeview" (snapshot key `lakeview`);
 * the governed roster carries `lake-view`; `lake` is a third, genuinely
 * different township. Three labels, three keys, nothing saying which one a
 * post meant. Until a governance mapping is supplied every member is rejected,
 * `lake` included — a reader cannot tell it from a shortened "Lake View".
 */
export const AMBIGUOUS_TOWNSHIP_ALIASES: ReadonlySet<string> = new Set([
  "lake",
  "lakeview",
  "lake-view",
]);

/**
 * A governance mapping must name both keys: they are two key spaces that do
 * not coincide — `governedSlug` addresses our roster and pages, `snapshotKey`
 * the row the county published. Lakeview is exactly where the two differ.
 */
export type TownshipAliasResolution = {
  governedSlug: string;
  snapshotKey: string;
};

export type TownshipAliasResolver = (
  label: string,
) => TownshipAliasResolution | null;

export type CandidateTownship = {
  governedSlug: string;
  snapshotKey: string;
  /** The county's own name for the row, never the drafter's spelling. */
  townshipName: string;
  aliasesUsed: readonly string[];
  resolvedBy: "direct_key_match" | "governance_mapping";
};

export type IdentityFailureReason =
  | "township_label_empty"
  | "township_alias_ambiguous"
  | "township_missing_from_snapshot"
  | "township_missing_from_roster";

export type AuthorityFailureReason =
  | "source_unavailable"
  | "source_unofficial"
  | "source_hash_changed";

export type IdentityFailure = { reason: IdentityFailureReason; detail: string };
export type AuthorityFailure = {
  reason: AuthorityFailureReason;
  detail: string;
};

export type ResolveTownshipResult =
  | { ok: true; township: CandidateTownship }
  | { ok: false; failure: IdentityFailure };

/**
 * Resolve a drafter's written label to exactly one citable township.
 *
 * Both key spaces must be satisfied: without a snapshot row there is nothing
 * to cite, without a roster entry we cannot say which of our pages the claim
 * is about. Satisfying one and not the other is the Lakeview case, and it
 * fails closed rather than picking the nearer of the two.
 */
export function resolveCandidateTownship(
  label: string,
  snapshot: OfficialDeadlineSnapshot,
  resolveAlias?: TownshipAliasResolver,
): ResolveTownshipResult {
  const trimmed = label
    .trim()
    .replace(/\s*township\s*$/i, "")
    .trim();
  if (!trimmed) {
    return {
      ok: false,
      failure: { reason: "township_label_empty", detail: "label is blank" },
    };
  }

  const governed = resolveAlias?.(trimmed) ?? null;
  const governedSlug = governed?.governedSlug ?? townshipKeyFromName(trimmed);
  const snapshotKey = governed?.snapshotKey ?? townshipKeyFromName(trimmed);

  // The family check applies only to labels nothing governed. A mapping that
  // states both keys has made the decision this guard exists to refuse to make.
  if (!governed && AMBIGUOUS_TOWNSHIP_ALIASES.has(snapshotKey)) {
    return {
      ok: false,
      failure: {
        reason: "township_alias_ambiguous",
        detail: `"${trimmed}" is in the unresolved Lake/Lake View/Lakeview family and no governance mapping resolved it`,
      },
    };
  }

  const row = snapshot.townships?.[snapshotKey];
  if (!row) {
    return {
      ok: false,
      failure: {
        reason: "township_missing_from_snapshot",
        detail: `the snapshot publishes no row keyed "${snapshotKey}"`,
      },
    };
  }
  if (!Object.hasOwn(TOWNSHIPS_BY_SLUG, governedSlug)) {
    return {
      ok: false,
      failure: {
        reason: "township_missing_from_roster",
        detail: `"${governedSlug}" is not a governed township slug`,
      },
    };
  }

  return {
    ok: true,
    township: {
      governedSlug,
      snapshotKey,
      townshipName: row.townshipName,
      aliasesUsed: Array.from(new Set([trimmed, row.townshipName])).sort(),
      resolvedBy: governed ? "governance_mapping" : "direct_key_match",
    },
  };
}

/**
 * The two provenance questions the canonical evaluator does not ask. Who
 * published it — that evaluator checks a retrieval succeeded, parsed and is
 * fresh, all of which an aggregator response satisfies. And whether the bytes
 * are still the reviewed bytes: the county republishes through the season, and
 * copy approved against one version is not approved against the next.
 */
export function checkStageAuthority(
  snapshot: OfficialDeadlineSnapshot,
  stage: DeadlineStage,
  expectedSha256?: string,
): AuthorityFailure | null {
  const source = snapshot.sources?.[stage] ?? null;
  if (!source) {
    return {
      reason: "source_unavailable",
      detail: `the snapshot carries no ${stage} provenance`,
    };
  }
  if (
    !OFFICIAL_AUTHORITIES.has(source.authority) ||
    !isOfficialSourceUrl(source.sourceUrl) ||
    !isOfficialSourceUrl(source.finalUrl)
  ) {
    return {
      reason: "source_unofficial",
      detail: `${stage} provenance is not an official Cook County publication: ${source.authority} via ${source.finalUrl}`,
    };
  }
  if (expectedSha256 && expectedSha256 !== source.contentSha256) {
    return {
      reason: "source_hash_changed",
      detail: `${stage} content hash is now ${source.contentSha256}; the drafter reviewed ${expectedSha256}`,
    };
  }
  return null;
}
