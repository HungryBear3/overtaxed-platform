/**
 * Slice A3: what may a draft say when it is written? A reviewed candidate and
 * its approval are evidence of the past, never current authority: each draft
 * rebuilds the candidate ([[lib/social/official-calendar-candidates]]) and asks
 * [[projectDeadline]] what the draft instant permits. No I/O, clock or posting.
 */

import {
  countyCalendarDay,
  evaluateOfficialDeadlineState,
  projectDeadline,
  SAME_DAY_REQUIRED_WITHIN_DAYS,
  type OfficialDeadlineSnapshot,
  type PendingReason,
} from "@/lib/deadlines/official-source-state";
import {
  informationalTownship,
  type TownshipResolution,
} from "@/lib/deadlines/township-resolution";
import {
  buildOfficialCalendarCandidates,
  type CandidateClaim,
  type CandidateRejectionReason,
  type OfficialCalendarCandidate,
} from "@/lib/social/official-calendar-candidates";

/** Wording classes, in the fixed order every result lists them. */
export const DRAFT_INTENTS = [
  "plain_date",
  "countdown",
  "deadline_near",
  "reminder",
  "urgency",
  "cta",
] as const;
export type DraftIntent = (typeof DRAFT_INTENTS)[number];

/** A human's sign-off, bound to exact candidate content and a county day. */
export type CandidateApproval = {
  candidateId: string;
  contentHash: string;
  approvedAt: string;
  approvedIntents: readonly DraftIntent[];
};

export type DraftGateInput = {
  /** The reviewed record. Evidence only; nothing on it is trusted as current. */
  candidate: OfficialCalendarCandidate;
  approval: CandidateApproval | null;
  snapshot: OfficialDeadlineSnapshot;
  draftedAt: string;
  requestedIntents: readonly DraftIntent[];
  /** Only an official property record can make a window someone's deadline. */
  identity?: TownshipResolution;
};

export type DraftBlockReason =
  | CandidateRejectionReason
  | PendingReason
  | "canonical_changed"
  | "identity_mismatch"
  | "intent_unknown"
  | "window_closed"
  | "window_not_open"
  | "identity_not_eligible"
  | "deadline_not_near"
  | "approval_missing"
  | "approval_changed"
  | "approval_stale"
  | "approval_scope";

export type DraftGateResult = {
  candidateId: string;
  /** Hash of the candidate rebuilt at draft time; null when it could not be. */
  currentContentHash: string | null;
  verdict: "blocked" | "date_only" | "permitted";
  decisions: {
    intent: DraftIntent;
    allowed: boolean;
    reason: DraftBlockReason | null;
  }[];
  /** Plain dates the fresh projection lets a draft state; empty otherwise. */
  dateEvidence: CandidateClaim[];
  reviewOnly: true;
  postAllowed: false;
};

function approvalProblem(
  approval: CandidateApproval | null,
  fresh: OfficialCalendarCandidate,
  reviewed: OfficialCalendarCandidate,
  draftedAt: string,
): DraftBlockReason | null {
  if (!approval) return "approval_missing";
  const changed =
    approval.candidateId !== fresh.candidateId ||
    approval.contentHash !== fresh.contentHash ||
    // Status is clock-derived and outside the hash: re-read, never inherited.
    reviewed.status !== fresh.status;
  if (changed) return "approval_changed";
  const approvedMs = Date.parse(approval.approvedAt);
  const draftedMs = Date.parse(draftedAt);
  // NaN compares false, so an unparseable approval instant is stale too.
  if (!(approvedMs <= draftedMs)) return "approval_stale";
  const sameDay =
    countyCalendarDay(approvedMs) === countyCalendarDay(draftedMs);
  return sameDay ? null : "approval_stale";
}

export function gateOfficialCalendarDraft(
  input: DraftGateInput,
): DraftGateResult {
  const { candidate, approval, snapshot, identity } = input;
  const { draftedAt: evaluatedAt, requestedIntents: asked } = input;
  // Fixed order, duplicates collapsed; one unknown intent refuses the request.
  const requested = DRAFT_INTENTS.filter((k) => asked.includes(k));
  const unknown = asked.some((k) => !requested.includes(k));
  // Rebuild from the snapshot as it is now, pinned to the digest reviewed.
  const rebuilt = buildOfficialCalendarCandidates({
    snapshot,
    evaluatedAt,
    townshipLabels: [candidate.snapshotKey],
    stages: [candidate.stage],
    expectedSha256: { [candidate.stage]: candidate.receipt.contentSha256 },
  });
  const fresh = rebuilt.candidates[0];
  const result = (
    decide: (intent: DraftIntent) => DraftBlockReason | null,
  ): DraftGateResult => {
    const decisions = requested.map((intent) => {
      const reason = unknown ? "intent_unknown" : decide(intent);
      return { intent, allowed: reason === null, reason };
    });
    const allowed = decisions.filter((d) => d.allowed).map((d) => d.intent);
    return {
      candidateId: candidate.candidateId,
      currentContentHash: fresh?.contentHash ?? null,
      verdict: allowed.some((k) => k !== "plain_date")
        ? "permitted"
        : allowed.length
          ? "date_only"
          : "blocked",
      decisions,
      dateEvidence:
        allowed.includes("plain_date") && fresh
          ? fresh.claims.map((c) => ({ ...c }))
          : [],
      reviewOnly: true,
      postAllowed: false,
    };
  };
  const blockAll = (reason: DraftBlockReason) => result(() => reason);

  if (!fresh) {
    return blockAll(rebuilt.rejections[0]?.reason ?? "source_unavailable");
  }
  if (fresh.contentHash !== candidate.contentHash) {
    return blockAll("canonical_changed");
  }
  if (identity && identity.townshipKey !== fresh.snapshotKey) {
    return blockAll("identity_mismatch");
  }

  const township =
    identity ?? informationalTownship(fresh.snapshotKey, fresh.townshipName);
  const { stage } = fresh;
  const projection = projectDeadline(
    evaluateOfficialDeadlineState({ snapshot, township, stage, evaluatedAt }),
    evaluatedAt,
  );
  if (!projection.available) return blockAll(projection.reason);

  const unapproved = approvalProblem(approval, fresh, candidate, evaluatedAt);
  const windowReason = (need: boolean): DraftBlockReason | null => {
    if (need) return null;
    if (projection.status === "closed") return "window_closed";
    if (!projection.eligible) return "identity_not_eligible";
    return "window_not_open";
  };
  const canonicalReason: Record<DraftIntent, DraftBlockReason | null> = {
    plain_date: projection.showDates ? null : "date_invalid",
    countdown: windowReason(projection.showCountdown),
    reminder: windowReason(projection.allowReminderSignup),
    urgency: windowReason(projection.allowDeadlineCta),
    cta: windowReason(projection.allowDeadlineCta),
    deadline_near:
      windowReason(projection.allowDeadlineCta && projection.showCountdown) ??
      ((projection.daysRemaining ?? Infinity) <= SAME_DAY_REQUIRED_WITHIN_DAYS
        ? null
        : "deadline_not_near"),
  };

  return result((intent) => {
    const canonical = canonicalReason[intent];
    if (canonical || intent === "plain_date") return canonical;
    if (unapproved) return unapproved;
    return approval?.approvedIntents.includes(intent) ? null : "approval_scope";
  });
}
