type CheckoutSessionLike = {
  id?: string | null
  livemode?: boolean
  status?: string | null
  payment_status?: string | null
  amount_total?: number | null
  metadata?: Record<string, string | undefined> | null
  customer_details?: {
    email?: string | null
    name?: string | null
    phone?: string | null
  } | null
  customer_email?: string | null
}

export type RecoveredOTOrder = {
  stripeSessionId: string
  tier: string
  email: string
  name: string | null
  phone: string | null
  propertyAddress: string | null
  propertyPin: string | null
  amountPaid: number
  status: "PAID"
}

export function otOrderFromPaidSession(session: CheckoutSessionLike): RecoveredOTOrder {
  if (!session.id?.startsWith("cs_live_") || session.livemode !== true) {
    throw new Error("Recovery requires a live Stripe Checkout Session")
  }
  if (session.status !== "complete" || session.payment_status !== "paid") {
    throw new Error("Recovery requires a complete, paid Stripe Checkout Session")
  }

  const tier = session.metadata?.tier?.trim()
  if (!tier || !["T1", "T2", "T3"].includes(tier)) {
    throw new Error("Checkout Session has no supported OT tier")
  }

  const email = (
    session.customer_details?.email ??
    session.customer_email ??
    ""
  ).trim().toLowerCase()
  if (!email) {
    throw new Error("Checkout Session has no customer email")
  }

  const amountTotal = session.amount_total
  if (!Number.isInteger(amountTotal) || (amountTotal ?? 0) <= 0) {
    throw new Error("Checkout Session has no positive integer amount_total")
  }

  return {
    stripeSessionId: session.id,
    tier,
    email,
    name:
      session.customer_details?.name?.trim() ||
      session.metadata?.customerName?.trim() ||
      null,
    phone: session.customer_details?.phone?.trim() || null,
    propertyAddress: session.metadata?.customerAddress?.trim() || null,
    propertyPin: session.metadata?.propertyPin?.trim() || null,
    amountPaid: amountTotal! / 100,
    status: "PAID",
  }
}
