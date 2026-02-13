import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sendContactEmail } from "@/lib/email/send"
import { rateLimit, getClientIdentifier } from "@/lib/rate-limit"

const contactFormSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(5000),
  category: z.enum(["general", "appeal-question", "technical", "billing", "refund", "other"]).optional(),
})

export async function POST(request: NextRequest) {
  const clientId = getClientIdentifier(request)
  const limit = rateLimit(clientId, 5, 15 * 60 * 1000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    )
  }

  try {
    const body = await request.json()
    const validatedData = contactFormSchema.parse(body)

    const result = await sendContactEmail({
      name: validatedData.name,
      email: validatedData.email,
      subject: validatedData.subject,
      message: validatedData.message,
      category: validatedData.category,
    })

    if (!result.supportEmail.success || !result.confirmationEmail.success) {
      return NextResponse.json(
        { error: "Failed to send email. Please try again later." },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: "Your message has been sent successfully. We'll get back to you within 2-3 business days.",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      )
    }
    console.error("Contact form error:", error)
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}
