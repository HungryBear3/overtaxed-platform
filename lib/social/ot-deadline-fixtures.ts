/**
 * OverTaxed IL — internal, read-only loader + presenter for OT deadline
 * approval cards (see lib/social/ot-deadline-approval.ts).
 *
 * This layer exists only to DISPLAY cards on an internal admin surface. It is
 * pure data + pure functions:
 *   - No network I/O, no Buffer/Facebook/Instagram, no public upload.
 *   - No secrets/tokens.
 *   - It never produces a posting action and never sets post_allowed to true —
 *     it reads whatever buildOtDeadlineApprovalCard() computed (always false).
 *   - It never infers township dates; verified_deadlines come from the fixture,
 *     which mirrors a human same-day source check.
 *
 * The fixtures are illustrative demo data, not a live queue.
 */

import fixtureFile from "@/data/social/ot-deadline-cards.example.json";
import {
  buildOtDeadlineApprovalCard,
  evaluateOtDeadlinePost,
  isApprovedForPlatform,
  type OtDeadlinePostInput,
  type OtDeadlineApprovalCard,
  type ApprovalDecision,
  type SourceVerificationStatus,
} from "@/lib/social/ot-deadline-approval";

type BadgeTone = "green" | "red" | "amber" | "gray";

export interface OtDeadlineDisplayRow {
  content_id: string;
  brand: string;
  platform_scope: string[];
  source_name: string | null;
  source_url: string | null;
  source_checked_at: string | null;
  source_last_updated_marker: string | null;
  source_verification_status: SourceVerificationStatus;
  badge: { label: string; tone: BadgeTone };
  expires_at: string | null;
  public_action_status: OtDeadlineApprovalCard["public_action_status"];
  /** Platforms the card is human-approved for (subset of platform_scope). */
  approved_platforms: string[];
  verified_deadlines: OtDeadlineApprovalCard["verified_deadlines"];
  closed_townships_mentioned: string[];
  reasons: string[];
  /** Always false — surfaced so the UI can show it, never to enable posting. */
  post_allowed: false;
  approval_required: true;
}

export interface LoadedOtDeadlineCard {
  card: OtDeadlineApprovalCard;
  decision: ApprovalDecision;
  row: OtDeadlineDisplayRow;
}

interface FixtureFileShape {
  reference_now?: string;
  cards: OtDeadlinePostInput[];
}

const BADGE_BY_STATUS: Record<SourceVerificationStatus, { label: string; tone: BadgeTone }> = {
  cleared: { label: "Source verified", tone: "green" },
  blocked: { label: "Blocked", tone: "red" },
  stale: { label: "Stale — re-verify", tone: "amber" },
  missing: { label: "Source missing", tone: "gray" },
};

/** Reference clock for the demo fixtures, so statuses are deterministic. */
export function getFixtureReferenceNow(): Date {
  const file = fixtureFile as FixtureFileShape;
  const parsed = file.reference_now ? new Date(file.reference_now) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

/** Read-only projection to display-safe fields. Never emits a post affordance. */
export function toDisplayRow(card: OtDeadlineApprovalCard, decision: ApprovalDecision): OtDeadlineDisplayRow {
  const approved_platforms = card.platform_scope.filter((platform) => isApprovedForPlatform(card, platform));
  return {
    content_id: card.content_id,
    brand: card.brand,
    platform_scope: card.platform_scope,
    source_name: card.source_name,
    source_url: card.source_url,
    source_checked_at: card.source_checked_at,
    source_last_updated_marker: card.source_last_updated_marker,
    source_verification_status: card.source_verification_status,
    badge: BADGE_BY_STATUS[card.source_verification_status],
    expires_at: card.expires_at,
    public_action_status: card.public_action_status,
    approved_platforms,
    verified_deadlines: card.verified_deadlines,
    closed_townships_mentioned: card.closed_townships_mentioned,
    reasons: decision.reasons,
    post_allowed: false,
    approval_required: true,
  };
}

/**
 * Load the demo fixtures and compute each card's verification state.
 * `now` defaults to the fixture reference clock so the internal demo is stable.
 */
export function loadOtDeadlineApprovalCards(now: Date = getFixtureReferenceNow()): LoadedOtDeadlineCard[] {
  const file = fixtureFile as FixtureFileShape;
  const cards = Array.isArray(file.cards) ? file.cards : [];
  return cards.map((input) => {
    const card = buildOtDeadlineApprovalCard(input, { now });
    const decision = evaluateOtDeadlinePost(input, { now });
    return { card, decision, row: toDisplayRow(card, decision) };
  });
}
