// GET /api/auth/email-status - Check if SMTP is configured (for debugging verification emails)
import { NextResponse } from "next/server"
import { isEmailConfigured } from "@/lib/email/config"

export async function GET() {
  return NextResponse.json({ smtpConfigured: isEmailConfigured() })
}
