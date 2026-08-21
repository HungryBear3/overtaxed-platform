import { sanitizeAnonymousGaIdentifiers } from "@/lib/analytics/ga4"
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
  | { ok: true; code: "skipped_non_production" | "skipped_missing_config" | "skipped_missing_client_id" }
  | { ok: false; code: "provider_error"; status: number }

export async function sendGaPurchaseEvent(args: GaPurchaseArgs): Promise<GaMeasurementResult> {
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
        currency: args.currency,
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
