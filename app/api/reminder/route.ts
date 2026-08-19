/**
 * /api/reminder — neutral subscription-intent capture for deadline reminders.
 *
 * PREVIEW STUB. There is no CRM, no list, and no persistence behind this
 * endpoint: it logs a coarse record and returns. That was already true, and it
 * was already documented here — but the only thing it told a caller was
 * `{ ok: true }`, and both calling surfaces read that as success and rendered
 * "You're set. We'll email you…". A stub that discards the address is not a
 * failure the caller can see, which is the worst shape for one to have.
 *
 * The response now states what actually happened in fields a client can branch
 * on: `stored` is false because nothing was written, and `scheduled` is false
 * because no schedule exists — there is no verified window to build one from,
 * and `lib/followups/schedule.ts` will not build one without it. A surface that
 * wants to promise mail has to look at those and find them false.
 *
 * The township slug is validated against the canonical roster so a capture
 * cannot be filed under a name the county does not use. It remains
 * informational: it records what the reader asked about and establishes
 * nothing about which township a property files in.
 */
import { NextResponse } from "next/server";
import { TOWNSHIPS_BY_SLUG } from "@/lib/townships";

export interface ReminderCaptureResponse {
  ok: boolean;
  /** Whether the address was persisted anywhere. Always false in the stub. */
  stored: boolean;
  /** Whether any dated reminder was scheduled. Always false: none can be. */
  scheduled: boolean;
  reason: string;
}

export async function POST(req: Request) {
  let body: { email?: string; townshipSlug?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* tolerate empty body in preview */
  }

  const email = (body.email || "").trim();
  const townshipSlug = (body.townshipSlug || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json<ReminderCaptureResponse>(
      {
        ok: false,
        stored: false,
        scheduled: false,
        reason: "invalid_email",
      },
      { status: 400 },
    );
  }

  if (townshipSlug && !TOWNSHIPS_BY_SLUG[townshipSlug]) {
    return NextResponse.json<ReminderCaptureResponse>(
      {
        ok: false,
        stored: false,
        scheduled: false,
        reason: "unknown_township_slug",
      },
      { status: 400 },
    );
  }

  // eslint-disable-next-line no-console
  console.log("[api/reminder][preview] capture:", {
    emailDomain: email.split("@")[1] || "(none)",
    townshipSlug: townshipSlug || "(none)",
  });

  return NextResponse.json<ReminderCaptureResponse>({
    ok: true,
    stored: false,
    scheduled: false,
    reason: "preview_stub_no_persistence",
  });
}
