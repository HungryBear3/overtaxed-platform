import { createHash } from "node:crypto"

import type { CheckoutWindowSnapshot } from "@/lib/checkout/window-gate-token"

export const OT_ANALYSIS_ACK_VERSION = "analysis_ack_v1"
export const OT_WINDOW_FRESHNESS_TTL_HOURS = Math.max(1, Number(process.env.OT_WINDOW_FRESHNESS_TTL_HOURS ?? "48"))
export const OT_CHECKOUT_CREATING_LEASE_MS = 10 * 60 * 1000
export const STRIPE_MIN_CHECKOUT_SECONDS = 30 * 60
export const STRIPE_MAX_CHECKOUT_SECONDS = 24 * 60 * 60

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function normalizeEmail(value: string): string {
  return normalizeWhitespace(value).toLowerCase()
}

export function normalizedOtAddress(value: string): string {
  return normalizeWhitespace(value).toUpperCase()
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export type OtContractInput = {
  tier: "T2" | "T3"
  email: string
  name: string
  propertyAddress: string
  propertyPin: string
  township: string
  snapshot: CheckoutWindowSnapshot
  noticeEvidence: { date: string | null; address: string | null }
  acknowledgmentEvidence: { acknowledged: boolean; version: string | null }
  priceId: string
  productId: string
  amountCents: number
  currency: string
}

export function buildOtContractKey(input: OtContractInput): string {
  return sha256Hex(canonicalJson({
    tier: input.tier,
    email: normalizeEmail(input.email),
    name: normalizeWhitespace(input.name),
    propertyAddress: normalizedOtAddress(input.propertyAddress),
    propertyPin: input.propertyPin,
    township: input.township,
    snapshot: input.snapshot,
    noticeEvidence: {
      date: input.noticeEvidence.date,
      address: input.noticeEvidence.address ? normalizedOtAddress(input.noticeEvidence.address) : null,
    },
    acknowledgmentEvidence: input.acknowledgmentEvidence,
    stripe: {
      priceId: input.priceId,
      productId: input.productId,
      amountCents: input.amountCents,
      currency: input.currency.toLowerCase(),
    },
  }))
}

export function isWindowSnapshotFresh(snapshot: Pick<CheckoutWindowSnapshot, "verifiedAt">, now: Date = new Date()) {
  const verifiedAt = new Date(snapshot.verifiedAt)
  if (Number.isNaN(verifiedAt.getTime())) return false
  return now.getTime() - verifiedAt.getTime() <= OT_WINDOW_FRESHNESS_TTL_HOURS * 60 * 60 * 1000
}

export function dateKey(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}
