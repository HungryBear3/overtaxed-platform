"use client"

/**
 * RavSuggestion — Data-backed suggested Requested Assessment Value (RAV).
 *
 * Formula: Cook County assessed value = 10% of market value.
 *   RAV = median(comp $/sqft) × subject living area × 0.10
 *
 * Shows low/median/high range derived from 25th / 50th / 75th percentile
 * of comp $/sqft. Confidence tier based on comp count and recency.
 */

import { useMemo } from "react"

interface Comp {
  compType: string
  pricePerSqft: number | null
  saleDate: string | null
}

interface RavSuggestionProps {
  comps: Comp[]
  subjectLivingArea: number | null
  originalAssessmentValue: number
  onUseValue: (value: number) => void
}

function getMonthsAgo(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function RavSuggestion({
  comps,
  subjectLivingArea,
  originalAssessmentValue,
  onUseValue,
}: RavSuggestionProps) {
  const analysis = useMemo(() => {
    if (!subjectLivingArea || subjectLivingArea <= 0) return null

    // Only SALES comps with a valid $/sqft
    const valid = comps.filter(
      (c) =>
        c.compType === "SALES" &&
        c.pricePerSqft != null &&
        c.pricePerSqft > 0
    )
    if (valid.length === 0) return null

    const psfs = [...valid.map((c) => c.pricePerSqft!)].sort((a, b) => a - b)
    const ages = valid.map((c) => getMonthsAgo(c.saleDate))
    const recentCount = ages.filter((a) => a !== null && a <= 18).length

    let confidence: "high" | "medium" | "low"
    if (valid.length >= 4 && recentCount >= 3) confidence = "high"
    else if (valid.length >= 2) confidence = "medium"
    else confidence = "low"

    const p25 = percentile(psfs, 25)
    const p50 = percentile(psfs, 50)
    const p75 = percentile(psfs, 75)

    // Cook County AV = 10% of market value
    const toRAV = (psf: number) =>
      Math.round(psf * subjectLivingArea * 0.1)

    const medianRAV = toRAV(p50)
    const lowRAV = Math.min(toRAV(p25), medianRAV)
    const highRAV = Math.max(toRAV(p75), medianRAV)

    // What does the current assessment imply in market $/sqft?
    const impliedPsf = originalAssessmentValue / 0.1 / subjectLivingArea

    return {
      count: valid.length,
      p25,
      p50,
      p75,
      medianRAV,
      lowRAV,
      highRAV,
      impliedPsf,
      confidence,
    }
  }, [comps, subjectLivingArea, originalAssessmentValue])

  if (!analysis) return null

  const { confidence, count, p25, p50, p75, lowRAV, highRAV, medianRAV, impliedPsf } =
    analysis

  const fmt = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(v)
  const fmtPsf = (v: number) =>
    `$${Math.round(v).toLocaleString()}/sqft`

  const badge = {
    high: {
      bg: "bg-green-50 border-green-200",
      text: "text-green-800",
      label: "High confidence",
      dot: "🟢",
    },
    medium: {
      bg: "bg-yellow-50 border-yellow-200",
      text: "text-yellow-800",
      label: "Medium confidence",
      dot: "🟡",
    },
    low: {
      bg: "bg-orange-50 border-orange-200",
      text: "text-orange-800",
      label: "Low confidence — add more comps",
      dot: "🔴",
    },
  }[confidence]

  return (
    <div className={`rounded-lg border p-4 mb-4 ${badge.bg}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-900">
              📊 Data-backed suggestion
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text}`}
            >
              {badge.dot} {badge.label}
            </span>
          </div>

          {/* Suggested range */}
          <p className="text-lg font-bold text-gray-900">
            Suggested RAV:{" "}
            <span className="text-blue-700">{fmt(lowRAV)}</span>
            {lowRAV !== highRAV && (
              <>
                {" – "}
                <span className="text-blue-700">{fmt(highRAV)}</span>
              </>
            )}
          </p>

          {/* Supporting detail */}
          <p className="text-sm text-gray-700 mt-1">
            Based on{" "}
            <strong>
              {count} comparable sale{count !== 1 ? "s" : ""}
            </strong>{" "}
            (25th–75th percentile: {fmtPsf(p25)}–{fmtPsf(p75)}, median{" "}
            {fmtPsf(p50)}). Your current assessment implies{" "}
            <span className="font-semibold text-red-700">
              {fmtPsf(impliedPsf)}
            </span>{" "}
            market value — comps support{" "}
            <span className="font-semibold text-green-700">
              {fmtPsf(p25)}–{fmtPsf(p75)}
            </span>
            .
          </p>

          {confidence === "low" && (
            <p className="text-xs text-orange-700 mt-1">
              ⚠️ Only 1 comp — add more recent sales comps to improve accuracy.
            </p>
          )}

          <p className="text-xs text-gray-500 mt-1.5">
            Formula: Cook County assessed value = 10% of market value. Median
            comp sale price is {fmtPsf(p50)} × {subjectLivingArea?.toLocaleString()} sqft ×
            0.10 = {fmt(medianRAV)}.
          </p>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={() => onUseValue(medianRAV)}
          className="shrink-0 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          Use {fmt(medianRAV)}
        </button>
      </div>
    </div>
  )
}
