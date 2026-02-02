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
    propertyLimit: "1–2 properties",
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
    propertyLimit: `${GROWTH_MIN_PROPERTIES}–${GROWTH_MAX_PROPERTIES} properties`,
    pricingNote: "Per-property pricing.",
    exampleTotals: `3 = $${growthPriceForProperties(3)}/yr · 5 = $${growthPriceForProperties(5)}/yr · 9 = $${growthPriceForProperties(9)}/yr`,
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
    propertyLimit: `${PORTFOLIO_MIN_PROPERTIES}–${PORTFOLIO_MAX_PROPERTIES} properties`,
    pricingNote: "Per-property pricing.",
    exampleTotals: `10 = $${portfolioPriceForProperties(10)}/yr · 15 = $${portfolioPriceForProperties(15)}/yr · 20 = $${portfolioPriceForProperties(20)}/yr`,
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

const RANGE_LABELS: PlanRange[] = ["1-2", "3-9", "10-20", "20+"]

function getQuantityRange(range: PlanRange): number[] {
  if (range === "1-2") return [1, 2]
  if (range === "3-9") return [3, 4, 5, 6, 7, 8, 9]
  if (range === "10-20") return [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  return []
}

function getAnnualPrice(plan: "STARTER" | "GROWTH" | "PORTFOLIO", qty: number): number {
  if (plan === "STARTER") return qty * RETAIL_PRICE_PER_PROPERTY
  if (plan === "GROWTH" && qty >= 3 && qty <= 9) return qty * GROWTH_PRICE_PER_PROPERTY
  if (plan === "PORTFOLIO" && qty >= 10 && qty <= 20) return qty * PORTFOLIO_PRICE_PER_PROPERTY
  return 0
}

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [planInfo, setPlanInfo] = useState<{
    propertyCount: number
    subscriptionTier: string | null
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
      .catch(() => setPlanInfo({ propertyCount: 0, subscriptionTier: null, recommendedPlan: null }))
  }, [])

  const planToRange: Record<string, PlanRange> = { STARTER: "1-2", GROWTH: "3-9", PORTFOLIO: "10-20", CUSTOM: "20+" }
  const effectiveRange = selectedRange ?? (planInfo?.recommendedPlan ? planToRange[planInfo.recommendedPlan] ?? "1-2" : "1-2")
  const quantityOptions = getQuantityRange(effectiveRange)

  // Reset selectedQuantity when range changes
  useEffect(() => {
    const opts = getQuantityRange(effectiveRange)
    if (opts.length > 0) {
      const currentCount = planInfo?.propertyCount ?? 0
      setSelectedQuantity(opts.includes(currentCount) ? currentCount : opts[0])
    }
  }, [effectiveRange])

  async function subscribe(plan: "STARTER" | "GROWTH" | "PORTFOLIO") {
    setLoading(plan)
    setError("")
    try {
      const qty = RANGE_TO_PLAN[effectiveRange] === plan ? selectedQuantity : (
        plan === "STARTER" ? Math.min(selectedQuantity, 2) :
        plan === "GROWTH" ? Math.max(Math.min(selectedQuantity, 9), 3) :
        Math.max(Math.min(selectedQuantity, 20), 10)
      )
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

        {/* Find your plan - property count selector */}
        <div className="mb-10 rounded-lg bg-white p-6 shadow border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Choose your plan</h2>
          <p className="text-sm text-gray-600 mb-4">
            Select how many properties you want to include — this is the quantity you&apos;ll be charged for at checkout.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {RANGE_LABELS.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => {
                  setSelectedRange(range)
                  const opts = getQuantityRange(range)
                  if (opts.length > 0) {
                    const c = planInfo?.propertyCount ?? 0
                    setSelectedQuantity(opts.includes(c) ? c : opts[0])
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  effectiveRange === range
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {range} properties
              </button>
            ))}
          </div>
          {quantityOptions.length > 0 && (
            <div className="flex items-center gap-3">
              <label htmlFor="qty" className="text-sm font-medium text-gray-700">
                Number of properties:
              </label>
              <select
                id="qty"
                value={selectedQuantity}
                onChange={(e) => setSelectedQuantity(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-900"
              >
                {quantityOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              {RANGE_TO_PLAN[effectiveRange] !== "CUSTOM" && (
                <span className="text-sm text-gray-600">
                  = ${getAnnualPrice(RANGE_TO_PLAN[effectiveRange] as "STARTER" | "GROWTH" | "PORTFOLIO", selectedQuantity).toLocaleString()}/year
                </span>
              )}
            </div>
          )}
          {planInfo && planInfo.propertyCount > 0 && (
            <p className="mt-3 text-sm text-gray-600">
              You have <strong>{planInfo.propertyCount} propert{planInfo.propertyCount === 1 ? "y" : "ies"}</strong>
              {planInfo.atLimit && " — at plan limit. Upgrade to add more."}
            </p>
          )}
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
              {planInfo && planInfo.propertyCount > 0 ? (
                <Link
                  href="/properties"
                  className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
                >
                  Pick a property & get comps ($69 each)
                </Link>
              ) : (
                <Link
                  href="/auth/signup"
                  className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
                >
                  Sign up to add properties & get comps
                </Link>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Full automation */}
        <h2 className="text-xl font-semibold text-gray-900 text-center mb-6">Full automation</h2>
        <div className="grid gap-6 md:grid-cols-3 mb-12">
          {plans.map((plan) => {
            const isRecommended = RANGE_TO_PLAN[effectiveRange] === plan.id
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
                  <ul className="mb-8 flex-1 space-y-3">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2">
                    {RANGE_TO_PLAN[effectiveRange] === plan.id && quantityOptions.length > 0 && (
                      <p className="text-xs text-gray-600 text-center">
                        {selectedQuantity} propert{selectedQuantity === 1 ? "y" : "ies"} = ${getAnnualPrice(plan.id, selectedQuantity).toLocaleString()}/year
                      </p>
                    )}
                    <Button
                      className="w-full"
                      variant={isRecommended ? "primary" : plan.popular ? "primary" : "outline"}
                      onClick={() => subscribe(plan.id)}
                      disabled={!!loading || (RANGE_TO_PLAN[effectiveRange] === plan.id && quantityOptions.length === 0)}
                    >
                      {loading === plan.id ? "Redirecting to checkout…" : isUpgradeFrom(planInfo?.subscriptionTier ?? null, plan.id) ? "Upgrade" : "Get started"}
                    </Button>
                  </div>
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
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600 mb-6">
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />Everything in full automation</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />Unlimited properties</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-green-600 shrink-0" />No payment if no savings</li>
            </ul>
            <a
              href="mailto:support@overtaxed-il.com?subject=Performance%20plan"
              className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium hover:bg-gray-50"
            >
              Contact us
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
