import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/send";
import { followupDeliveryEnabled } from "@/lib/followups/config";
import { buildFollowupEmail } from "@/lib/followups/templates";
import { getOfficial2026Deadline } from "@/lib/appeals/township-deadlines";

export const dynamic = "force-dynamic";
const BATCH_SIZE = 25;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

function deadlineIsOpen(township: string | null, now: Date): boolean {
  const deadline = getOfficial2026Deadline(township);
  if (!deadline) return false;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return today >= deadline.noticeDate && today <= deadline.lastFileDate;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  if (!dryRun && !followupDeliveryEnabled()) {
    return NextResponse.json({ status: "disabled", due: 0, sent: 0, skipped: 0, failed: 0 });
  }

  const now = new Date();
  const due = await prisma.freeCheckFollowupMessage.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now } },
    include: { subscriber: true },
    orderBy: { scheduledFor: "asc" },
    take: BATCH_SIZE,
  });

  const reasons: Record<string, number> = {};
  const count = (reason: string) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  if (dryRun) {
    for (const item of due) {
      if (item.subscriber.emailSuppressedAt) count("email_suppressed");
      else if (item.channel === "SMS" && (!item.subscriber.smsConsentAt || item.subscriber.smsSuppressedAt)) count("sms_suppressed");
      else if (item.step !== "RESULT" && !deadlineIsOpen(item.subscriber.township, now)) count("deadline_not_open");
      else count("eligible");
    }
    return NextResponse.json({ status: "dry_run", due: due.length, reasons });
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const item of due) {
    const claimed = await prisma.freeCheckFollowupMessage.updateMany({
      where: { id: item.id, status: "SCHEDULED" },
      data: {
        status: "PROCESSING",
        leaseUntil: new Date(now.getTime() + 5 * 60_000),
        attempts: { increment: 1 },
        lastAttemptAt: now,
      },
    });
    if (claimed.count !== 1) continue;

    const purchased = await prisma.oTOrder.findFirst({
      where: { email: { equals: item.subscriber.emailNormalized, mode: "insensitive" }, status: { in: ["PAID", "COMPLETED", "FULFILLED"] } },
      select: { id: true },
    });
    let skipReason: string | null = null;
    if (purchased) skipReason = "purchased";
    else if (item.channel === "EMAIL" && item.subscriber.emailSuppressedAt) skipReason = "email_suppressed";
    else if (item.channel === "SMS" && (!item.subscriber.smsConsentAt || item.subscriber.smsSuppressedAt)) skipReason = "sms_suppressed";
    else if (item.step !== "RESULT" && !deadlineIsOpen(item.subscriber.township, now)) skipReason = "deadline_not_open";

    if (skipReason) {
      await prisma.freeCheckFollowupMessage.update({
        where: { id: item.id },
        data: { status: "CANCELLED", failureCode: skipReason, leaseUntil: null },
      });
      skipped++;
      count(skipReason);
      continue;
    }

    if (item.channel === "SMS") {
      await prisma.freeCheckFollowupMessage.update({
        where: { id: item.id },
        data: { status: "FAILED", failureCode: "sms_provider_not_configured", leaseUntil: null },
      });
      failed++;
      count("sms_provider_not_configured");
      continue;
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.overtaxed-il.com";
    const email = buildFollowupEmail({
      step: item.step,
      township: item.subscriber.township,
      address: item.subscriber.propertyAddress,
      resultUrl: new URL(item.subscriber.resultUrl, baseUrl).toString(),
      unsubscribeUrl: `${baseUrl}/api/followups/unsubscribe?token=${encodeURIComponent(item.subscriber.unsubscribeToken)}`,
    });
    const ok = email ? await sendEmail({
      to: item.subscriber.email,
      ...email,
      headers: {
        "List-Unsubscribe": `<${baseUrl}/api/followups/unsubscribe?token=${encodeURIComponent(item.subscriber.unsubscribeToken)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }) : false;
    await prisma.freeCheckFollowupMessage.update({
      where: { id: item.id },
      data: ok
        ? { status: "SENT", sentAt: new Date(), leaseUntil: null, failureCode: null }
        : {
            status: item.attempts + 1 >= 3 ? "FAILED" : "SCHEDULED",
            scheduledFor: new Date(now.getTime() + Math.min(24, 2 ** (item.attempts + 1)) * 60 * 60_000),
            failureCode: "email_send_failed",
            leaseUntil: null,
          },
    });
    if (ok) sent++; else failed++;
  }

  return NextResponse.json({ status: "processed", due: due.length, sent, skipped, failed, reasons });
}
