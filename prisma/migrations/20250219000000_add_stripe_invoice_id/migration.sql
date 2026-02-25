-- Add stripeInvoiceId to Invoice for Stripe send_invoice flow
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "stripeInvoiceId" TEXT;
