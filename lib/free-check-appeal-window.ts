import {
  ASSESSOR_CALENDAR_URL,
  describeTownshipCalendar,
  projectTownshipDeadline,
} from "@/lib/appeals/township-deadlines";
import type {
  DeadlineProjection,
  PendingReason,
} from "@/lib/deadlines/official-source-state";
import type { TownshipIdentity } from "@/lib/deadlines/township-resolution";
import { CC_03, CC_04, CC_05, CC_06 } from "@/lib/copy/canonical";
import {
  resolveEligibilityPolicy,
  type EligibilityPolicy,
} from "@/lib/checkout/ot-contract";

/**
 * The free-check view of a township's filing window.
 *
 * This type used to carry a `future_cycle` status, which was returned both when
 * the county had genuinely not opened a window yet and when we simply had no
 * published date for that township. Those are different facts — one is a
 * schedule, the other is our own ignorance — and collapsing them let a missing
 * row render as a reassuring "later this cycle". The status union now says
 * `unknown` for the second case and carries the `pendingReason` that produced
 * it, so a caller can tell "the window is not open yet" from "we could not
 * verify anything".
 */
export type FreeCheckAppealWindowStatus = {
  township: string;
  status: "open" | "closed" | "upcoming" | "unknown";
  openDate: string | null;
  closeDate: string | null;
  filingUrl: string;
  note: string | null;
  /** Why the state is `unknown`, or null when it verified. */
  pendingReason: PendingReason | null;
  /** Never true for a township established by name or slug alone. */
  allowCheckout: boolean;
};

const filingUrl = "https://www.cookcountyassessoril.gov/online-appeals";

function fromProjection(
  fallbackName: string,
  projection: DeadlineProjection,
): FreeCheckAppealWindowStatus {
  if (!projection.available) {
    return {
      township: fallbackName,
      status: "unknown",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: `${projection.notice} Check ${ASSESSOR_CALENDAR_URL} for your township's exact appeal dates.`,
      pendingReason: projection.reason,
      allowCheckout: false,
    };
  }

  return {
    township: projection.townshipName,
    status: projection.status,
    openDate: projection.showDates ? projection.openDate : null,
    closeDate: projection.showDates ? projection.lastFileDate : null,
    filingUrl,
    note: `Verified against the Cook County Assessor calendar, retrieved ${projection.retrievedAt}. Schedules can change — always confirm before filing.`,
    pendingReason: null,
    allowCheckout: projection.allowCheckout,
  };
}

/**
 * Describe a township's window from its name.
 *
 * Informational tier: a name is not proof of where the reader's property sits,
 * so the result can describe dates but never authorizes checkout. Callers
 * holding an official property record should use [[appealWindowForIdentity]].
 */
export function getFreeCheckAppealWindowStatus(
  township: string | null,
  now: Date = new Date(),
): FreeCheckAppealWindowStatus {
  if (!township?.trim()) {
    return {
      township: "Unknown",
      status: "unknown",
      openDate: null,
      closeDate: null,
      filingUrl,
      note: null,
      pendingReason: "township_unresolved",
      allowCheckout: false,
    };
  }
  return fromProjection(
    township,
    describeTownshipCalendar(township, now.toISOString()),
  );
}

/**
 * The same window, for a township established by an official property record.
 *
 * This is the only entry point that can return `allowCheckout: true`, and only
 * when the canonical state verifies against a same-day retrieval and the window
 * is open at the instant of the call.
 */
export function appealWindowForIdentity(
  identity: TownshipIdentity | null,
  now: Date = new Date(),
): FreeCheckAppealWindowStatus {
  return fromProjection(
    identity?.townshipName ?? "Unknown",
    projectTownshipDeadline({ township: identity, at: now.toISOString() }),
  );
}

/* ── Four-state free-check outcome ───────────────────────────────────────── */

/**
 * The free check has exactly four outcomes, and they are CC-03 through CC-06.
 *
 * Before this, the outcome was decided in three unrelated places — a dollar
 * constant named `MEANINGFUL_SAVINGS_THRESHOLD` duplicated across the route, the
 * result component, and the email templates; a `noAssessedValue` boolean; and a
 * savings ladder in JSX — so the same property could be told it had a finding,
 * be shown no figures, and be offered checkout, in one render. There is one
 * evaluation now, and every surface reads its result rather than re-deriving it.
 *
 * Resolution is ordered and fails closed. A state that cannot be established is
 * never resolved downward into a friendlier one.
 */
export type FreeCheckOutcomeCode =
  | "supportive"
  | "not_supportive"
  | "insufficient_evidence"
  | "unsupported_property";

/** Why checkout is closed, or why no conclusion was drawn. For logs and tests. */
export type FreeCheckOutcomeReason =
  | "property_class_unsupported"
  | "multiple_pins"
  | "outside_cook_county"
  | "no_assessed_value"
  | "no_comparables"
  | "no_comparable_level"
  | "window_unverified"
  | "window_not_open"
  | "eligibility_policy_unsigned"
  | "below_evidence_threshold";

export interface FreeCheckEvidence {
  /** Cook County class code for the subject PIN, if the record carried one. */
  propertyClass: string | null;
  /** PINs the subject resolved to. Anything but exactly one is unsupported. */
  pinCount: number | null;
  /** True when the subject is established as a Cook County parcel. */
  inCookCounty: boolean;
  /** Subject assessed total, or null when the record carried none. */
  assessedTotalValue: number | null;
  /** Subject assessment level, percent of market value. */
  equityRatio: number | null;
  /** Assessment level across the accepted comparables, percent. */
  avgCompEquityRatio: number | null;
  /** Accepted comparable count. */
  compCount: number;
}

export interface FreeCheckOutcome {
  code: FreeCheckOutcomeCode;
  /** CC-03…CC-06, byte-exact. Render this, do not compose your own. */
  headline: string;
  /**
   * The only thing any surface may consult before offering to sell a packet.
   * True requires all of: a supportive outcome, a window the canonical state
   * verified as open for an official property record, and a signed policy.
   */
  allowCheckout: boolean;
  /** Null only when `code` is `supportive` and checkout is open. */
  reason: FreeCheckOutcomeReason | null;
  /** Whether any figure may be shown at all. */
  showFigures: boolean;
}

/**
 * Class 2 is Cook County's residential class. The packet is defined for class 2
 * single-PIN residential property at the Assessor stage and nothing else, so
 * anything outside it is CC-06 rather than a check that quietly proceeds.
 */
function isClass2Residential(propertyClass: string | null): boolean {
  if (!propertyClass) return false;
  // The county writes the same class as "2-03", "203", and "0203" depending on
  // the dataset, so compare on digits rather than on formatting.
  const digits = propertyClass.replace(/\D/g, "").replace(/^0+(?=\d{3})/, "");
  return /^2\d{2}$/.test(digits);
}

export function evaluateFreeCheckOutcome(args: {
  window: FreeCheckAppealWindowStatus;
  evidence: FreeCheckEvidence;
  policy?: EligibilityPolicy;
}): FreeCheckOutcome {
  const { window: aw, evidence: e } = args;
  const policy = args.policy ?? resolveEligibilityPolicy();

  const closed = (
    code: FreeCheckOutcomeCode,
    headline: string,
    reason: FreeCheckOutcomeReason,
    showFigures: boolean,
  ): FreeCheckOutcome => ({ code, headline, allowCheckout: false, reason, showFigures });

  // 1. Unsupported property or stage. Strongest statement, so it resolves first:
  //    telling someone their evidence is thin when we do not serve their
  //    property at all sends them to gather more of it for nothing.
  if (!e.inCookCounty) {
    return closed("unsupported_property", CC_06, "outside_cook_county", false);
  }
  if (e.pinCount !== null && e.pinCount !== 1) {
    return closed("unsupported_property", CC_06, "multiple_pins", false);
  }
  if (!isClass2Residential(e.propertyClass)) {
    return closed("unsupported_property", CC_06, "property_class_unsupported", false);
  }

  // 2. Insufficient evidence. Each branch is a fact we do not have, not a fact
  //    that came back unfavourable — the two must not read alike to a homeowner.
  if (e.assessedTotalValue === null || !Number.isFinite(e.assessedTotalValue)) {
    return closed("insufficient_evidence", CC_05, "no_assessed_value", false);
  }
  if (e.compCount < 1) {
    return closed("insufficient_evidence", CC_05, "no_comparables", false);
  }
  if (
    e.equityRatio === null ||
    e.avgCompEquityRatio === null ||
    !Number.isFinite(e.equityRatio) ||
    !Number.isFinite(e.avgCompEquityRatio) ||
    e.avgCompEquityRatio <= 0
  ) {
    return closed("insufficient_evidence", CC_05, "no_comparable_level", false);
  }

  // 3. The merits threshold is OD-3 and OD-3 is unsigned. Without it there is no
  //    rule for what "supportive" means, so no check can resolve to CC-03 or
  //    CC-04 — including one whose figures look decisive. This is the state the
  //    system is in today, and it is deliberate.
  if (!policy.signed) {
    return closed("insufficient_evidence", CC_05, "eligibility_policy_unsigned", true);
  }

  const { minRelativeAssessmentGap, minComparables } = policy.evidenceThreshold;
  if (e.compCount < minComparables) {
    return closed("insufficient_evidence", CC_05, "no_comparables", true);
  }

  const relativeGap = (e.equityRatio - e.avgCompEquityRatio) / e.avgCompEquityRatio;
  if (relativeGap < minRelativeAssessmentGap) {
    return closed("not_supportive", CC_04, "below_evidence_threshold", true);
  }

  // 4. Supportive. Checkout still requires an open, verified window established
  //    from an official property record — the evidence and the window are
  //    separate gates and neither substitutes for the other.
  if (aw.status !== "open") {
    return { code: "supportive", headline: CC_03, allowCheckout: false, reason: "window_not_open", showFigures: true };
  }
  if (!aw.allowCheckout) {
    return { code: "supportive", headline: CC_03, allowCheckout: false, reason: "window_unverified", showFigures: true };
  }
  return { code: "supportive", headline: CC_03, allowCheckout: true, reason: null, showFigures: true };
}
