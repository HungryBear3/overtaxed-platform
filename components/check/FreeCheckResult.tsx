"use client"

import { useState } from "react"
import Link from "next/link"

export type Result = {
  subject: {
    pin: string
    address: string
    city: string
    zipCode: string
    township: string | null
    assessedTotalValue: number
    marketValue: number | null
  }
  compCount: number
  avgComparableAssessedValue: number | null
  potentialOverpaymentPerYear: number | null
  potentialOverpayment3Year: number | null
  source: string
}

interface Props {
  result: Result
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
}

export function FreeCheckResult({ result }: Props) {
  const [email, setEmail] = useState("")
  const [township, setTownship] = useState(
    result.subject.township?.replace(/\s*Township$/i, "").trim() || "Free Check"
  )
  const [saveStatus, setSaveStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [saveError, setSaveError] = useState("")

  const hasGap = result.avgComparableAssessedValue != null && result.subject.assessedTotalValue > result.avgComparableAssessedValue
  const overpay = result.potentialOverpaymentPerYear ?? 0
  const overpay3 = result.potentialOverpayment3Year ?? 0

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

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Your free check result</h2>
        <p className="text-sm text-gray-600 mb-4">
          {result.subject.address}, {result.subject.city} IL {result.subject.zipCode}
          {result.subject.pin && (
            <span className="block text-gray-500 mt-1">PIN {result.subject.pin}</span>
          )}
        </p>

        {hasGap && overpay > 0 && (
          <div className="text-center mb-6">
            <p className="text-3xl font-extrabold text-amber-800">Estimated savings</p>
            <p className="text-5xl font-extrabold text-amber-900 -mt-1 mb-2">
              {formatCurrency(overpay)}
              <span className="text-xl ml-1 font-semibold">/year</span>
            </p>
            {overpay3 > 0 && <p className="text-lg font-semibold text-amber-700">~{formatCurrency(overpay3)} over 3 years</p>}
            <p className="mt-4 text-gray-700 font-semibold">No lawyer required. Takes 5 minutes.</p>
            <Link
              href="/auth/signup"
              className="mt-6 inline-block bg-blue-600 text-white font-semibold px-8 py-4 rounded-lg hover:bg-blue-700 transition-colors text-lg"
            >
              Start Your Appeal
            </Link>
          </div>
        )}

        <div className="flex flex-wrap gap-4 justify-center">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 flex-1 min-w-[10rem] max-w-xs">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Your assessed value</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(result.subject.assessedTotalValue)}</p>
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
            <p className={`text-xl font-bold ${hasGap ? "text-amber-800" : "text-gray-700"}`}>{hasGap ? `~${formatCurrency(overpay)}/year` : "—"}</p>
            {hasGap && overpay3 > 0 && <p className="text-sm text-amber-700 mt-1">~{formatCurrency(overpay3)} over 3 years</p>}
          </div>
        </div>

        {hasGap ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 mb-6">
            <p className="text-sm font-medium text-amber-900">
              Your assessment is higher than nearby comparable properties. An appeal could lower your taxes — and a win in 2026 locks in savings through 2029.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 mb-6">
            <p className="text-sm text-gray-700">
              Your assessed value is in line with or below the average of nearby properties. You can still appeal if you have evidence of over-assessment.
            </p>
          </div>
        )}

        <div className="mb-6">
          <p className="text-center font-medium text-gray-900 text-lg mb-4">What happens next</p>
          <ol className="list-decimal list-inside space-y-3 text-gray-700 max-w-lg mx-auto">
            <li>Review your results and estimate your potential savings.</li>
            <li>Start your appeal by signing up and submitting your information.</li>
            <li>Follow the appeal process and await your assessment update.</li>
          </ol>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/auth/signup?plan=diy"
            className="inline-flex items-center justify-center bg-blue-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            DIY Plan — $169
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-700 font-semibold px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            Full Service — $149/property
          </Link>
        </div>
      </div>

      {/* Email capture: save results + notify when township opens */}
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
    </div>
  )
}
