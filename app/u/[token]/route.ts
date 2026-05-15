// GET/POST /u/[token]
// One-click unsubscribe endpoint. Required by Gmail/Yahoo bulk-sender rules
// when paired with `List-Unsubscribe` + `List-Unsubscribe-Post` headers.
//
// Behavior:
//   - Valid token: insert suppression (ONE_CLICK_UNSUB) and render safe success.
//   - Invalid/expired token: render a friendly "could not process" page,
//     never 500.

import { NextResponse } from "next/server"

import { addSuppression } from "@/lib/outreach/suppression"
import { verifyUnsubscribeToken } from "@/lib/outreach/unsubscribe"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function successHtml(email: string): string {
  const safeEmail = email.replace(/[<>&"']/g, "")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unsubscribed · OverTaxed IL</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1f2937;line-height:1.5}h1{color:#1d4ed8;margin-bottom:12px}.card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-top:20px}</style>
</head><body>
<h1>You're unsubscribed</h1>
<p>We've removed <strong>${safeEmail}</strong> from our outreach list. You will not receive further messages from this campaign.</p>
<div class="card"><p style="margin:0">If you unsubscribed by mistake or have questions, reply to any previous message or email <a href="mailto:appeals@outreach.overtaxed-il.com">appeals@outreach.overtaxed-il.com</a>.</p></div>
<p style="margin-top:24px;color:#6b7280;font-size:13px">— OverTaxed IL</p>
</body></html>`
}

function invalidHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unsubscribe · OverTaxed IL</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1f2937;line-height:1.5}h1{color:#b45309;margin-bottom:12px}</style>
</head><body>
<h1>We couldn't process this link</h1>
<p>The unsubscribe link is invalid or has expired. To be removed from our list, reply to any message from us with the word <strong>unsubscribe</strong>, or email <a href="mailto:appeals@outreach.overtaxed-il.com">appeals@outreach.overtaxed-il.com</a> and we'll remove you right away.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px">— OverTaxed IL</p>
</body></html>`
}

async function handleUnsubscribe(token: string): Promise<Response> {
  const payload = verifyUnsubscribeToken(token)
  if (!payload) {
    return new Response(invalidHtml(), {
      status: 200, // never 500; 200 keeps providers happy and the user informed
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  try {
    await addSuppression({
      email: payload.email,
      reason: "ONE_CLICK_UNSUB",
      source: "unsubscribe",
      campaignId: payload.campaignId,
      note: "One-click unsubscribe",
    })
  } catch (err) {
    // Still render success to the user — suppression may have already existed
    // and we don't want to bounce a real unsubscribe attempt for any reason.
    console.error("[outreach/unsub] suppression insert failed:", err)
  }

  return new Response(successHtml(payload.email), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  return handleUnsubscribe(token)
}

// POST is required by RFC 8058 one-click unsubscribe — Gmail/Apple will POST here.
export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const res = await handleUnsubscribe(token)
  // MTAs expect a plain 200 with any body; HTML is fine.
  return res
}

// Defensively handle other verbs without 500ing.
export function OPTIONS() {
  return NextResponse.json({ ok: true })
}
