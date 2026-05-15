// POST /api/outreach/webhooks/resend
// Ingests Resend events for the OT condo outreach campaign.
// Isolated from the Stripe webhook and the transactional email path.

import { NextResponse } from "next/server"

import {
  extractProviderEventId,
  ingestResendEvent,
  getOutreachWebhookSecret,
  shouldRequireOutreachWebhookSecret,
  verifyResendSignature,
  type ResendEventEnvelope,
} from "@/lib/outreach/webhooks"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const rawBody = await request.text()

  const secret = getOutreachWebhookSecret()
  if (!secret && shouldRequireOutreachWebhookSecret()) {
    console.error("[outreach/webhook] OUTREACH_RESEND_WEBHOOK_SECRET is not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  const verificationHeaders = {
    "resend-signature": request.headers.get("resend-signature"),
    "svix-id": request.headers.get("svix-id"),
    "svix-signature": request.headers.get("svix-signature"),
    "svix-timestamp": request.headers.get("svix-timestamp"),
    "webhook-id": request.headers.get("webhook-id"),
    "webhook-signature": request.headers.get("webhook-signature"),
    "webhook-timestamp": request.headers.get("webhook-timestamp"),
  }

  if (!verifyResendSignature(rawBody, verificationHeaders, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let event: ResendEventEnvelope
  try {
    event = JSON.parse(rawBody) as ResendEventEnvelope
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!event?.type || !event?.data) {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 })
  }

  const providerEventId = extractProviderEventId(event, rawBody)

  try {
    const result = await ingestResendEvent({ providerEventId, event })
    return NextResponse.json({
      received: true,
      duplicate: result.duplicate,
      suppressed: result.suppressed,
      campaignHalted: result.campaignHalted,
    })
  } catch (err) {
    console.error("[outreach/webhook] ingest failed:", err)
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 })
  }
}
