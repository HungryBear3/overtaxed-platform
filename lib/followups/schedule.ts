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
