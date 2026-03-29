import { Resend } from "resend"

if (!process.env.RESEND_API_KEY) {
  console.warn("[resend] RESEND_API_KEY not set – emails disabled")
}

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

export const FROM_EMAIL = "OverTaxed IL <onboarding@resend.dev>"
