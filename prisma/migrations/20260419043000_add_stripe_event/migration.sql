-- Add Stripe event idempotency table for webhook replay protection
CREATE TABLE IF NOT EXISTS public.stripe_event (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stripe_event_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS stripe_event_createdAt_idx ON public.stripe_event("createdAt");
