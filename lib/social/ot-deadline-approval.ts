/**
 * OverTaxed IL (brand "ot") — source-verified deadline social post approval.
 *
 * This is a LOCAL / internal approval-board data shape + pure helpers. It exists
 * so the internal approval cards can show verification state clearly for OT
 * posts that reference Cook County Assessor appeal windows. Those deadline
 * claims go stale quickly and must be source-verified same-day before any human
 * approval.
 *
 * HARD BOUNDARIES (enforced structurally, not by convention):
 *   - This module performs NO network I/O. No Buffer, no Facebook/Meta Graph,
 *     no fetch/axios, no public upload. It is pure data + pure functions.
 *   - `post_allowed` is a literal `false` and is never set to `true` anywhere.
 *     Approval here only marks platform-scoped, human-approved readiness for a
 *     SEPARATE manual process — it never posts or authorizes posting.
 *   - We never INFER a future township deadline. `verified_deadlines` rows are
 *     supplied by a human source check (Rex) against the official calendar; this
 *     module only reads them. No date is generated for a township here.
 *   - No secrets/tokens are stored or referenced.
 *
 * Approval is PLATFORM-SCOPED: an "approved_only" card for Facebook does not
 * imply Instagram, Buffer, or boosting — see {@link isApprovedForPlatform}.
 */

import { ASSESSOR_CALENDAR_URL } from "@/lib/deadline-sources";

export type OtBrand = "ot";

/** Source-verification state shown on the approval card. */
export type SourceVerificationStatus = "cleared" | "blocked" | "stale" | "missing";

/**
 * Where the card sits in the local, non-public workflow.
 * `posted` is only ever set by the separate manual process — this module never
 * produces it and treats it as terminal/read-only.
 */
export type PublicActionStatus = "draft" | "approved_only" | "posted" | "held";

/** Per-township verified status from the same-day source check. */
export type VerifiedDeadlineStatus = "open" | "closing_soon" | "closed" | "unverified";

export interface VerifiedDeadline {
  township: string;
  /** ISO date (yyyy-mm-dd) taken from the official calendar by a human check. */
  deadline_date: string;
  status: VerifiedDeadlineStatus;
}

/**
 * Raw fields a drafter/Rex supplies. Computed fields
 * (`source_verification_status`, `expires_at`, `public_action_status`,
 * `post_allowed`) are derived by {@link buildOtDeadlineApprovalCard} and any
 * caller-provided values for them are ignored.
 */
export interface OtDeadlinePostInput {
  brand: OtBrand | string;
  content_id: string;
  platform_scope: string[];
  asset_path: string;
  caption: string;
  source_url: string | null;
  source_name: string | null;
  /** ISO datetime of the human same-day source check. */
  source_checked_at: string | null;
  source_last_updated_marker: string | null;
  verified_deadlines: VerifiedDeadline[];
  /**
   * Closed townships flagged in the same source pass that must NOT be presented
   * as open. If any appears in the caption, approval is blocked (fail-closed).
   */
  closed_townships_mentioned: string[];
}

/** Full internal approval card. */
export interface OtDeadlineApprovalCard extends OtDeadlinePostInput {
  source_verification_status: SourceVerificationStatus;
  /** ISO datetime after which approval no longer holds. */
  expires_at: string | null;
  public_action_status: PublicActionStatus;
  approval_required: true;
  /** Always false. Approval is never permission to post. */
  post_allowed: false;
}

export interface ApprovalDecision {
  /** False for non-OT posts — deadline verification rules do not apply. */
  applies: boolean;
  source_verification_status: SourceVerificationStatus;
  /** cleared AND not expired AND not blocked. */
  approval_ready: boolean;
  /** Always false — mirrors the card; posting is out of scope here. */
  post_allowed: false;
  expires_at: string | null;
  /** Human-readable notes for the card (why blocked / stale / etc.). */
  reasons: string[];
}

export interface EvaluateOptions {
  /** Injectable clock for tests. Defaults to now. */
  now?: Date;
}

// Date-specific deadline copy must be checked SAME DAY (<= 24h old).
const SAME_DAY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Hard ceiling for any deadline approval window.
const MAX_APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Official hosts we will accept as a verifiable deadline source.
const OFFICIAL_SOURCE_HOSTS = new Set([
  "www.cookcountyassessoril.gov",
  "cookcountyassessoril.gov",
  "www.cookcountyboardofreview.com",
  "cookcountyboardofreview.com",
]);

// Caption references a concrete calendar date (month name + day, ISO, or M/D).
const DEADLINE_DATE_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;

// Language that presents an appeal window as open.
const OPEN_FRAMING_RE =
  /\b(?:now open|open now|open for appeals?|file (?:your )?appeal|appeal (?:window|now|today)|deadline|last day|file by|apply now|still open|window is open|closes?\s+\w+\s+\d)\b/i;

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isOfficialSourceUrl(url: string | null | undefined): boolean {
  if (!isNonEmpty(url)) return false;
  try {
    return OFFICIAL_SOURCE_HOSTS.has(new URL(url).host.toLowerCase());
  } catch {
    return false;
  }
}

export function captionMentionsDeadlineDate(caption: string): boolean {
  return DEADLINE_DATE_RE.test(caption);
}

function captionMentionsTownship(caption: string, township: string): boolean {
  const name = township.trim();
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(caption);
}

/** A deadline post is "date-specific" if it names a date or carries verified rows. */
function isDateSpecific(input: OtDeadlinePostInput): boolean {
  return captionMentionsDeadlineDate(input.caption) || input.verified_deadlines.length > 0;
}

function ageMs(iso: string, now: Date): number {
  const checked = new Date(iso).getTime();
  if (!Number.isFinite(checked)) return Number.POSITIVE_INFINITY;
  return now.getTime() - checked;
}

function earliestDeadlineExpiryMs(input: OtDeadlinePostInput): number | null {
  const openRows = input.verified_deadlines.filter((d) => d.status === "open" || d.status === "closing_soon");
  let earliest: number | null = null;
  for (const row of openRows) {
    // End of the deadline day — approval can't outlive the window it advertises.
    const end = new Date(`${row.deadline_date}T23:59:59.999Z`).getTime();
    if (Number.isFinite(end)) earliest = earliest == null ? end : Math.min(earliest, end);
  }
  return earliest;
}

/**
 * Compute the approval expiry: short by design. Same-day for date-specific copy,
 * otherwise a 7-day ceiling, and never past the soonest advertised deadline.
 */
function computeExpiresAt(input: OtDeadlinePostInput): string | null {
  if (!isNonEmpty(input.source_checked_at)) return null;
  const base = new Date(input.source_checked_at).getTime();
  if (!Number.isFinite(base)) return null;
  const window = isDateSpecific(input) ? SAME_DAY_MAX_AGE_MS : MAX_APPROVAL_WINDOW_MS;
  let expires = base + Math.min(window, MAX_APPROVAL_WINDOW_MS);
  const deadlineCap = earliestDeadlineExpiryMs(input);
  if (deadlineCap != null) expires = Math.min(expires, deadlineCap);
  return new Date(expires).toISOString();
}

function closedTownshipPresentedAsOpen(input: OtDeadlinePostInput): string[] {
  const offenders = new Set<string>();
  // 1. A closed township named anywhere in the deadline caption is fail-closed.
  for (const township of input.closed_townships_mentioned) {
    if (captionMentionsTownship(input.caption, township)) offenders.add(township);
  }
  // 2. Contradiction: a flagged-closed township carrying an "open" verified row.
  const closed = new Set(input.closed_townships_mentioned.map((t) => t.trim().toLowerCase()));
  for (const row of input.verified_deadlines) {
    if (closed.has(row.township.trim().toLowerCase()) && row.status !== "closed") {
      offenders.add(row.township);
    }
  }
  return [...offenders];
}

/**
 * Derive the source-verification status. Precedence: missing → blocked → stale →
 * cleared. Reasons accumulate for display.
 */
export function evaluateOtDeadlinePost(
  input: OtDeadlinePostInput,
  options: EvaluateOptions = {},
): ApprovalDecision {
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const expires_at = computeExpiresAt(input);

  // Non-OT posts are out of scope: deadline verification does not apply to them.
  if (input.brand !== "ot") {
    return {
      applies: false,
      source_verification_status: "missing",
      approval_ready: false,
      post_allowed: false,
      expires_at,
      reasons: ["Not an OT deadline post — OT source-verification rules do not apply."],
    };
  }

  let status: SourceVerificationStatus;

  const hasSource = isNonEmpty(input.source_url) && isNonEmpty(input.source_name) && isNonEmpty(input.source_checked_at);
  const dateSpecific = isDateSpecific(input);
  const closedOffenders = closedTownshipPresentedAsOpen(input);

  if (!hasSource) {
    status = "missing";
    if (!isNonEmpty(input.source_url)) reasons.push("Missing source URL — cannot verify deadline claims.");
    if (!isNonEmpty(input.source_name)) reasons.push("Missing source name.");
    if (!isNonEmpty(input.source_checked_at)) reasons.push("Missing source_checked_at timestamp.");
  } else if (!isOfficialSourceUrl(input.source_url)) {
    status = "blocked";
    reasons.push("Source URL is not an approved official Cook County source.");
  } else if (dateSpecific && input.verified_deadlines.length === 0) {
    status = "blocked";
    reasons.push("Caption cites deadline dates but has no verified_deadlines rows.");
  } else if (closedOffenders.length > 0) {
    status = "blocked";
    reasons.push(`Closed township(s) presented as open: ${closedOffenders.join(", ")}.`);
  } else if (dateSpecific && ageMs(input.source_checked_at as string, now) > SAME_DAY_MAX_AGE_MS) {
    status = "stale";
    reasons.push("Source check is not same-day; date-specific deadline copy must be re-verified today.");
  } else if (!dateSpecific && ageMs(input.source_checked_at as string, now) > MAX_APPROVAL_WINDOW_MS) {
    status = "stale";
    reasons.push("Source check is older than the 7-day approval window.");
  } else {
    status = "cleared";
  }

  const expired = expires_at != null && now.getTime() > new Date(expires_at).getTime();
  if (expired && status === "cleared") reasons.push("Approval window has expired; re-verify before approving.");

  const approval_ready = status === "cleared" && !expired;

  return {
    applies: true,
    source_verification_status: status,
    approval_ready,
    post_allowed: false,
    expires_at,
    reasons,
  };
}

/**
 * Build the full internal approval card. Computed fields are always recomputed
 * from the raw input — any caller-supplied verification status, expiry,
 * `public_action_status`, or `post_allowed` is ignored. `post_allowed` is
 * pinned to `false`.
 */
export function buildOtDeadlineApprovalCard(
  input: OtDeadlinePostInput,
  options: EvaluateOptions = {},
): OtDeadlineApprovalCard {
  const decision = evaluateOtDeadlinePost(input, options);
  const public_action_status: PublicActionStatus = decision.approval_ready ? "approved_only" : "held";
  return {
    ...input,
    source_verification_status: decision.source_verification_status,
    expires_at: decision.expires_at,
    public_action_status,
    approval_required: true,
    post_allowed: false,
  };
}

/**
 * Platform-scoped approval check. Returns true ONLY when the card is
 * `approved_only` and `platform` is inside `platform_scope`. Facebook approval
 * therefore never implies Instagram, Buffer, or boosting — and even then this
 * signals "human-approved for that surface", NOT permission to post
 * (`post_allowed` stays false).
 */
export function isApprovedForPlatform(card: OtDeadlineApprovalCard, platform: string): boolean {
  return (
    card.public_action_status === "approved_only" &&
    card.post_allowed === false &&
    Array.isArray(card.platform_scope) &&
    card.platform_scope.some((p) => p.trim().toLowerCase() === platform.trim().toLowerCase())
  );
}

/**
 * Example card from Rex's same-day source check on 2026-07-09 against the
 * official Assessor calendar. Six open townships are verified; three townships
 * confirmed closed are flagged so the copy can't present them as open. The clean
 * caption names only the open townships, so this evaluates to `cleared` when
 * checked on 2026-07-09.
 */
export const EXAMPLE_OT_DEADLINE_POST: OtDeadlinePostInput = {
  brand: "ot",
  content_id: "ot-deadline-2026-07-09-cook-county",
  platform_scope: ["facebook"],
  asset_path: "public/social/ot/cook-county-appeal-windows-2026-07.png",
  caption:
    "Cook County appeal windows are open now. File by these last dates: Lakeview Jul 13, Palos Jul 17, " +
    "Maine Jul 21, Cicero Jul 31, Elk Grove Aug 4, Stickney Aug 12. Confirm your township on the official " +
    "Assessor calendar before you file.",
  source_url: ASSESSOR_CALENDAR_URL,
  source_name: "Cook County Assessor — Assessment & Appeal Calendar",
  source_checked_at: "2026-07-09T14:00:00.000Z",
  source_last_updated_marker: "Assessor calendar as viewed 2026-07-09",
  verified_deadlines: [
    { township: "Lakeview", deadline_date: "2026-07-13", status: "open" },
    { township: "Palos", deadline_date: "2026-07-17", status: "open" },
    { township: "Maine", deadline_date: "2026-07-21", status: "open" },
    { township: "Cicero", deadline_date: "2026-07-31", status: "open" },
    { township: "Elk Grove", deadline_date: "2026-08-04", status: "open" },
    { township: "Stickney", deadline_date: "2026-08-12", status: "open" },
  ],
  closed_townships_mentioned: ["Oak Park", "Riverside", "Berwyn"],
};

export { ASSESSOR_CALENDAR_URL };
