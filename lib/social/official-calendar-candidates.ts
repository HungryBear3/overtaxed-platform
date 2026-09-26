/**
 * Slice A2 of the review-only calendar content engine: which dated claims may
 * a drafter make, about which township, from which reviewed bytes? Every gate
 * belongs to someone else — identity and authority to
 * [[lib/social/official-calendar-identity]], freshness and status to
 * [[evaluateOfficialDeadlineState]]. No I/O, no clock, no alias table.
 */

import { createHash } from "node:crypto";

import {
  evaluateOfficialDeadlineState,
  type DeadlineStage,
  type OfficialDeadlineSnapshot,
  type PendingReason,
  type SourceProvenance,
  type StageWindow,
  type WindowStatus,
} from "@/lib/deadlines/official-source-state";
import { informationalTownship } from "@/lib/deadlines/township-resolution";
import {
  checkStageAuthority,
  resolveCandidateTownship,
  type AuthorityFailureReason,
  type IdentityFailureReason,
} from "@/lib/social/official-calendar-identity";

export type CandidateClaimKind =
  | "notice_date"
  | "window_opens"
  | "last_file_date";

export type CandidateClaim = { kind: CandidateClaimKind; date: string };

/**
 * What each stage's publication may be quoted as saying. The Board of Review
 * prints no notice date, so its contract has no notice claim to narrate even
 * if a row were to carry one. A notice claim is emitted only when the verified
 * window itself carries the date — never derived from the open date.
 */
type Contract = { kind: CandidateClaimKind; field: keyof StageWindow };

export const CLAIM_CONTRACTS: Record<DeadlineStage, readonly Contract[]> = {
  assessor: [
    { kind: "notice_date", field: "noticeDate" },
    { kind: "window_opens", field: "openDate" },
    { kind: "last_file_date", field: "lastFileDate" },
  ],
  bor: [
    { kind: "window_opens", field: "openDate" },
    { kind: "last_file_date", field: "lastFileDate" },
  ],
};

/**
 * What a candidate relied on: the provenance as the snapshot carries it —
 * `sourceUpdatedAt` included, null never filled in — plus a semantic locator,
 * `<authority>/townships/<snapshotKey>/stages/<stage>@<sha256>`. No page/row.
 */
export type SourceReceipt = Omit<
  SourceProvenance,
  "httpStatus" | "parseStatus"
> & {
  stage: DeadlineStage;
  locator: string;
};

/**
 * One township, one stage, one authority. Assessor and Board of Review windows
 * are separate candidates and nothing here relates one to the other.
 */
export type OfficialCalendarCandidate = {
  candidateId: string;
  /** SHA-256 of the canonical content below; excludes every clock-derived field. */
  contentHash: string;
  governedSlug: string;
  snapshotKey: string;
  townshipName: string;
  stage: DeadlineStage;
  claims: readonly CandidateClaim[];
  receipt: SourceReceipt;
  /** Clock-derived; carried for review, deliberately outside the hash. */
  status: WindowStatus;
  evaluatedAt: string;
};

export type CandidateRejectionReason =
  | IdentityFailureReason
  | AuthorityFailureReason
  | PendingReason
  | "stage_unknown"
  | "expected_hash_missing";

export type CandidateRejection = {
  label: string;
  stage: DeadlineStage | null;
  reason: CandidateRejectionReason;
};

export type BuildCandidatesInput = {
  snapshot: OfficialDeadlineSnapshot;
  evaluatedAt: string;
  townshipLabels: readonly string[];
  stages: readonly DeadlineStage[];
  /** The digest a human reviewed, per cited stage. Required, not defaulted. */
  expectedSha256: Partial<Record<DeadlineStage, string>>;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** JSON with keys sorted at every depth, so insertion order cannot leak in. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function buildOfficialCalendarCandidates(input: BuildCandidatesInput): {
  candidates: OfficialCalendarCandidate[];
  rejections: CandidateRejection[];
} {
  const { snapshot, evaluatedAt, townshipLabels, stages, expectedSha256 } =
    input;
  const byId = new Map<string, OfficialCalendarCandidate>();
  const rejections: CandidateRejection[] = [];
  const reject = (r: CandidateRejection) => rejections.push(r);

  for (const label of townshipLabels) {
    const resolved = resolveCandidateTownship(label, snapshot);
    if (!resolved.ok) {
      reject({ label, stage: null, reason: resolved.failure.reason });
      continue;
    }
    const { governedSlug, snapshotKey, townshipName } = resolved.township;

    for (const stage of stages) {
      if (!Object.hasOwn(CLAIM_CONTRACTS, stage)) {
        reject({ label, stage, reason: "stage_unknown" });
        continue;
      }
      const expected = expectedSha256[stage];
      if (typeof expected !== "string" || !SHA256_HEX.test(expected)) {
        reject({ label, stage, reason: "expected_hash_missing" });
        continue;
      }
      const authority = checkStageAuthority(snapshot, stage, expected);
      if (authority) {
        reject({ label, stage, reason: authority.reason });
        continue;
      }
      const state = evaluateOfficialDeadlineState({
        snapshot,
        township: informationalTownship(snapshotKey, townshipName),
        stage,
        evaluatedAt,
      });
      if (state.kind !== "verified") {
        reject({ label, stage, reason: state.reason });
        continue;
      }

      const claims: CandidateClaim[] = [];
      for (const { kind, field } of CLAIM_CONTRACTS[stage]) {
        const date = state[field];
        if (typeof date === "string" && date) claims.push({ kind, date });
      }
      // Retrieval time is kept out of the hash: a refetch of identical bytes is
      // the same content, and the digest already pins which bytes those were.
      const {
        httpStatus: _h,
        parseStatus: _p,
        retrievedAt,
        ...pinned
      } = state.provenance;
      const locator = `${pinned.authority}/townships/${snapshotKey}/stages/${stage}@${pinned.contentSha256}`;
      const receipt: SourceReceipt = { stage, ...pinned, retrievedAt, locator };
      const body = { governedSlug, snapshotKey, townshipName, stage, claims };
      const contentHash = createHash("sha256")
        .update(canonicalJson({ ...body, receipt: { ...pinned, locator } }))
        .digest("hex");
      const candidateId = `occ_${contentHash.slice(0, 24)}`;
      if (byId.has(candidateId)) continue;
      byId.set(candidateId, {
        candidateId,
        contentHash,
        ...body,
        receipt,
        status: state.status,
        evaluatedAt: state.evaluatedAt,
      });
    }
  }

  const order = (c: OfficialCalendarCandidate) =>
    `${c.snapshotKey}\u0000${c.stage}`;
  const candidates = [...byId.values()].sort((a, b) =>
    order(a) < order(b) ? -1 : 1,
  );
  return { candidates, rejections };
}
