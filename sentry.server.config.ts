import * as Sentry from "@sentry/nextjs"
import {
  scrubSensitiveEvent,
  scrubSensitiveTransaction,
} from "@/lib/observability/sentry-scrubbing"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  enabled: !!process.env.SENTRY_DSN,
  // Belt and braces alongside the scrubbing below: with this false the SDK does
  // not attach a body in the first place, so the hook has less to remove.
  sendDefaultPii: false,
  beforeSend(event) {
    if (process.env.NODE_ENV === "development") {
      return null
    }
    // The packet-download body carries the capability that IS a customer's
    // authorization, and the Resend callback body carries a recipient address
    // and raw SMTP text. Neither may reach a third-party aggregator. See
    // lib/observability/sentry-scrubbing.ts for why the body goes on EVERY
    // route rather than on an allowlist of known-sensitive ones.
    return scrubSensitiveEvent(event)
  },
  // A performance transaction carries the same request context with no
  // exception attached, and is handed to a different hook.
  beforeSendTransaction(event) {
    return scrubSensitiveTransaction(event)
  },
})
