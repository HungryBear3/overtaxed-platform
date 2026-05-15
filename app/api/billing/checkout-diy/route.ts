import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { stripe, PRICE_IDS } from "@/lib/stripe/client"
import { prisma } from "@/lib/db"

const DIY_PRO_PRICE_CENTS = 6900 // $69 — shown in the UI; the authoritative price is Stripe's

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
  const url = new URL(request.url)
  const propertyId = url.searchParams.get("propertyId") ?? undefined
  const appealId = url.searchParams.get("appealId") ?? undefined

  // ── Ownership validation (close the propertyId/appealId hole) ──────────────
  // A signed-in user must only buy a packet for a property/appeal they own.
  // Reject foreign or mismatched ids with a 403 BEFORE we touch Stripe or the
  // DB so we don't create dangling invoices.
  if (propertyId) {
    const owned = await prisma.property.findFirst({
      where: { id: propertyId, userId: token.sub, deletedAt: null },
      select: { id: true },
    })
    if (!owned) {
      return NextResponse.json(
        { error: "That property is not in your account." },
        { status: 403 },
      )
    }
  }
  if (appealId) {
    const ownedAppeal = await prisma.appeal.findFirst({
      where: { id: appealId, userId: token.sub },
      select: { id: true, propertyId: true },
    })
    if (!ownedAppeal) {
      return NextResponse.json(
        { error: "That appeal is not in your account." },
        { status: 403 },
      )
    }
    // If both ids supplied, the appeal must belong to that property.
    if (propertyId && ownedAppeal.propertyId !== propertyId) {
      return NextResponse.json(
        { error: "Appeal does not belong to the selected property." },
        { status: 400 },
      )
    }
  }

  try {
    // Create the fulfillment record first so the webhook has a stable idempotency anchor.
    // No new table: existing Invoice (invoiceType=COMPS_ONLY) gets the packet fields.
    const invoice = await prisma.invoice.create({
      data: {
        userId: token.sub,
        invoiceNumber: `DIY-${Date.now()}-${token.sub.slice(0, 6)}`,
        amount: DIY_PRO_PRICE_CENTS / 100,
        currency: "USD",
        invoiceType: "COMPS_ONLY",
        status: "PENDING",
        dueDate: new Date(),
        propertyId: propertyId ?? null,
        packetAppealId: appealId ?? null,
        packetStatus: "NOT_STARTED",
      },
    })

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: (token.email as string) || undefined,
      line_items: [
        {
          price: PRICE_IDS.COMPS_ONLY,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/account/packets/${invoice.id}?checkout=diy_success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
      metadata: {
        userId: token.sub,
        plan: "COMPS_ONLY",
        invoiceId: invoice.id, // Webhook looks this up to trigger packet generation
      },
    })

    if (!session.url) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "CANCELLED", packetLastError: "Stripe session URL not available" },
      })
      return NextResponse.json({ error: "Checkout URL not available" }, { status: 500 })
    }

    // Record the session id as the idempotency anchor for the webhook.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { packetStripeSessionId: session.id },
    })

    return NextResponse.json({ url: session.url, invoiceId: invoice.id })
  } catch (err) {
    console.error("DIY checkout error:", err)
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
