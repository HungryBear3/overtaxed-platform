"use client"

import { useState } from "react"
import Link from "next/link"

export type CompDetail = {
  pin: string
  address: string
  city: string
  assessedValue: number
  marketValue: number | null
  squareFeet: number | null
  yearBuilt: number | null
  propertyClass: string | null
}

export type AppealWindowStatus = {
  township: string
  status: "open" | "closed" | "unknown"
  openDate: string | null
  closeDate: string | null
  filingUrl: string
  note: string | null
}

export type PropertyCharacteristics = {
  squareFeet: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  propertyClass: string | null
  exterior: string | null
  basement: string | null
  garage: string | null
  note: string
}

export type Result = {
  subject: {
    pin: string
    address: string
    city: string
    zipCode: string
    township: string | null
    neighborhoodCode: string | null
    taxYear: number | null
    assessedTotalValue: number | null
    marketValue: number | null
  }
  compCount: number
  comps: CompDetail[]
  avgComparableAssessedValue: number | null
  equityRatio: number | null
  targetEquityRatio: number
  avgCompEquityRatio: number | null
  assessmentGap: number | null
  potentialOverpaymentPerYear: number | null
  potentialOverpayment3Year: number | null
  appealArgumentText: string | null
  appealWindowStatus: AppealWindowStatus | null
  propertyCharacteristics: PropertyCharacteristics | null
  noAssessedValue?: boolean
  message?: string
  source: string
}

interface Props {
  result: Result
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function FreeCheckResult({ result }: Props) {
  const [email, setEmail] = useState("")
  const [township, setTownship] = useState(
    result.subject.township?.replace(/\s*Township$/i, "").trim() || "Free Check"
  )
  const [saveStatus, setSaveStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [saveError, setSaveError] = useState("")
  const [showComps, setShowComps] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle")

  const MEANINGFUL_SAVINGS_THRESHOLD = 100
  const hasGap = result.avgComparableAssessedValue != null && (result.subject.assessedTotalValue ?? 0) > result.avgComparableAssessedValue
  const overpay = result.potentialOverpaymentPerYear ?? 0
  const overpay3 = result.potentialOverpayment3Year ?? 0
  const hasMeaningfulSavings = hasGap && overpay >= MEANINGFUL_SAVINGS_THRESHOLD

  async function handleSaveResults(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSaveStatus("loading")
    setSaveError("")
    try {
      const res = await fetch("/api/township-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          township: township.trim() || "Free Check",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
      setSaveStatus("success")
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Something went wrong")
      setSaveStatus("error")
    }
  }

  async function handleCopyArgument() {
    if (!result.appealArgumentText) return
    try {
      await navigator.clipboard.writeText(result.appealArgumentText)
      setCopyStatus("copied")
      setTimeout(() => setCopyStatus("idle"), 2000)
    } catch {
      // fallback: select all text in textarea
    }
  }

  const aw = result.appealWindowStatus

  return (
    <div className="space-y-6">

      {/* ── Appeal Window Banner ────────────────────────────────────────── */}
      {aw && (
        <div className={`rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
          aw.status === "open"
            ? "bg-green-50 border border-green-200"
            : aw.status === "closed"
            ? "bg-gray-50 border border-gray-200"
            : "bg-blue-50 border border-blue-200"
        }`}>
          {aw.status === "open" && (
            <>
              <div>
                <span className="inline-block bg-green-600 text-white text-xs font-bold px-2 py-0.5 rounded mr-2">OPEN NOW</span>
                <span className="text-sm font-semibold text-green-900">{aw.township} appeal window is open</span>
                {aw.closeDate && (
                  <span className="text-sm text-green-800 ml-1">· Deadline: {formatDate(aw.closeDate)}</span>
                )}
              </div>
              <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                className="inline-block bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors whitespace-nowrap">
                File your appeal now →
              </a>
            </>
          )}
          {aw.status === "closed" && (
            <div>
              <span className="text-sm font-semibold text-gray-700">{aw.township} appeal window is currently closed</span>
              {aw.openDate && (
                <span className="text-sm text-gray-600 ml-1">· Opens around {formatDate(aw.openDate)}</span>
              )}
              <p className="text-xs text-gray-500 mt-0.5">Sign up below to be notified when your window opens.</p>
            </div>
          )}
          {aw.status === "unknown" && (
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-0.5">Appeal window dates not confirmed for <strong>{aw.township}</strong></p>
              <p className="text-sm text-blue-800">Cook County opens townships on a rolling schedule and we don&apos;t have confirmed dates for your area. Check the CCAO site to find your exact window and file if it&apos;s currently open.</p>
              <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-1.5 text-sm font-semibold text-blue-700 underline hover:text-blue-900">
                Check your appeal window at CCAO →
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Main Result Card ────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-2">Your free check result</h2>

        {/* Address + property metadata chips */}
        <p className="text-sm text-gray-600 mb-1">
          {result.subject.address}, {result.subject.city} IL {result.subject.zipCode}
          {result.subject.pin && (
            <span className="block text-gray-500 mt-0.5">PIN {result.subject.pin}</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2 mb-4 text-xs text-gray-500">
          {result.subject.township && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Township: {result.subject.township}</span>
          )}
          {result.subject.neighborhoodCode && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Neighborhood code: {result.subject.neighborhoodCode}</span>
          )}
          {result.subject.taxYear && (
            <span className="bg-gray-100 rounded px-2 py-0.5">Tax year: {result.subject.taxYear}</span>
          )}
        </div>

        {/* No assessed value state */}
        {result.noAssessedValue && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-4 mb-6">
            <p className="text-sm font-semibold text-yellow-900 mb-1">Assessment not yet published</p>
            <p className="text-sm text-yellow-800">
              {result.message ?? "We found your property but the Cook County Assessor hasn't published an assessed value for this PIN yet. Visit cookcountyassessor.com to check your assessment status."}
            </p>
            <a href="https://www.cookcountyassessor.com" target="_blank" rel="noopener noreferrer"
              className="inline-block mt-3 text-sm font-semibold text-blue-700 hover:underline">
              Check your assessment at cookcountyassessor.com →
            </a>
          </div>
        )}

        {/* Savings hero */}
        {hasMeaningfulSavings && (
          <div className="text-center mb-6">
            <p className="text-3xl font-extrabold text-amber-800">Estimated savings</p>
            <p className="text-5xl font-extrabold text-amber-900 -mt-1 mb-2">
              {formatCurrency(overpay)}
              <span className="text-xl ml-1 font-semibold">/year</span>
            </p>
            {overpay3 > 0 && <p className="text-lg font-semibold text-amber-700">~{formatCurrency(overpay3)} over 3 years</p>}
            <p className="mt-4 text-gray-700 font-semibold">No lawyer required. Takes 5 minutes.</p>
            <Link href="/auth/signup"
              className="mt-6 inline-block bg-blue-600 text-white font-semibold px-8 py-4 rounded-lg hover:bg-blue-700 transition-colors text-lg">
              Start Your Appeal
            </Link>
            {aw?.status === "open" && (
              <p className="mt-3 text-sm text-gray-500">
                Or{" "}
                <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 font-semibold hover:underline">
                  file directly at CCAO
                </a>
                {" "}— free, no account needed.
              </p>
            )}
          </div>
        )}

        {/* Value cards */}
        <div className="flex flex-wrap gap-4 justify-center mb-4">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex-1 min-w-[10rem] max-w-xs">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Your assessed value</p>
            <p className="text-xl font-bold text-gray-900">
              {result.subject.assessedTotalValue != null ? formatCurrency(result.subject.assessedTotalValue) : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 flex-1 min-w-[10rem] max-w-xs">
            <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide mb-2">
              Avg of {result.compCount} nearby comp{result.compCount !== 1 ? "s" : ""}
            </p>
            <p className="text-xl font-bold text-blue-900">
              {result.avgComparableAssessedValue != null ? formatCurrency(result.avgComparableAssessedValue) : "—"}
            </p>
          </div>
          <div className={`rounded-xl border p-4 flex-1 min-w-[10rem] max-w-xs ${hasGap ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Est. overpayment</p>
            <p className={`text-xl font-bold ${hasGap ? "text-amber-800" : "text-gray-700"}`}>
              {hasGap ? `~${formatCurrency(overpay)}/year` : "—"}
            </p>
            {hasGap && overpay3 > 0 && <p className="text-sm text-amber-700 mt-1">~{formatCurrency(overpay3)} over 3 years</p>}
          </div>
        </div>

        {/* Gap context */}
        {hasMeaningfulSavings ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 mb-6">
            <p className="text-sm font-medium text-amber-900">
              Your assessment is higher than nearby comparable properties. An appeal could lower your taxes — and a win in 2026 locks in savings through 2029.
            </p>
          </div>
        ) : hasGap && !result.noAssessedValue ? (
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 mb-6">
            <p className="text-sm font-medium text-gray-700">Your assessed value is slightly above comparable properties, but the estimated difference is within normal variation and below our confidence threshold.</p>
            <p className="text-sm text-gray-600 mt-1">You can still file an appeal if you have supporting evidence — for example, errors in square footage, bedroom count, or property class.</p>
          </div>
        ) : (
          !result.noAssessedValue && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 mb-6">
              <p className="text-sm font-semibold text-green-800 mb-0.5">Your property appears fairly assessed</p>
              <p className="text-sm text-green-700">
                Your assessed value is in line with or below the average of nearby comparable properties. An appeal based on assessed value is unlikely to succeed, but you can still file if there are errors in the property details on file (square footage, bedroom count, or property class).
              </p>
            </div>
          )
        )}
      </div>

      {/* ── Equity Analysis ─────────────────────────────────────────────── */}
      {!result.noAssessedValue && result.subject.assessedTotalValue != null && result.avgComparableAssessedValue != null && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">Equity analysis</h3>
          <p className="text-sm text-gray-500 mb-4">
            Cook County&apos;s target assessment ratio is <strong>10% of market value</strong>.
            Properties assessed above 10% are strong appeal candidates.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th className="text-left pb-2 pr-4 font-semibold"></th>
                  <th className="text-right pb-2 pr-4 font-semibold">Your Property</th>
                  <th className="text-right pb-2 font-semibold">Neighborhood Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <tr>
                  <td className="py-2 pr-4 text-gray-600">Assessed value</td>
                  <td className="py-2 pr-4 text-right font-medium text-gray-900">
                    {formatCurrency(result.subject.assessedTotalValue)}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-700">
                    {formatCurrency(result.avgComparableAssessedValue)}
                  </td>
                </tr>
                {result.subject.marketValue != null && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Market value</td>
                    <td className="py-2 pr-4 text-right font-medium text-gray-900">
                      {formatCurrency(result.subject.marketValue)}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-700">—</td>
                  </tr>
                )}
                {result.equityRatio != null && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Equity ratio</td>
                    <td className="py-2 pr-4 text-right font-medium">
                      <span className={`inline-flex items-center gap-1 font-bold ${
                        result.equityRatio > 10.5 ? "text-red-700" : result.equityRatio > 10 ? "text-amber-700" : "text-green-700"
                      }`}>
                        {result.equityRatio.toFixed(1)}%
                        {result.equityRatio > 10.5 && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Over-assessed</span>}
                        {result.equityRatio > 10 && result.equityRatio <= 10.5 && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Borderline</span>}
                        {result.equityRatio <= 10 && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Fairly assessed</span>}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium text-gray-700">
                      {result.avgCompEquityRatio != null ? `${result.avgCompEquityRatio.toFixed(1)}%` : "10.0% (target)"}
                    </td>
                  </tr>
                )}
                {result.assessmentGap != null && result.assessmentGap > 0 && (
                  <tr>
                    <td className="py-2 pr-4 text-gray-600">Assessment gap</td>
                    <td className="py-2 pr-4 text-right font-bold text-amber-800" colSpan={2}>
                      +{formatCurrency(result.assessmentGap)} above neighborhood avg
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Comparable Properties ────────────────────────────────────────── */}
      {result.comps && result.comps.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <button
            onClick={() => setShowComps(!showComps)}
            className="w-full flex items-center justify-between text-left"
          >
            <h3 className="text-base font-bold text-gray-900">
              Comparable properties ({result.comps.length})
            </h3>
            <span className="text-sm text-blue-600 font-semibold">{showComps ? "Hide ↑" : "Show ↓"}</span>
          </button>
          <p className="text-sm text-gray-500 mt-1">These are the properties used to estimate your potential savings.</p>

          {showComps && (
            <div className="mt-4 space-y-3">
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                      <th className="text-left pb-2 pr-3 font-semibold">PIN</th>
                      <th className="text-left pb-2 pr-3 font-semibold">Address</th>
                      <th className="text-right pb-2 pr-3 font-semibold">Assessed Value</th>
                      <th className="text-right pb-2 pr-3 font-semibold">Sq Ft</th>
                      <th className="text-right pb-2 font-semibold">Year Built</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.comps.map((c, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 font-mono text-xs text-gray-600">{c.pin}</td>
                        <td className="py-2 pr-3 text-gray-700">{c.address ? `${c.address}${c.city ? `, ${c.city}` : ""}` : c.city || <span className="text-gray-400 italic">Address not on file</span>}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900">{formatCurrency(c.assessedValue)}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{c.squareFeet ? c.squareFeet.toLocaleString() : "—"}</td>
                        <td className="py-2 text-right text-gray-600">{c.yearBuilt ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-3">
                {result.comps.map((c, i) => (
                  <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
                    <p className="font-mono text-xs text-gray-500 mb-1">{c.pin}</p>
                    <p className="font-medium text-gray-900">{c.address ? `${c.address}${c.city ? `, ${c.city}` : ""}` : c.city || <span className="text-gray-400 italic text-xs">Address not on file</span>}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-gray-600 text-xs">
                      <span>Assessed: <strong className="text-gray-900">{formatCurrency(c.assessedValue)}</strong></span>
                      {c.squareFeet && <span>{c.squareFeet.toLocaleString()} sq ft</span>}
                      {c.yearBuilt && <span>Built {c.yearBuilt}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pre-Written Appeal Argument ──────────────────────────────────── */}
      {result.appealArgumentText && (
        <div className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-gray-900">Your appeal argument</h3>
            <button
              onClick={handleCopyArgument}
              className={`text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                copyStatus === "copied"
                  ? "bg-green-100 text-green-700"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              {copyStatus === "copied" ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            This is a starting point — you can customize it before filing with the CCAO.
          </p>
          <textarea
            readOnly
            value={result.appealArgumentText}
            className="w-full rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-800 p-3 min-h-[160px] resize-none font-mono leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/auth/signup?plan=diy"
              className="inline-flex items-center justify-center bg-blue-600 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors text-sm">
              Start Your Appeal
            </Link>
            <Link href="/pricing"
              className="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm">
              View Appeal Options
            </Link>
            {aw?.status === "open" && (
              <a href={aw.filingUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center border border-green-300 bg-green-50 text-green-700 font-semibold px-5 py-2.5 rounded-lg hover:bg-green-100 transition-colors text-sm">
                File at CCAO →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── What Happens Next (fallback CTA when no argument) ────────────── */}
      {!result.appealArgumentText && !result.noAssessedValue && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <p className="text-center font-medium text-gray-900 text-lg mb-4">What happens next</p>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 max-w-lg mx-auto mb-6">
            <li>Review your results and estimate your potential savings.</li>
            <li>Start your appeal by signing up and submitting your information.</li>
            <li>Follow the appeal process and await your assessment update.</li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <Link href="/auth/signup?plan=diy"
              className="inline-flex items-center justify-center bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors text-sm">
              Start Your Appeal
            </Link>
            <Link href="/pricing"
              className="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors text-sm">
              View Appeal Options
            </Link>
          </div>
        </div>
      )}

      {/* ── Property Characteristics on File ────────────────────────────── */}
      {result.propertyCharacteristics && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">Property details on file</h3>
          <p className="text-sm text-gray-500 mb-4">{result.propertyCharacteristics.note}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {result.propertyCharacteristics.squareFeet && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Square footage</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.squareFeet.toLocaleString()} sq ft</p>
              </div>
            )}
            {result.propertyCharacteristics.yearBuilt && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Year built</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.yearBuilt}</p>
              </div>
            )}
            {result.propertyCharacteristics.bedrooms && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Bedrooms</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.bedrooms}</p>
              </div>
            )}
            {result.propertyCharacteristics.bathrooms && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Bathrooms</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.bathrooms}</p>
              </div>
            )}
            {result.propertyCharacteristics.propertyClass && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Property class</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.propertyClass}</p>
              </div>
            )}
            {result.propertyCharacteristics.exterior && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Exterior</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.exterior}</p>
              </div>
            )}
            {result.propertyCharacteristics.basement && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Basement</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.basement}</p>
              </div>
            )}
            {result.propertyCharacteristics.garage && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-0.5">Garage</p>
                <p className="text-sm font-semibold text-gray-900">{result.propertyCharacteristics.garage}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Email capture ────────────────────────────────────────────────── */}
      <div className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Save your results and get notified when your appeal window opens
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Free. We&apos;ll email you when your township&apos;s appeal window opens and remind you 7 days before it closes.
        </p>
        {saveStatus === "success" ? (
          <p className="text-sm font-medium text-green-700">You&apos;re on the list. We&apos;ll email you when your window opens.</p>
        ) : (
          <form onSubmit={handleSaveResults} className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              value={township}
              onChange={(e) => setTownship(e.target.value)}
              placeholder="Township (optional)"
              className="sm:w-40 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={saveStatus === "loading" || !email.trim()}
              className="bg-gray-900 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              {saveStatus === "loading" ? "Saving…" : "Notify me"}
            </button>
          </form>
        )}
        {saveStatus === "error" && <p className="text-sm text-red-600 mt-2">{saveError}</p>}
      </div>

      {/* ── Source attribution ───────────────────────────────────────────── */}
      <p className="text-xs text-gray-400 text-center">
        Data source: {result.source}. Assessment data reflects public Cook County Assessor records.
        Savings estimates are based on comparable property analysis and may vary.
      </p>
    </div>
  )
}
