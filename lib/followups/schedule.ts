import { getOfficial2026Deadline } from "@/lib/appeals/township-deadlines";

const DAY = 86_400_000;

export type FollowupStep = {
  step: "RESULT" | "DAY_1" | "DAY_3" | "FINAL" | "SMS_REMINDER";
  channel: "EMAIL" | "SMS";
  scheduledFor: Date;
};

export function buildFollowupSchedule(args: {
  subscriberId: string;
  township?: string | null;
  smsConsented: boolean;
  now?: Date;
}): Array<FollowupStep & { idempotencyKey: string }> {
  const now = args.now ?? new Date();
  const steps: FollowupStep[] = [
    { step: "RESULT", channel: "EMAIL", scheduledFor: now },
    { step: "DAY_1", channel: "EMAIL", scheduledFor: new Date(now.getTime() + DAY) },
    { step: "DAY_3", channel: "EMAIL", scheduledFor: new Date(now.getTime() + 3 * DAY) },
  ];

  const deadline = getOfficial2026Deadline(args.township ?? null);
  if (deadline) {
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
