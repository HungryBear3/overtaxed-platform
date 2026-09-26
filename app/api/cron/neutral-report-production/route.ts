import { NextRequest, NextResponse } from "next/server";
import { sweepNeutralReportGeneration } from "@/lib/fulfillment-runtime/neutral-generation-recovery";

export const dynamic = "force-dynamic";
// Kept in step with NEUTRAL_GENERATION_MAX_DURATION_SECONDS; Next.js route
// segment config must be a static literal, so it cannot be imported.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sweepNeutralReportGeneration();
  return NextResponse.json({ ok: true, ...result });
}
