"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Check } from "lucide-react"
import {
  RETAIL_PRICE_PER_PROPERTY,
  GROWTH_PRICE_PER_PROPERTY,
  GROWTH_MIN_PROPERTIES,
  GROWTH_MAX_PROPERTIES,
  PORTFOLIO_PRICE_PER_PROPERTY,
  PORTFOLIO_MIN_PROPERTIES,
  PORTFOLIO_MAX_PROPERTIES,
  growthPriceForProperties,
  portfolioPriceForProperties,
} from "@/lib/billing/pricing"

type PlanRange = "1-2" | "3-9" | "10-20" | "20+"

const plans: Array<{
  id: "STARTER" | "GROWTH" | "PORTFOLIO"
  name: string
  priceLabel: string
  propertyLimit: string
  pricingNote: string
  exampleTotals: string
  features: string[]
  popular?: boolean
}> = [
  {
    id: "STARTER",
    name: "Starter",
    priceLabel: "$149/property/year",
    propertyLimit: "Up to 2 of your first properties",
    pricingNote: "Retail pricing.",
    exampleTotals: "1 = $149/yr · 2 = $298/yr",
    popular: true,
    features: [
      "Full automation per property",
      "Comparable property analysis",
      "Appeal filing assistance",
      "Deadline tracking & reminders",
      "Email support",
    ],
  },
  {
    id: "GROWTH",
    name: "Growth",
    priceLabel: `$${GROWTH_PRICE_PER_PROPERTY}/property/year`,
    propertyLimit: "Up to 7 more properties (after Starter)",
    pricingNote: "Per-property pricing.",
    exampleTotals: `1 = $${growthPriceForProperties(1)}/yr · 5 = $${growthPriceForProperties(5)}/yr · 9 = $${growthPriceForProperties(9)}/yr`,
    features: [
      `Full automation for ${GROWTH_MIN_PROPERTIES}–${GROWTH_MAX_PROPERTIES} properties`,
      "Comparable property analysis",
      "Appeal filing assistance",
      "Deadline tracking & reminders",
      "Priority email support",
    ],
  },
  {
    id: "PORTFOLIO",
    name: "Portfolio",
    priceLabel: `$${PORTFOLIO_PRICE_PER_PROPERTY}/property/year`,
    propertyLimit: "Up to 11 more properties (after Growth)",
    pricingNote: "Per-property pricing.",
    exampleTotals: `1 = $${portfolioPriceForProperties(1)}/yr · 10 = $${portfolioPriceForProperties(10)}/yr · 20 = $${portfolioPriceForProperties(20)}/yr`,
    features: [
      `Full automation for ${PORTFOLIO_MIN_PROPERTIES}–${PORTFOLIO_MAX_PROPERTIES} properties`,
      "Comparable property analysis",
      "Appeal filing assistance",
      "Deadline tracking & reminders",
      "Priority support + phone",
    ],
  },
]

const RANGE_TO_PLAN: Record<PlanRange, "STARTER" | "GROWTH" | "PORTFOLIO" | "CUSTOM"> = {
  "1-2": "STARTER",
  "3-9": "GROWTH",
  "10-20": "PORTFOLIO",
  "20+": "CUSTOM",
}

const TIER_RANK: Record<string, number> = { COMPS_ONLY: 0, STARTER: 1, GROWTH: 2, PORTFOLIO: 3, PERFORMANCE: 4 }
function isUpgradeFrom(currentTier: string | null, targetPlan: "STARTER" | "GROWTH" | "PORTFOLIO"): boolean {
  if (!currentTier) return false
  const current = TIER_RANK[currentTier] ?? 0
  const target = TIER_RANK[targetPlan] ?? 0
  return target > current
}

/** Growth requires Starter first (or already on Growth to add more). */
function requiresStarterFirst(
  plan: "STARTER" | "GROWTH" | "PORTFOLIO",
  currentTier: string | null | undefined
): boolean {
  if (plan !== "GROWTH") return false
  return currentTier != null && currentTier !== "STARTER" && currentTier !== "GROWTH"
}

/** Portfolio requires Growth (or already on Portfolio to add more) and, for first-time upgrade, all 9 Growth slots used. */
function requiresGrowthFirstOrFullSlots(
  plan: "STARTER" | "GROWTH" | "PORTFOLIO",
  currentTier: string | null | undefined,
  propertyCount: number
): boolean {
  if (plan !== "PORTFOLIO") return false
  if (currentTier === "PORTFOLIO") return false
  if (currentTier !== "GROWTH") return true
  return propertyCount < 9
}

const RANGE_LABELS: PlanRange[] = ["1-2", "3-9", "10-20", "20+"]

/** Per-tier bucket sizes: Starter 2, Growth 7 (on top of 2), Portfolio 11 (on top of 9). Display "X/Y slots" per tier. */
const STARTER_SLOTS = 2
const GROWTH_SLOTS = 7
const PORTFOLIO_SLOTS = 11

/** Used count in each tier bucket from total property count. */
function tierUsedFromTotal(total: number): { starter: number; growth: number; portfolio: number } {
  return {
    starter: Math.min(STARTER_SLOTS, total),
    growth: Math.min(GROWTH_SLOTS, Math.max(0, total - STARTER_SLOTS)),
    portfolio: Math.min(PORTFOLIO_SLOTS, Math.max(0, total - STARTER_SLOTS - GROWTH_SLOTS)),
  }
}

/** When upgrading: Starter→Growth show 1–7 additional (total 3–9); on Growth cap by Growth bucket left (7 - growthUsed); Portfolio same. */
function getQuantityRange(range: PlanRange, currentTier: string | null, currentSlots: number): number[] {
  if (range === "1-2") return [1, 2]
  if (range === "3-9") {
    if (currentTier === "STARTER" || currentTier === null) return [1, 2, 3, 4, 5, 6, 7] // additional (2 + 1..7 = 3..9 total)
    if (currentTier === "GROWTH") {
      const growthUsed = currentSlots - STARTER_SLOTS
      const maxAdditional = Math.max(1, GROWTH_SLOTS - growthUsed)
      return Array.from({ length: maxAdditional }, (_, i) => i + 1) // 1..maxAdditional
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9]
  }
  if (range === "10-20") {
    if (currentTier === "GROWTH") return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] // additional (9 + 1..11 = 10..20 total)
    if (currentTier === "PORTFOLIO") {
      const portfolioUsed = currentSlots - STARTER_SLOTS - GROWTH_SLOTS
      const maxAdditional = Math.max(1, PORTFOLIO_SLOTS - portfolioUsed)
      return Array.from({ length: maxAdditional }, (_, i) => i + 1)
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  }
  return []
}

/** Total property count for display/price: when from Starter total = 2 + slotIndex; when on Growth total = currentSlots + slotIndex; when from Growth to Portfolio total = 9 + slotIndex; when on Portfolio total = currentSlots + slotIndex. */
function slotIndexToPropertyCount(range: PlanRange, slotIndex: number, currentTier: string | null, currentSlots: number): number {
  if (range === "1-2") return slotIndex
  if (range === "3-9") {
    if (currentTier === "STARTER" || currentTier === null) return 2 + slotIndex
    if (currentTier === "GROWTH") return currentSlots + slotIndex
    return slotIndex
  }
  if (range === "10-20") {
    if (currentTier === "GROWTH") return 9 + slotIndex
    if (currentTier === "PORTFOLIO") return currentSlots + slotIndex
    return slotIndex
  }
  return slotIndex
}

/** Map current property count to dropdown selection. */
function propertyCountToSlotIndex(range: PlanRange, count: number, currentTier: string | null, currentSlots: number): number {
  if (range === "1-2") return Math.min(Math.max(count, 1), 2)
  if (range === "3-9") {
    const fromStarter = currentTier === "STARTER" || currentTier === null
    const max = fromStarter ? 7 : Math.max(1, GROWTH_MAX_PROPERTIES - currentSlots)
    const min = 1
    const raw = fromStarter ? count - 2 : (currentTier === "GROWTH" ? count - currentSlots : count)
    return Math.min(Math.max(raw, min), max)
  }
  if (range === "10-20") {
    const max = currentTier === "GROWTH" ? 11 : Math.max(1, Math.min(11, PORTFOLIO_MAX_PROPERTIES - currentSlots))
    const min = 1
    const raw = currentTier === "GROWTH" ? count - 9 : (currentTier === "PORTFOLIO" ? count - currentSlots : count)
    return Math.min(Math.max(raw, min), max)
  }
  return 1
}

function getAnnualPrice(plan: "STARTER" | "GROWTH" | "PORTFOLIO", qty: number): number {
  if (plan === "STARTER") return qty * RETAIL_PRICE_PER_PROPERTY
  if (plan === "GROWTH" && qty >= 1 && qty <= 9) return qty * GROWTH_PRICE_PER_PROPERTY
  if (plan === "PORTFOLIO" && qty >= 1 && qty <= 20) return qty * PORTFOLIO_PRICE_PER_PROPERTY
  return 0
}

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [planInfo, setPlanInfo] = useState<{
    propertyCount: number
    subscriptionTier: string | null
    subscriptionQuantity: number | null
    propertyLimit?: number
    recommendedPlan: string | null
    atLimit?: boolean
  } | null>(null)
  const [selectedRange, setSelectedRange] = useState<PlanRange | null>(null)
  const [selectedQuantity, setSelectedQuantity] = useState<number>(1)

  useEffect(() => {
    fetch("/api/billing/plan-info")
      .then((r) => r.json())
      .then((data) => {
        setPlanInfo(data)
        if (data.propertyCount > 0 && !selectedRange) {
          if (data.propertyCount <= 2) setSelectedRange("1-2")
          else if (data.propertyCount <= 9) setSelectedRange("3-9")
          else if (data.propertyCount <= 20) setSelectedRange("10-20")
          else setSelectedRange("20+")
        }
      })
      .catch(() => setPlanInfo({ propertyCount: 0, subscriptionTier: null, subscriptionQuantity: null, recommendedPlan: null }))
  }, [])

  const planToRange: Record<string, PlanRange> = { STARTER: "1-2", GROWTH: "3-9", PORTFOLIO: "10-20", CUSTOM: "20+" }
  const effectiveRange = selectedRange ?? (planInfo?.recommendedPlan ? planToRange[planInfo.recommendedPlan] ?? "1-2" : "1-2")
  const currentTier = planInfo?.subscriptionTier ?? null
  const currentSlots = planInfo?.subscriptionQuantity ?? 0
  const totalProperties = planInfo?.propertyCount ?? 0
  const tierUsed = tierUsedFromTotal(totalProperties)
  const quantityOptions = getQuantityRange(effectiveRange, currentTier, currentSlots)

  // Reset selectedQuantity when range or planInfo changes; preselect current count or next upgrade when at limit
  useEffect(() => {
    const opts = getQuantityRange(effectiveRange, currentTier, currentSlots)
    if (opts.length === 0) return
    const currentCount = planInfo?.propertyCount ?? 0
    const limit = planInfo?.propertyLimit
    const atLimit = limit != null && limit < 999 && currentCount >= limit
    const nextUpgradeVal = atLimit && limit != null && (currentTier === "STARTER" || currentTier === null) && effectiveRange === "3-9"
      ? Math.min(Math.max(limit + 1 - 2, 1), 7)
      : atLimit && limit != null && currentTier === "GROWTH" && effectiveRange === "10-20"
        ? Math.min(Math.max(limit + 1 - 9, 1), 11)
        : atLimit && limit != null
          ? Math.min(limit + 1, opts[opts.length - 1])
          : null
    const slotIndex = nextUpgradeVal ?? propertyCountToSlotIndex(effectiveRange, currentCount, currentTier, currentSlots)
    const sel = opts.includes(slotIndex) ? slotIndex : opts[0]
    setSelectedQuantity(sel)
  }, [effectiveRange, currentTier, currentSlots, planInfo?.propertyCount, planInfo?.propertyLimit])

  async function subscribe(plan: "STARTER" | "GROWTH" | "PORTFOLIO") {
    setLoading(plan)
    setError("")
    try {
      // When upgrading: send total slots (Starter 2 + additional for Growth; Growth 9 + additional for Portfolio)
      let propertyCount: number
      if (plan === "GROWTH" && (currentTier === "STARTER" || currentTier === null)) {
        propertyCount = Math.min(2 + selectedQuantity, 9)
      } else if (plan === "PORTFOLIO" && currentTier === "GROWTH") {
        propertyCount = Math.min(9 + selectedQuantity, 20)
      } else if (plan === "GROWTH" && currentTier === "GROWTH") {
        propertyCount = Math.min(currentSlots + selectedQuantity, GROWTH_MAX_PROPERTIES)
      } else if (plan === "PORTFOLIO" && currentTier === "PORTFOLIO") {
        propertyCount = Math.min(currentSlots + selectedQuantity, PORTFOLIO_MAX_PROPERTIES)
      } else {
        propertyCount = RANGE_TO_PLAN[effectiveRange] === plan
          ? slotIndexToPropertyCount(effectiveRange, selectedQuantity, currentTier, currentSlots)
          : plan === "STARTER"
            ? Math.min(selectedQuantity, 2)
            : plan === "GROWTH"
              ? Math.max(Math.min(selectedQuantity, 9), 1)
              : Math.max(Math.min(selectedQuantity, 20), 1)
      }
      const qty = propertyCount
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, propertyCount: qty }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/auth/signin?callbackUrl=/pricing")
          return
        }
        throw new Error(data.error || "Failed to start checkout")
      }
      if (!data.url) {
        throw new Error("Checkout URL not available. Please try again or contact support.")
      }
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-xl font-bold text-blue-900">
            Over<span className="text-blue-600">Taxed</span>
          </Link>
          <div className="flex gap-4">
            {planInfo?.subscriptionTier && (
              <Link href="/dashboard" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                Dashboard
              </Link>
            )}
            <Link href="/auth/signin" className="text-sm font-medium text-blue-600 hover:text-blue-700">
              {planInfo?.subscriptionTier ? "Account" : "Sign in"}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-gray-600">
            DIY reports only · $149/property/year · Commercial tiers · Or 4% of savings deferred.
          </p>
        </div>

        {/* Property count hint - shown when user has properties */}
        {planInfo && planInfo.propertyCount > 0 && (
          <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-center">
            <p className="text-sm text-gray-700">
              You have <strong>{planInfo.propertyCount} propert{planInfo.propertyCount === 1 ? "y" : "ies"}</strong>
              {planInfo.atLimit && " — at plan limit. Select a plan below to upgrade."}
            </p>
            {!planInfo.atLimit && (
              <p className="text-xs text-gray-600 mt-1">
                Growth (3–9): add up to {Math.max(0, 9 - planInfo.propertyCount)} more. Portfolio (10–20): add up to {Math.max(0, 20 - planInfo.propertyCount)} more.
              </p>
            )}
          </div>
        )}

        {/* How plans work - quantity = property count, 1 minimum at tier price */}
        <div className="mb-8 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm font-medium text-amber-900 mb-1">How upgrade tiers work</p>
          <p className="text-sm text-amber-800">
            <strong>Starter:</strong> 1–2 properties ($149 each). <strong>Growth:</strong> 1–9 properties at ${GROWTH_PRICE_PER_PROPERTY}/property (minimum 1). <strong>Portfolio:</strong> 1–20 properties at ${PORTFOLIO_PRICE_PER_PROPERTY}/property (minimum 1). You choose how many properties to pay for; you can add more later within the plan max. To downgrade or change plan, use Account or contact us.
          </p>
        </div>

        {error && (
          <div className="mb-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-center">
            {error}
          </div>
        )}

        {/* DIY reports only */}
        <div className="mb-12">
          <Card className="max-w-xl mx-auto border-gray-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>DIY reports only</CardTitle>
                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">Comps only</span>
              </div>
              <CardDescription>Rule 15–compliant comps + evidence packet. You file the appeal yourself.</CardDescription>
              <div className="mt-4">
                <span className="text-3xl font-bold text-gray-900">$69</span>
                <span className="text-gray-500 ml-1">one-time, per property</span>
              </div>
              <p className="text-sm text-gray-600 mt-2">
                DIY includes 1 property slot. $69 per additional comps report. Pick a property to apply credits.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-gray-600 mb-6">
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />Comparable analysis</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />PDF evidence packet</li>
                <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />No monitoring or filing</li>
              </ul>
              {planInfo?.subscriptionTier ? (
                <Link
                  href="/properties"
                  className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
                >
                  Pick a property & get comps
                </Link>
              ) : (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={async () => {
                    setLoading("COMPS_ONLY")
                    setError("")
                    try {
                      const res = await fetch("/api/billing/checkout-diy", { method: "POST" })
                      const data = await res.json()
                      if (!res.ok) {
                        if (res.status === 401) {
                          router.push("/auth/signin?callbackUrl=/pricing")
                          return
                        }
                        throw new Error(data.error || "Failed to start checkout")
                      }
                      if (data.url) window.location.href = data.url
                      else throw new Error("Checkout URL not available")
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Something went wrong")
                    } finally {
                      setLoading(null)
                    }
                  }}
                  disabled={!!loading}
                >
                  {loading === "COMPS_ONLY" ? "Redirecting…" : "Get comps — $69"}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Full automation */}
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-4">Full automation</h2>
        <div className="flex flex-wrap justify-center gap-2 mb-2">
          <span className="text-sm text-gray-600">How many properties?</span>
          {RANGE_LABELS.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => {
                setSelectedRange(range)
                const opts = getQuantityRange(range, currentTier, currentSlots)
                if (opts.length > 0) {
                  const c = planInfo?.propertyCount ?? 0
                  const slotIndex = propertyCountToSlotIndex(range, c, currentTier, currentSlots)
                  setSelectedQuantity(opts.includes(slotIndex) ? slotIndex : opts[0])
                }
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                effectiveRange === range ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
        <p className="text-center text-sm text-gray-500 mb-6">
          Pick a range (1–2, 3–9, or 10–20). For Growth choose <strong>1–9 properties</strong> at ${GROWTH_PRICE_PER_PROPERTY} each; for Portfolio choose <strong>1–20 properties</strong> at ${PORTFOLIO_PRICE_PER_PROPERTY} each. Minimum 1 at the tier price.
        </p>
        <div className="grid gap-6 md:grid-cols-3 mb-12">
          {plans.map((plan) => {
            const isRecommended = RANGE_TO_PLAN[effectiveRange] === plan.id
            const showQuantitySelector = RANGE_TO_PLAN[effectiveRange] === plan.id && quantityOptions.length > 0
            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${isRecommended ? "border-blue-500 shadow-lg ring-2 ring-blue-200" : plan.popular ? "border-blue-400" : ""}`}
              >
                {isRecommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                    Recommended for you
                  </div>
                )}
                {!isRecommended && plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-600 px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{plan.propertyLimit}</CardDescription>
                  <div className="mt-4">
                    <p className="text-lg font-semibold text-gray-900">{plan.priceLabel}</p>
                    <p className="text-sm text-gray-500 mt-1">{plan.pricingNote}</p>
                    <p className="text-sm text-gray-600 mt-2">{plan.exampleTotals}</p>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <ul className="mb-6 flex-1 space-y-3">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {/* Quantity selector - 1–7 slots (Growth) or 1–11 (Portfolio); labels show slot + property count */}
                  {showQuantitySelector && (
                    <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
                      {planInfo && plan.id === "STARTER" && (
                        <p className="text-sm font-medium text-gray-800 mb-2">
                          {tierUsed.starter}/{STARTER_SLOTS} slots used
                          {tierUsed.starter < STARTER_SLOTS && (
                            <span className="text-green-700"> · {STARTER_SLOTS - tierUsed.starter} available</span>
                          )}
                          {tierUsed.starter >= STARTER_SLOTS && (
                            <span className="text-amber-700"> · Select Growth above to add more</span>
                          )}
                        </p>
                      )}
                      {planInfo && plan.id === "GROWTH" && (
                        <p className="text-sm font-medium text-gray-800 mb-2">
                          {tierUsed.growth}/{GROWTH_SLOTS} slots used
                          {tierUsed.growth < GROWTH_SLOTS && (
                            <span className="text-green-700"> · {GROWTH_SLOTS - tierUsed.growth} available</span>
                          )}
                          {tierUsed.growth >= GROWTH_SLOTS && (
                            <span className="text-amber-700"> · Select more below or upgrade to Portfolio</span>
                          )}
                        </p>
                      )}
                      {planInfo && plan.id === "PORTFOLIO" && (
                        <p className="text-sm font-medium text-gray-800 mb-2">
                          {tierUsed.portfolio}/{PORTFOLIO_SLOTS} slots used
                          {tierUsed.portfolio < PORTFOLIO_SLOTS && (
                            <span className="text-green-700"> · {PORTFOLIO_SLOTS - tierUsed.portfolio} available</span>
                          )}
                          {tierUsed.portfolio >= PORTFOLIO_SLOTS && (
                            <span className="text-amber-700"> · At limit; contact us for 20+</span>
                          )}
                        </p>
                      )}
                      <label htmlFor={`qty-${plan.id}`} className="block text-sm font-medium text-gray-700 mb-2">
                        {plan.id === "GROWTH"
                          ? (currentTier === "STARTER" || currentTier === null)
                            ? `Add 1–7 properties (3–9 total) at $${GROWTH_PRICE_PER_PROPERTY}/property/year:`
                            : `Choose 1–9 properties at $${GROWTH_PRICE_PER_PROPERTY}/property/year (minimum 1):`
                          : plan.id === "PORTFOLIO"
                            ? currentTier === "GROWTH"
                              ? `Add 1–11 properties (10–20 total) at $${PORTFOLIO_PRICE_PER_PROPERTY}/property/year:`
                              : `Choose 1–20 properties at $${PORTFOLIO_PRICE_PER_PROPERTY}/property/year (minimum 1):`
                            : "How many properties to pay for (you'll be charged this at checkout):"}
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          id={`qty-${plan.id}`}
                          value={selectedQuantity}
                          onChange={(e) => setSelectedQuantity(Number(e.target.value))}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 bg-white"
                        >
                          {quantityOptions.map((n) => {
                            const count = slotIndexToPropertyCount(effectiveRange, n, currentTier, currentSlots)
                            const price = getAnnualPrice(plan.id, count)
                            if (plan.id === "GROWTH" && (currentTier === "STARTER" || currentTier === null)) {
                              return <option key={n} value={n}>Add {n} more ({count} total) — ${price.toLocaleString()}/yr</option>
                            }
                            if (plan.id === "GROWTH" && currentTier === "GROWTH") {
                              return <option key={n} value={n}>Add {n} more ({count} total) — ${price.toLocaleString()}/yr</option>
                            }
                            if (plan.id === "PORTFOLIO" && currentTier === "GROWTH") {
                              return <option key={n} value={n}>Add {n} more ({count} total) — ${price.toLocaleString()}/yr</option>
                            }
                            if (plan.id === "PORTFOLIO" && currentTier === "PORTFOLIO") {
                              return <option key={n} value={n}>Add {n} more ({count} total) — ${price.toLocaleString()}/yr</option>
                            }
                            return <option key={n} value={n}>{count} propert{count === 1 ? "y" : "ies"} (${price.toLocaleString()}/yr)</option>
                          })}
                        </select>
                        <span className="text-sm font-semibold text-gray-900">
                          = ${getAnnualPrice(plan.id, slotIndexToPropertyCount(effectiveRange, selectedQuantity, currentTier, currentSlots)).toLocaleString()}/year
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        {plan.id === "GROWTH"
                          ? (currentTier === "STARTER" || currentTier === null)
                            ? `Add 1–7 more (3–9 total). $${GROWTH_PRICE_PER_PROPERTY} each. You can add more later within 9.`
                            : `Growth: 1–9 properties at $${GROWTH_PRICE_PER_PROPERTY} each. You can add more later within that limit.`
                          : plan.id === "PORTFOLIO"
                            ? currentTier === "GROWTH"
                              ? `Add 1–11 more (10–20 total). $${PORTFOLIO_PRICE_PER_PROPERTY} each. You can add more later within 20.`
                              : `Portfolio: 1–20 properties at $${PORTFOLIO_PRICE_PER_PROPERTY} each. You can add more later within that limit.`
                            : "Starter: up to 2 properties. You can add more later within that limit."}
                      </p>
                    </div>
                  )}
                  {plan.id === "GROWTH" &&
                    planInfo?.subscriptionTier != null &&
                    planInfo.subscriptionTier !== "STARTER" &&
                    planInfo.subscriptionTier !== "GROWTH" && (
                      <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                        Subscribe to <strong>Starter</strong> (1–2 properties) first; then you can upgrade to Growth here.
                      </p>
                    )}
                  {plan.id === "PORTFOLIO" &&
                    planInfo?.subscriptionTier !== "PORTFOLIO" &&
                    (planInfo?.subscriptionTier !== "GROWTH" || (planInfo?.propertyCount ?? 0) < 9) &&
                    planInfo?.subscriptionTier != null && (
                      <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                        {planInfo.subscriptionTier !== "GROWTH" ? (
                          <>
                            Subscribe to <strong>Starter</strong> first, then <strong>Growth</strong> (1–9 properties).
                            Portfolio is available after you use all 9 Growth slots.
                          </>
                        ) : (
                          `Portfolio unlocks after all 7 Growth slots are used. You have ${tierUsed.growth} of ${GROWTH_SLOTS} Growth slots — add more above, then you can upgrade to Portfolio.`
                        )}
                      </p>
                    )}
                  <Button
                    className="w-full"
                    variant={isRecommended ? "primary" : plan.popular ? "primary" : "outline"}
                    onClick={() => subscribe(plan.id)}
                    disabled={
                      !!loading ||
                      (showQuantitySelector && quantityOptions.length === 0) ||
                      requiresStarterFirst(plan.id, planInfo?.subscriptionTier ?? null) ||
                      requiresGrowthFirstOrFullSlots(
                        plan.id,
                        planInfo?.subscriptionTier ?? null,
                        planInfo?.propertyCount ?? 0
                      )
                    }
                  >
                    {loading === plan.id
                      ? "Redirecting to checkout…"
                      : requiresStarterFirst(plan.id, planInfo?.subscriptionTier ?? null)
                        ? "Starter required"
                        : requiresGrowthFirstOrFullSlots(
                              plan.id,
                              planInfo?.subscriptionTier ?? null,
                              planInfo?.propertyCount ?? 0
                            )
                          ? "Growth & 9 slots required"
                          : isUpgradeFrom(planInfo?.subscriptionTier ?? null, plan.id)
                            ? "Upgrade"
                            : "Get started"}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Performance / 4% deferred */}
        <Card className="max-w-xl mx-auto border-green-200 bg-gradient-to-br from-green-50/50 to-white mb-12">
          <CardHeader>
            <CardTitle>Performance</CardTitle>
            <CardDescription>Pay only when you save. No upfront cost.</CardDescription>
            <div className="mt-4">
              <span className="text-3xl font-bold text-gray-900">4%</span>
              <span className="text-gray-500 ml-1">of 3‑year tax savings (deferred)</span>
            </div>
            <p className="text-sm text-amber-700 mt-2 bg-amber-50 rounded px-3 py-2">
              Custom setup required — we track multi-year appeals and savings to calculate your fee. Contact us to get started.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-6">
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />Everything in full automation</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />Unlimited properties</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />No payment if no savings</li>
            </ul>
            <a
              href="mailto:support@overtaxed-il.com?subject=Performance%20plan"
              className="flex h-10 w-full items-center justify-center rounded-lg border border-green-300 bg-green-50 px-4 text-sm font-medium text-green-800 hover:bg-green-100"
            >
              Contact us to set up Performance plan
            </a>
          </CardContent>
        </Card>

        {/* Custom pricing for 20+ */}
        <Card className={`max-w-xl mx-auto border-gray-200 bg-gray-50 ${effectiveRange === "20+" ? "ring-2 ring-blue-200" : ""}`}>
          {effectiveRange === "20+" && (
            <div className="pt-4 px-6">
              <span className="inline-block rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                Recommended for you
              </span>
            </div>
          )}
          <CardHeader>
            <CardTitle>20+ properties?</CardTitle>
            <CardDescription>Custom pricing available for large portfolios.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Managing 20+ properties? We offer custom pricing tailored to your portfolio size and needs.
            </p>
            <a
              href="mailto:support@overtaxed-il.com?subject=Custom%20pricing%20for%2020%2B%20properties"
              className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
            >
              Contact us for custom pricing
            </a>
          </CardContent>
        </Card>

        <div className="mt-12 text-center text-sm text-gray-500">
          Need help choosing?{" "}
          <a href="mailto:support@overtaxed-il.com" className="text-blue-600 hover:underline">
            Contact us
          </a>
        </div>
      </main>
    </div>
  )
}
