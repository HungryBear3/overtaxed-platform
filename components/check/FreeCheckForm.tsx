"use client"

import { useState, useRef, useCallback } from "react"
import type { Result } from "./FreeCheckResult"

/**
 * One public-record match offered back when an address resolves to more than
 * one parcel. Every field is already published by the Cook County Assessor
 * against that PIN; nothing here says which one is the reader's.
 */
type AddressCandidate = {
  pin: string
  address: string
  city: string
  zipCode: string
  unit: string | null
}

const ASSESSOR_ADDRESS_SEARCH_URL = "https://www.cookcountyassessoril.gov/address-search"

function isAddressCandidate(value: unknown): value is AddressCandidate {
  if (!value || typeof value !== "object") return false
  const c = value as Record<string, unknown>
  return (
    typeof c.pin === "string" && c.pin.trim() !== "" &&
    typeof c.address === "string" &&
    typeof c.city === "string" &&
    typeof c.zipCode === "string" &&
    (c.unit === null || typeof c.unit === "string")
  )
}

interface Props {
  onResult: (result: Result) => void
  onReset?: () => void
}

function formatPinDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 14)
  let formatted = ""
  if (digits.length > 0) formatted += digits.slice(0, 2)
  if (digits.length > 2) formatted += "-" + digits.slice(2, 4)
  if (digits.length > 4) formatted += "-" + digits.slice(4, 7)
  if (digits.length > 7) formatted += "-" + digits.slice(7, 10)
  if (digits.length > 10) formatted += "-" + digits.slice(10, 14)
  return formatted
}

export function FreeCheckForm({ onResult, onReset }: Props) {
  const [pin, setPin] = useState("")
  const pinInputRef = useRef<HTMLInputElement>(null)
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [mode, setMode] = useState<"pin" | "address">("pin")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // The selection step. Populated only by a 409 the route raised because it
  // refused to pick between parcels; cleared on every new submission.
  const [candidates, setCandidates] = useState<AddressCandidate[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  // True when the failure was ours — a records service we could not reach —
  // rather than a statement about the reader's address.
  const [serviceUnavailable, setServiceUnavailable] = useState(false)
  const [showAssessorFallback, setShowAssessorFallback] = useState(false)

  const handlePinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const rawValue = input.value
    const cursorPos = input.selectionStart ?? rawValue.length
    const digitsBeforeCursor = rawValue.slice(0, cursorPos).replace(/\D/g, "").length
    const formatted = formatPinDisplay(rawValue)
    setPin(formatted)
    requestAnimationFrame(() => {
      const el = pinInputRef.current
      if (!el) return
      let digitCount = 0
      let newCursor = formatted.length
      for (let i = 0; i < formatted.length; i++) {
        if (formatted[i] !== "-") digitCount++
        if (digitCount === digitsBeforeCursor) { newCursor = i + 1; break }
      }
      el.setSelectionRange(newCursor, newCursor)
    })
  }, [])

  async function runCheck(selectedPin?: string) {
    setError("")
    setServiceUnavailable(false)
    setShowAssessorFallback(false)
    if (!selectedPin) {
      setCandidates([])
      setCandidateTotal(0)
    }
    setLoading(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 28_000)
    try {
      const res = await fetch("/api/free-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "pin"
            ? { pin: pin.trim().replace(/\D/g, "") }
            : {
                address: address.trim(),
                city: city.trim() || undefined,
                ...(selectedPin ? { selectedPin } : {}),
              }
        ),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        // The route separates "we could not reach the county" from "the county
        // has no such address". They used to arrive as the same sentence, and
        // the sentence blamed the reader's address for our provider's outage.
        if (res.status === 429) {
          setError("Too many checks — please wait a minute and try again.")
        } else if (res.status === 503) {
          setServiceUnavailable(true)
          setError(data.error ?? "The Cook County records service is not responding. Please try again shortly.")
        } else if (res.status === 409 && data.code === "ADDRESS_AMBIGUOUS") {
          const offered = Array.isArray(data.candidates) ? data.candidates.filter(isAddressCandidate) : []
          if (offered.length > 0) {
            setCandidates(offered)
            setCandidateTotal(
              typeof data.candidateCount === "number" ? data.candidateCount : offered.length,
            )
            setError("")
          } else {
            setShowAssessorFallback(true)
            setError(data.error ?? "More than one Cook County property matches that address.")
          }
        } else {
          setShowAssessorFallback(Boolean(data.assessorAddressSearchUrl))
          setError(data.error ?? "Something went wrong. Please try again.")
        }
        return
      }
      setCandidates([])
      setCandidateTotal(0)
      onResult(data)
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("The request took too long. Property data may be slow — please try again.")
      } else {
        setError("Network error. Please try again.")
      }
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    onReset?.()
    if (mode === "pin" && !pin.trim()) {
      setError("Enter your 14-digit PIN.")
      return
    }
    if (mode === "address" && address.trim().length < 5) {
      setError("Enter at least 5 characters of your street address.")
      return
    }
    await runCheck()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => { setMode("pin"); setError(""); setCandidates([]); setServiceUnavailable(false); setShowAssessorFallback(false); onReset?.(); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "pin" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          I have my PIN
        </button>
        <button
          type="button"
          onClick={() => { setMode("address"); setError(""); setCandidates([]); setServiceUnavailable(false); setShowAssessorFallback(false); onReset?.(); }}
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
            ref={pinInputRef}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 16-01-216-001-0000"
            value={pin}
            onChange={handlePinChange}
            maxLength={18}
            className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono tracking-wider"
          />
          <p className="text-xs text-gray-400 mt-1">Dashes are added automatically as you type</p>
          <p className="text-xs text-gray-500 mt-1">
            Find your PIN at{" "}
            <a href="https://www.cookcountyassessoril.gov" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              cookcountyassessoril.gov
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

      {candidates.length > 0 && (
        <div
          className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3"
          role="group"
          aria-labelledby="address-selection"
        >
          <p id="address-selection" className="text-sm font-semibold text-blue-900">
            More than one Cook County property matches that address.
          </p>
          <p className="mt-1 text-xs text-blue-800">
            {candidateTotal > candidates.length
              ? `Showing ${candidates.length} of ${candidateTotal} matching parcels, as published by the Cook County Assessor. Pick yours, or enter your PIN.`
              : `These are the ${candidates.length} matching parcels as published by the Cook County Assessor. Pick yours, or enter your PIN.`}
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.pin}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => runCheck(candidate.pin.replace(/\D/g, ""))}
                  className="w-full text-left rounded-lg border border-blue-200 bg-white px-3 py-2 hover:border-blue-400 disabled:opacity-50"
                >
                  <span className="block text-sm font-medium text-gray-900">
                    {[candidate.address, candidate.unit ? `Unit ${candidate.unit}` : null]
                      .filter(Boolean)
                      .join(" · ") || "Address not on file"}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {[candidate.city, candidate.zipCode].filter(Boolean).join(" ")}
                    {candidate.city || candidate.zipCode ? " · " : ""}PIN {candidate.pin}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p
          className={`mt-4 text-sm rounded-lg px-3 py-2 border ${
            serviceUnavailable
              ? "text-amber-800 bg-amber-50 border-amber-200"
              : "text-red-600 bg-red-50 border-red-100"
          }`}
          role={serviceUnavailable ? "status" : "alert"}
        >
          {error}
          {showAssessorFallback && (
            <>
              {" "}
              <a
                href={ASSESSOR_ADDRESS_SEARCH_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                Look it up on the Assessor&apos;s address search
              </a>
              .
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-6 w-full sm:w-auto bg-blue-600 text-white font-semibold px-8 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Checking…" : "Check my assessment"}
      </button>
      <p className="mt-3 text-xs text-gray-400">
        Free · No account required · Uses public Cook County Assessor records
      </p>
    </form>
  )
}
