import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { stripe } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"

export async function POST(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
  })
  if (!token?.sub) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  if (!stripe) {
    return NextResponse.json({ error: "Billing is not configured" }, { status: 500 })
  }

  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { stripeCustomerId: true },
  })
  if (!user?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account yet. Upgrade or complete a purchase on Pricing to manage your subscription." },
      { status: 400 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/account`,
    })
    if (!session.url) {
      return NextResponse.json({ error: "Portal URL not available" }, { status: 500 })
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("Billing portal error:", err)
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 })
  }
}
