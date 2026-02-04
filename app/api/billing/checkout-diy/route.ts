import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { stripe, PRICE_IDS } from "@/lib/stripe/client"

export async function POST(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token",
  })
  if (!token?.sub) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  }

  if (!stripe || !PRICE_IDS.COMPS_ONLY) {
    return NextResponse.json({ error: "DIY checkout is not configured" }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: (token.email as string) || undefined,
      line_items: [
        {
          price: PRICE_IDS.COMPS_ONLY,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/account?checkout=diy_success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: {
        userId: token.sub,
        plan: "COMPS_ONLY",
      },
    })

    if (!session.url) {
      return NextResponse.json({ error: "Checkout URL not available" }, { status: 500 })
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("DIY checkout error:", err)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
