import { dateKey } from "@/lib/checkout/ot-contract";
import type { DeadlineProjection } from "@/lib/deadlines/official-source-state";

const DAY = 86_400_000;

export type FollowupStep = {
  step: "RESULT" | "DAY_1" | "DAY_3" | "FINAL" | "SMS_REMINDER";
  channel: "EMAIL" | "SMS";
  scheduledFor: Date;
};

/**
 * Plan a follow-up sequence for one free-check subscriber.
 *
 * The deadline-anchored steps — FINAL and its SMS twin — are the only ones that
 * depend on a date, and they are scheduled from a projection the caller
 * supplies rather than from a township lookup performed here. That inversion is
 * deliberate: only the caller knows whether the township was established by an
 * official property record or merely typed in, and a reminder addressed to a
 * homeowner is an eligibility claim. Passing no projection, or an unavailable
 * one, yields a sequence with no deadline steps at all.
 *
 * Scheduling is not authorization to send. The delivery path re-evaluates the
 * canonical state immediately before each send, because a window verified today
 * can go stale before a reminder queued for next week fires.
 */
export function buildFollowupSchedule(args: {
  subscriberId: string;
  smsConsented: boolean;
  deadline?: DeadlineProjection | null;
  /**
   * Accepted and deliberately unused.
   *
   * Callers used to pass a township *name* here and this function looked its
   * deadline up. That is the defect, not an ergonomic detail: a name is not
   * proof of where a subscriber's property sits, so a schedule built from one
   * is an eligibility claim nobody established. The parameter stays in the
   * signature so existing callers keep compiling and get the fail-closed
   * behaviour — no `deadline`, therefore no deadline-anchored steps — instead of
   * silently binding to a positional argument that now means something else.
   *
   * To schedule a FINAL reminder, pass `deadline` from a projection built on an
   * official property record.
   */
  township?: string | null;
  now?: Date;
}): Array<FollowupStep & { idempotencyKey: string }> {
  const now = args.now ?? new Date();
  const steps: FollowupStep[] = [
    { step: "RESULT", channel: "EMAIL", scheduledFor: now },
    { step: "DAY_1", channel: "EMAIL", scheduledFor: new Date(now.getTime() + DAY) },
    { step: "DAY_3", channel: "EMAIL", scheduledFor: new Date(now.getTime() + 3 * DAY) },
  ];

  const deadline = args.deadline;
  if (deadline?.available && deadline.allowDeadlineEmail) {
    const closes = new Date(`${deadline.lastFileDate}T23:59:59-05:00`);
    const finalAt = new Date(closes.getTime() - 2 * DAY);
    if (closes > now && finalAt > new Date(now.getTime() + 4 * 60 * 60 * 1000)) {
      steps.push({ step: "FINAL", channel: "EMAIL", scheduledFor: finalAt });
      if (args.smsConsented) {
        steps.push({ step: "SMS_REMINDER", channel: "SMS", scheduledFor: finalAt });
      }
    }
  }

  return steps.map((item) => ({
    ...item,
    idempotencyKey: `${args.subscriberId}:${item.channel}:${item.step}`,
  }));
}

/* ── Deadline reminder delivery ───────────────────────────────────────────── */

/**
 * Why a persisted appeal deadline produced no reminder.
 *
 * Every value here is a refusal. There is no "sent anyway" reason, because the
 * question this type answers is only ever asked immediately before a send.
 */
export type DeadlineReminderRefusal =
  | "state_unavailable"
  | "identity_not_official"
  | "window_not_open"
  | "capabilities_denied"
  | "no_countdown"
  | "outside_reminder_schedule"
  | "persisted_deadline_missing"
  | "persisted_deadline_mismatch";

export type DeadlineReminderDecision =
  | { send: false; reason: DeadlineReminderRefusal }
  | {
      send: true;
      /** The canonical last filing day. Never the persisted column. */
      lastFileDate: string;
      /** Computed by the projection at render time. Never a local subtraction. */
      daysRemaining: number;
      townshipName: string;
      officialSourceUrl: string;
      retrievedAt: string;
    };

/** The only countdowns that produce mail. */
export const DEADLINE_REMINDER_DAYS: readonly number[] = [7, 3, 1];

/**
 * Decide whether one persisted appeal deadline may become a reminder email.
 *
 * The defect this closes: the delivery cron read `appeal.filingDeadline` — a
 * value a customer typed into a form, or that we derived as "notice date + 30
 * days" — formatted it as a date, subtracted it from today to make a
 * countdown, and mailed both. Nothing in that path consulted the canonical
 * state, so the one product that refuses to publish a deadline anywhere on the
 * site was mailing one to named homeowners every morning.
 *
 * The persisted date is now demoted from authority to *assertion*. It has
 * exactly one job left: it must agree with the canonical last filing day. If it
 * disagrees, the row is a parity mismatch and produces nothing — we do not
 * quietly correct a customer's record from a cron, and we do not mail a date
 * they never saw.
 *
 * Both the date and the countdown in the returned decision come from the
 * projection. A caller that wants either has to take both, from here, or take
 * neither.
 */
export function decideDeadlineReminder(args: {
  projection: DeadlineProjection | null | undefined;
  persistedDeadline: Date | string | null | undefined;
}): DeadlineReminderDecision {
  const projection = args.projection;

  if (!projection || !projection.available) {
    return { send: false, reason: "state_unavailable" };
  }

  // A township established by name or slug is not proof of whose property this
  // is. A reminder addressed to one homeowner is an eligibility claim.
  if (!projection.eligible) {
    return { send: false, reason: "identity_not_official" };
  }

  if (projection.status !== "open") {
    return { send: false, reason: "window_not_open" };
  }

  // Read together or not at all. A message carrying a date and a countdown
  // needs both capabilities plus the email permission; asking for them
  // separately is how a surface ends up suppressing one and keeping the other.
  if (
    !projection.showDates ||
    !projection.showCountdown ||
    !projection.allowDeadlineEmail ||
    !projection.allowDeadlineCta
  ) {
    return { send: false, reason: "capabilities_denied" };
  }

  const daysRemaining = projection.daysRemaining;
  if (daysRemaining === null) {
    return { send: false, reason: "no_countdown" };
  }
  if (!DEADLINE_REMINDER_DAYS.includes(daysRemaining)) {
    return { send: false, reason: "outside_reminder_schedule" };
  }

  const persisted = dateKey(args.persistedDeadline);
  if (!persisted) {
    return { send: false, reason: "persisted_deadline_missing" };
  }
  if (persisted !== projection.lastFileDate) {
    return { send: false, reason: "persisted_deadline_mismatch" };
  }

  return {
    send: true,
    lastFileDate: projection.lastFileDate,
    daysRemaining,
    townshipName: projection.townshipName,
    officialSourceUrl: projection.officialSourceUrl,
    retrievedAt: projection.retrievedAt,
  };
}
