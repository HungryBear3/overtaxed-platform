/**
 * /api/reminder — email capture for deadline reminders.
 *
 * Pass 1 PREVIEW STUB. Real CRM / email-list wiring lands later.
 * - Accepts { email, townshipSlug }.
 * - Logs the capture (without persisting).
 * - Returns { ok: true, preview: true }.
 * - No real backend, no email sent, no CRM write.
 */
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: { email?: string; townshipSlug?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body in preview */
  }
  // eslint-disable-next-line no-console
  console.log("[api/reminder][preview] capture:", {
    emailDomain: (body.email || "").split("@")[1] || "(none)",
    townshipSlug: body.townshipSlug || "(none)",
  });
  return NextResponse.json({ ok: true, preview: true });
}
