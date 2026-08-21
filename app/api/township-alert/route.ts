/**
 * /api/township-alert — neutral subscription capture for township alerts.
 *
 * Two things were wrong here and both were in what the endpoint promised
 * rather than what it stored.
 *
 * The accepted-township list was hand-typed and had drifted from the roster in
 * both directions: it rejected eleven real Cook County assessment townships
 * (Proviso, Riverside, Leyden, Norwood Park, and all eight Chicago townships)
 * while accepting `"Chicago (City)"`, which is a display grouping on the
 * deadlines page and not a township anyone files in. A subscription keyed to a
 * name the county does not use cannot be matched to a window later. The list is
 * now derived from the canonical roster, with the two non-township sentinels
 * kept separate and named as such so they cannot be mistaken for county
 * identities.
 *
 * The confirmation email promised a schedule — mail "when the window opens" and
 * "again 7 days before it closes" — computed against a date this system does
 * not have. `app/api/cron/township-alerts/route.ts` has been retired and sends
 * nothing at all, so that sentence described a delivery that could not happen
 * and, worse, gave a homeowner a reason to stop watching their own deadline.
 * The confirmation now records the request and points at the county's calendar,
 * which is the thing that can actually answer them today.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { sendEmail } from "@/lib/email/send"
import { TOWNSHIPS } from "@/lib/townships"
import {
  hostFromRequest,
  isPreviewStubEnabled,
  marketingGateReason,
  previewNoopResponseBody,
} from "@/lib/marketing/preview-gate"

/**
 * Non-township capture buckets. These are product surfaces, not county
 * identities, and are held apart from the roster so a later reader cannot take
 * a stored `township` of `"HOA Waitlist"` for a place with a filing window.
 *
 * The "Board of Review Waitlist" sentinel is deliberately absent: the BOR
 * product is held, and accepting waitlist enrolment for it induces homeowners
 * to defer on a live statutory deadline (BL-A7).
 */
const NON_TOWNSHIP_BUCKETS = new Set([
  // HOA / condo association waitlist — homepage HOA section
  "HOA Waitlist",
  // Free check result signup when township unknown or user just wants reminders
  "Free Check",
])

const ROSTER_TOWNSHIP_NAMES = new Set(TOWNSHIPS.map((t) => t.name))

function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254)
}

function sanitizeTownship(township: string): string {
  return township.trim().slice(0, 100)
}

export async function POST(req: NextRequest) {
  // Preview/dev/test: no DB upsert, no email, no drip, no follow-up.
  const host = hostFromRequest(req)
  if (isPreviewStubEnabled({ host })) {
    return NextResponse.json(previewNoopResponseBody(marketingGateReason({ host })))
  }

  try {
    const body = await req.json()
    const rawEmail = typeof body.email === "string" ? body.email : ""
    const rawTownship = typeof body.township === "string" ? body.township : ""
    const email = sanitizeEmail(rawEmail)
    const township = sanitizeTownship(rawTownship)

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 })
    }

    // Validate township against the canonical roster. A self-selected name is
    // informational only — it records who to write to, and it does not and
    // cannot establish which township a property files in. That is decided from
    // the county's own record for a PIN, at the eligibility boundary, not here.
    const isRosterTownship = ROSTER_TOWNSHIP_NAMES.has(township)
    if (!township || !(isRosterTownship || NON_TOWNSHIP_BUCKETS.has(township))) {
      return NextResponse.json({ error: "Please select a valid township." }, { status: 400 })
    }

    // Upsert — one subscription per email+township. Restore if previously unsubscribed.
    await prisma.townshipAlert.upsert({
      where: { email_township: { email, township } },
      create: { email, township },
      update: { unsubscribedAt: null },
    })

    // Confirmation copy states what we recorded and names no schedule. It
    // carries no date, no countdown, and no "we'll tell you in time" — because
    // the only honest thing this endpoint knows at capture time is that the
    // address was stored, and the only place that can answer "when is my
    // deadline" today is the county.
    const subjectLabel = isRosterTownship ? `${township} Township` : township
    await sendEmail({
      to: email,
      subject: `We've recorded your request — ${subjectLabel}`,
      text: [
        `We've recorded your request for ${subjectLabel} appeal updates.`,
        ``,
        `We are not sending you a filing deadline in this email, and you should not wait for one from us.`,
        `Cook County publishes and revises appeal dates through the year, and they vary by township.`,
        `Confirm your own filing deadline with the county before you file:`,
        `https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines`,
        ``,
        `— The OverTaxed IL Team`,
        ``,
        `To unsubscribe, reply to this email or visit https://www.overtaxed-il.com`,
      ].join("\n"),
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1f2937;">
          <p style="font-size:18px;font-weight:700;color:#1e40af;margin-bottom:8px;">We've recorded your request.</p>
          <p>You asked to hear from us about <strong>${subjectLabel}</strong> property tax appeals.</p>
          <p>We are not sending you a filing deadline in this email, and you should not wait for one from us. Cook County publishes and revises appeal dates through the year, and they vary by township. Confirm your own filing deadline with the county:</p>
          <p>
            <a href="https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines" style="color:#2563eb;">
              Cook County Assessor calendar →
            </a>
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
          <p style="font-size:12px;color:#9ca3af;">
            OverTaxed IL · 1028 W Leland Ave, Chicago IL 60640<br/>
            To unsubscribe, reply to this email.
          </p>
        </div>
      `,
    })

    // Legacy drip and same-day free-check marketing are intentionally not
    // enrolled here. The consent-based /api/followups/enroll flow is the only
    // supported path for the new sequence.

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[township-alert] POST error:", error)
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
}

// Unsubscribe via GET — linked from emails
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url))
  }
  try {
    await prisma.townshipAlert.update({
      where: { unsubscribeToken: token },
      data: { unsubscribedAt: new Date() },
    })
    return NextResponse.redirect(new URL("/?unsubscribed=1", req.url))
  } catch {
    return NextResponse.redirect(new URL("/", req.url))
  }
}
