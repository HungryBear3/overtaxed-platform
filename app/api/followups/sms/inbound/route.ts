import { NextRequest, NextResponse } from "next/server";
import { parseSmsKeyword } from "@/lib/followups/sms";

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.OT_SMS_WEBHOOK_SECRET;
  const suppliedSecret = req.headers.get("x-ot-sms-webhook-secret");
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Provider integration is intentionally absent. Parsing is implemented and
  // tested, but consent cannot be mutated until an approved provider supplies
  // a verified phone identity and signature contract.
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ status: "provider_not_configured", keyword: parseSmsKeyword(body.message) }, { status: 503 });
}
