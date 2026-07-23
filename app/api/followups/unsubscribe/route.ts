import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

async function suppress(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    const subscriber = await prisma.freeCheckFollowupSubscriber.findUnique({ where: { unsubscribeToken: token } });
    if (subscriber) {
      const now = new Date();
      await prisma.$transaction([
        prisma.freeCheckFollowupSubscriber.update({
          where: { id: subscriber.id },
          data: { emailSuppressedAt: now },
        }),
        prisma.freeCheckFollowupMessage.updateMany({
          where: { subscriberId: subscriber.id, channel: "EMAIL", sentAt: null },
          data: { status: "CANCELLED", failureCode: "unsubscribed" },
        }),
      ]);
    }
  }
  return NextResponse.redirect(new URL("/?unsubscribed=1", req.url), 303);
}

export const GET = suppress;
export const POST = suppress;
