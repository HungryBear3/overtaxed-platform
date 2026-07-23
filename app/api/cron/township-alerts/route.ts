import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy township-alert delivery used a hard-coded calendar and unsafe
 * marketing copy. It remains scheduled only so operators get an explicit
 * disabled response until it can be rebuilt on the official deadline source.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    status: "disabled",
    reason: "legacy_township_alert_delivery_retired",
    sent: 0,
  });
}
