// POST /api/billing/pay-invoice - Create Stripe Checkout Session for a Performance Fee invoice
// Returns checkout URL for redirect to Stripe-hosted payment page.
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { stripe } from "@/lib/stripe/client"

function getBaseUrl(request: NextRequest): string {
  const host = request.headers.get("host") ?? "localhost:3000"
  const proto = request.headers.get("x-forwarded-proto") ?? "http"
  return `${proto}://${host}`
}

export async function POST(request: NextRequest) {
  try {
    if (!stripe) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 })
    }

    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const invoiceId = body?.invoiceId as string
    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId required" }, { status: 400 })
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        userId: session.user.id,
        invoiceType: "PERFORMANCE_FEE",
        status: "PENDING",
      },
      select: {
        id: true,
        amount: true,
        invoiceNumber: true,
        user: { select: { stripeCustomerId: true, email: true } },
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { error: "Invoice not found, already paid, or not a Performance Fee invoice" },
        { status: 404 }
      )
    }

    const amountCents = Math.round(Number(invoice.amount) * 100)
    if (amountCents < 50) {
      return NextResponse.json(
        { error: "Invoice amount too small for payment (min $0.50)" },
        { status: 400 }
      )
    }

    const baseUrl = getBaseUrl(request)
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Performance Fee – Invoice ${invoice.invoiceNumber}`,
              description: "4% of 3-year tax savings (OverTaxed)",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId: invoice.id,
        userId: session.user.id,
        invoiceNumber: invoice.invoiceNumber,
      },
      success_url: `${baseUrl}/account?invoice_paid=1`,
      cancel_url: `${baseUrl}/account`,
      ...(invoice.user.stripeCustomerId && { customer: invoice.user.stripeCustomerId }),
      customer_email: !invoice.user.stripeCustomerId ? (session.user.email ?? undefined) : undefined,
    })

    return NextResponse.json({
      url: checkoutSession.url,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.amount),
    })
  } catch (error) {
    console.error("[pay-invoice] Error:", error)
    return NextResponse.json(
      { error: "Failed to create payment" },
      { status: 500 }
    )
  }
}
