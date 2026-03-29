import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_MAP: Record<string, string | undefined> = {
  T1: process.env.STRIPE_PRICE_T1_DIY_STARTER,
  T2: process.env.STRIPE_PRICE_T2_DIY_PRO,
  T3: process.env.STRIPE_PRICE_T3_DFY,
};

export async function POST(req: NextRequest) {
  try {
    const { tier, propertyPin } = await req.json();
    const priceId = PRICE_MAP[tier];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
    }

    const baseUrl = process.env.NEXTAUTH_URL || "https://www.overtaxed-il.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
      cancel_url: `${baseUrl}/pricing`,
      metadata: {
        tier,
        propertyPin: propertyPin ?? "",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
