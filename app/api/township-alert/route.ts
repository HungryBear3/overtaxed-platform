import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { sendEmail } from "@/lib/email/send"

// Valid townships — must match the names used in the /townships page
const VALID_TOWNSHIPS = new Set([
  "Bloom", "Bremen", "Calumet", "Rich", "Thornton", "Worth",
  "Lemont", "Lyons", "Orland", "Palos", "Stickney",
  "Barrington", "Elk Grove", "Evanston", "Maine", "Niles",
  "New Trier", "Northfield", "Palatine", "Wheeling",
  "Chicago (City)",
  "Berwyn", "Hanover", "Oak Park", "River Forest", "Schaumburg",
  // Waitlist sentinel — used by Board of Review waitlist form
  "Board of Review Waitlist",
  // Free check result signup when township unknown or user just wants reminders
  "Free Check",
])

function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254)
}

function sanitizeTownship(township: string): string {
  return township.trim().slice(0, 100)
}

export async function POST(req: NextRequest) {
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

    // Validate township
    if (!township || !VALID_TOWNSHIPS.has(township)) {
      return NextResponse.json({ error: "Please select a valid township." }, { status: 400 })
    }

    // Upsert — one subscription per email+township. Restore if previously unsubscribed.
    await prisma.townshipAlert.upsert({
      where: { email_township: { email, township } },
      create: { email, township },
      update: { unsubscribedAt: null },
    })

    // Send confirmation email
    await sendEmail({
      to: email,
      subject: `You're on the list — ${township} Township appeal deadline`,
      text: [
        `You're all set.`,
        ``,
        `We'll email you when the ${township} Township appeal window opens — and again 7 days before it closes.`,
        ``,
        `In the meantime, you can learn more about the Cook County appeal process at:`,
        `https://www.overtaxed-il.com/townships`,
        ``,
        `— The OverTaxed IL Team`,
        ``,
        `To unsubscribe, reply to this email or visit https://www.overtaxed-il.com`,
      ].join("\n"),
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1f2937;">
          <p style="font-size:18px;font-weight:700;color:#1e40af;margin-bottom:8px;">You're on the list.</p>
          <p>We'll email you when the <strong>${township} Township</strong> appeal window opens — and again 7 days before it closes.</p>
          <p>In the meantime, check the full township deadline calendar:</p>
          <p>
            <a href="https://www.overtaxed-il.com/townships" style="color:#2563eb;">
              overtaxed-il.com/townships →
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
