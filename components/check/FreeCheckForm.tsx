"use client"

import { useState } from "react"
import { FreeCheckResult } from "./FreeCheckResult"

type Result = {
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

export function FreeCheckForm() {
  const [pin, setPin] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [mode, setMode] = useState<"pin" | "address">("pin")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Result | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setResult(null)
    if (mode === "pin" && !pin.trim()) {
      setError("Enter your 14-digit PIN.")
      return
    }
    if (mode === "address" && address.trim().length < 5) {
      setError("Enter at least 5 characters of your street address.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/free-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "pin"
            ? { pin: pin.trim().replace(/\D/g, "") }
            : { address: address.trim(), city: city.trim() || undefined }
        ),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.")
        return
      }
      setResult(data)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => { setMode("pin"); setError(""); setResult(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "pin" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            I have my PIN
          </button>
          <button
            type="button"
            onClick={() => { setMode("address"); setError(""); setResult(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "address" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Look up by address
          </button>
        </div>

        {mode === "pin" ? (
          <div>
            <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-1">
              Cook County PIN (14 digits)
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 16-01-216-001-0000"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 14))}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Find your PIN at{" "}
              <a href="https://www.cookcountyassessor.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                cookcountyassessor.com
              </a>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
                Street address
              </label>
              <input
                id="address"
                type="text"
                placeholder="e.g. 123 Main St"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-1">
                City (optional)
              </label>
              <input
                id="city"
                type="text"
                placeholder="e.g. Chicago"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full sm:w-auto bg-blue-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Checking…" : "Check my assessment"}
        </button>
      </form>

      {result && <FreeCheckResult result={result} />}
    </div>
  )
}
