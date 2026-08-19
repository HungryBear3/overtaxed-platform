/**
 * Create and send Stripe invoices for contingency fees.
 * Uses send_invoice so Stripe emails the customer with a payment link.
 */
import { prisma } from "@/lib/db"
import { heldProductFailure } from "@/lib/products/held"

const MIN_AMOUNT_CENTS = 50 // Stripe minimum $0.50

/**
 * This module invoices the 22% contingency fee, which is a held product.
 *
 * Stripe is deliberately NOT imported at module scope: importing it here is
 * what previously allowed a provider client to be constructed before any hold
 * assertion ran. Every exported function asserts its hold first and only then
 * dynamically acquires the client.
 */
const BOUNDARY = "lib/billing/stripe-invoice"

async function acquireStripe() {
  const { getStripe } = await import("@/lib/stripe/client")
  return getStripe()
}

/**
 * Get or create Stripe Customer for a user.
 */
export async function getOrCreateStripeCustomer(
  userId: string
): Promise<string | null> {
  // Held: refuse before touching the provider or reading customer records.
  if (heldProductFailure("CONTINGENCY", BOUNDARY)) return null

  const stripe = await acquireStripe()
  if (!stripe) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, email: true, name: true },
  })
  if (!user?.email) return null

  if (user.stripeCustomerId) return user.stripeCustomerId

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId },
  })

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  })
  return customer.id
}

export type CreateStripeInvoiceResult =
  | { success: true; stripeInvoiceId: string }
  | { success: false; error: string }

/**
 * Create a Stripe Invoice, add line item, finalize, and send to customer.
 * Stores our Invoice id in metadata for webhook lookup.
 */
export async function createAndSendStripeInvoice(args: {
  ourInvoiceId: string
  userId: string
  amount: number
  invoiceNumber: string
  description?: string
}): Promise<CreateStripeInvoiceResult> {
  // Held: refuse before acquiring Stripe, creating a customer, or writing.
  const held = heldProductFailure("PERFORMANCE_INVOICE", BOUNDARY)
  if (held) return held

  const stripe = await acquireStripe()
  if (!stripe) {
    return { success: false, error: "Stripe not configured" }
  }

  const amountCents = Math.round(args.amount * 100)
  if (amountCents < MIN_AMOUNT_CENTS) {
    return {
      success: false,
      error: `Amount too small (min $${MIN_AMOUNT_CENTS / 100})`,
    }
  }

  const customerId = await getOrCreateStripeCustomer(args.userId)
  if (!customerId) {
    return { success: false, error: "Could not get or create Stripe customer" }
  }

  try {
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 30,
      metadata: { ourInvoiceId: args.ourInvoiceId, userId: args.userId },
      custom_fields: [
        { name: "Invoice #", value: args.invoiceNumber },
      ],
    })

    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountCents,
      currency: "usd",
      description:
        args.description ?? "Contingency Fee – 22% of first-year granted tax savings (OverTaxed IL)",
    })

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
    await stripe.invoices.sendInvoice(invoice.id)

    return {
      success: true,
      stripeInvoiceId: finalized.id,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}
