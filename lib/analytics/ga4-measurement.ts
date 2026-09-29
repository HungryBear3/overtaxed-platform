import { sanitizeAnonymousGaIdentifiers } from "@/lib/analytics/ga4"
import { validateServerPurchasePayload } from "@/lib/analytics/funnel-contract"
import type { GaPurchaseClaim } from "@/lib/analytics/ga4-purchase-claim"
import { isProductionMarketingRuntime } from "@/lib/marketing/preview-gate"

export const GA_MEASUREMENT_TIMEOUT_MS = 2000

type GaPurchaseArgs = {
  host: string
  amountCents: number
  currency: string
  itemName: string
  itemCategory: string
  itemVariant: string
  transactionId: string
  anonymousIds: Record<string, unknown> | null | undefined
}

export type GaMeasurementResult =
  | { ok: true; code: "sent" }
  | {
      ok: true
      code: "skipped_non_production" | "skipped_missing_config" | "skipped_missing_client_id" | "skipped_already_claimed"
    }
  | { ok: false; code: "provider_error"; status: number }
  | { ok: false; code: "refused_contract" | "claim_unavailable" }

/**
 * Send the Measurement Protocol purchase for one settled checkout — at most
 * once per transaction. Every gate runs first, then the body must pass the
 * funnel contract's server purchase validator; only then is the caller's
 * durable claim taken (see ./ga4-purchase-claim), and only its winner
 * transmits. Nothing here throws, and no outcome is fatal to settlement.
 */
export async function sendGaPurchaseEvent(
  args: GaPurchaseArgs,
  claimTransport: () => Promise<GaPurchaseClaim>,
): Promise<GaMeasurementResult> {
  if (!isProductionMarketingRuntime({ host: args.host })) return { ok: true, code: "skipped_non_production" }
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  const apiSecret = process.env.GA4_API_SECRET?.trim()
  if (!measurementId || !apiSecret) return { ok: true, code: "skipped_missing_config" }

  const ids = sanitizeAnonymousGaIdentifiers(args.anonymousIds)
  if (!ids.gaClientId) return { ok: true, code: "skipped_missing_client_id" }

  const value = args.amountCents / 100
  const payload = {
    client_id: ids.gaClientId,
    events: [{
      name: "purchase",
      params: {
        // ISO 4217 codes are upper case; Stripe reports them lower case.
        currency: args.currency.toUpperCase(),
        value,
        transaction_id: args.transactionId,
        item_name: args.itemName,
        item_category: args.itemCategory,
        item_variant: args.itemVariant,
        price: value,
        quantity: 1,
        ...(ids.gaSessionId ? { ga_session_id: Number(ids.gaSessionId) } : {}),
        ...(ids.gaSessionNumber ? { ga_session_number: Number(ids.gaSessionNumber) } : {}),
        items: [{
          item_name: args.itemName,
          item_category: args.itemCategory,
          item_variant: args.itemVariant,
          price: value,
          quantity: 1,
        }],
      },
    }],
  }
  if (!validateServerPurchasePayload(payload).ok) return { ok: false, code: "refused_contract" }

  let claim: GaPurchaseClaim
  try {
    claim = await claimTransport()
  } catch {
    claim = "unavailable"
  }
  if (claim === "already_claimed") return { ok: true, code: "skipped_already_claimed" }
  if (claim !== "won") return { ok: false, code: "claim_unavailable" }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, GA_MEASUREMENT_TIMEOUT_MS)

  try {
    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    )

    if (!response.ok) return { ok: false, code: "provider_error", status: response.status }
    return { ok: true, code: "sent" }
  } catch {
    return { ok: false, code: "provider_error", status: 0 }
  } finally {
    clearTimeout(timeout)
  }
}
