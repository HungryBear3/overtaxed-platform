import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import Redis from "ioredis"

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null

const RATE_LIMIT = 3
const RATE_LIMIT_WINDOW_SECONDS = 3600 // 1 hour

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "unknown"
    if (ip === "unknown") {
      return NextResponse.json({ error: "Could not determine IP for rate limiting" }, { status: 400 })
    }

    // Rate limit (skip if Redis not configured)
    const key = `leads_capture_rate:${ip}`
    const currentCount = redis ? await redis.get(key) : null
    if (currentCount && parseInt(currentCount) >= RATE_LIMIT) {
      return NextResponse.json({ error: "Too many requests from this IP, please try again later." }, { status: 429 })
    }

    const data = await request.json()
    const { email, address, potentialSavings } = data

    if (typeof email !== "string" || typeof address !== "string" || typeof potentialSavings !== "number") {
      return NextResponse.json({ error: "Invalid request data" }, { status: 400 })
    }

    // Store in DB
    await prisma.oTLead.create({
      data: {
        email,
        address,
        potentialSavings,
      },
    })

    // Increment rate limit counter
    if (redis) {
      if (currentCount) {
        await redis.incr(key)
      } else {
        await redis.set(key, 1, "EX", RATE_LIMIT_WINDOW_SECONDS)
      }
    }

    // Send confirmation email via Resend
    const resendApiKey = process.env.OT_RESEND_API_KEY
    if (!resendApiKey) {
      return NextResponse.json({ error: "Resend API key not configured" }, { status: 500 })
    }

    const message = {
      from: "no-reply@overtaxed.com",
      to: email,
      subject: "Your Cook County property tax assessment summary",
      html: `<p>Thank you for using Overtaxed. Here is your summary for property: <strong>${address}</strong>.</p><p>Estimated savings: <strong>$${potentialSavings.toFixed(2)}</strong>.</p><p>We will follow up with comparable properties and filing instructions soon.</p>`,
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    })

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text()
      return NextResponse.json({ error: `Failed to send email: ${errorText}` }, { status: 500 })
    }

    return NextResponse.json({ message: "Lead captured and email sent" }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 })
  }
}
