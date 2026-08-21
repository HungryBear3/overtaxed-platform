type Invoice = {
  id: string
  invoiceNumber: string
  amount: number
  invoiceType: string
  status: string
  dueDate: string
}

/**
 * Contingency performance-fee invoicing is a held product.
 *
 * This section previously rendered a "Pay now" control that posted to
 * /api/billing/pay-invoice. That endpoint is withdrawn, so the control could
 * only ever fail — a dead payment affordance that still told a signed-in
 * customer they owed a contingency fee. Rather than leave it deterministically
 * failing, the section renders nothing while the hold stands.
 *
 * The prop shape is retained so the account page keeps compiling and so
 * restoring the section is a single reviewable change once the hold is lifted.
 */
export function PendingInvoicesSection(_props: { invoices: Invoice[] }) {
  return null
}
