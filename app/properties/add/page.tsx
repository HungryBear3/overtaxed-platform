"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface PropertyPreview {
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
  neighborhood: string | null
  township: string | null
  buildingClass: string | null
  livingArea: number | null
  landSize: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  assessedTotalValue: number | null
  marketValue: number | null
}

export default function AddPropertyPage() {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [error, setError] = useState("")
  const [propertyPreview, setPropertyPreview] = useState<PropertyPreview | null>(null)
  const [step, setStep] = useState<"lookup" | "confirm">("lookup")

  // Format PIN as user types (XX-XX-XXX-XXX-XXXX)
  function handlePinChange(value: string) {
    // Remove all non-numeric characters
    const digits = value.replace(/[^0-9]/g, "")
    
    // Format with dashes
    let formatted = ""
    if (digits.length > 0) formatted += digits.slice(0, 2)
    if (digits.length > 2) formatted += "-" + digits.slice(2, 4)
    if (digits.length > 4) formatted += "-" + digits.slice(4, 7)
    if (digits.length > 7) formatted += "-" + digits.slice(7, 10)
    if (digits.length > 10) formatted += "-" + digits.slice(10, 14)
    
    setPin(formatted)
    setError("")
    setPropertyPreview(null)
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLookupLoading(true)

    try {
      const response = await fetch(`/api/properties/lookup?pin=${encodeURIComponent(pin)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Property not found")
      }

      setPropertyPreview(data.property)
      setStep("confirm")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to lookup property")
    } finally {
      setLookupLoading(false)
    }
  }

  async function handleAddProperty() {
    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Failed to add property")
      }

      router.push(`/properties/${data.property.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add property")
    } finally {
      setLoading(false)
    }
  }

  function formatCurrency(value: number | null): string {
    if (value === null) return "—"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value)
  }

  function formatNumber(value: number | null): string {
    if (value === null) return "—"
    return new Intl.NumberFormat("en-US").format(value)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/properties" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Add Property</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {step === "lookup" ? (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                Enter Your Property PIN
              </h2>
              <p className="text-gray-600 text-sm">
                Your Property Identification Number (PIN) is a 14-digit number that uniquely 
                identifies your property in Cook County. You can find it on your property 
                tax bill or reassessment notice.
              </p>
            </div>

            <form onSubmit={handleLookup}>
              <div className="mb-6">
                <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-2">
                  Property PIN
                </label>
                <input
                  type="text"
                  id="pin"
                  value={pin}
                  onChange={(e) => handlePinChange(e.target.value)}
                  placeholder="XX-XX-XXX-XXX-XXXX"
                  className="w-full px-4 py-3 text-lg text-gray-900 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono tracking-wider placeholder:text-gray-400"
                  maxLength={18} // 14 digits + 4 dashes = 18 characters
                  required
                />
                <p className="mt-2 text-xs text-gray-500">
                  Example: 16-01-216-001-0000
                </p>
              </div>

              {error && (
                <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={pin.replace(/[^0-9]/g, "").length !== 14 || lookupLoading}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {lookupLoading ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Looking up property...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Look Up Property
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-900 mb-2">
                Where to find your PIN
              </h3>
              <ul className="text-sm text-gray-600 space-y-2">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Your property tax bill (listed as "PIN" or "Parcel ID")
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Your reassessment notice from Cook County
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    The{" "}
                    <a
                      href="https://www.cookcountyassessor.com/address-search"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Cook County Assessor website
                    </a>
                    {" "}(search by address)
                  </span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Confirm Property Details
              </h2>
              <p className="text-gray-600 text-sm">
                We found your property in Cook County records. Please review the details below.
              </p>
            </div>

            {propertyPreview && (
              <div className="p-6">
                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {propertyPreview.address}
                  </h3>
                  <p className="text-gray-500">
                    {propertyPreview.city}, {propertyPreview.state} {propertyPreview.zipCode}
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    PIN: {propertyPreview.pin}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-blue-600 uppercase tracking-wide font-medium">
                      Current Assessment
                    </p>
                    <p className="text-2xl font-bold text-blue-900">
                      {formatCurrency(propertyPreview.assessedTotalValue)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">
                      Market Value
                    </p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatCurrency(propertyPreview.marketValue)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Bedrooms</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {propertyPreview.bedrooms ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Bathrooms</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {propertyPreview.bathrooms ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Living Area</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {propertyPreview.livingArea ? `${formatNumber(propertyPreview.livingArea)} sqft` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Year Built</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {propertyPreview.yearBuilt ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Neighborhood</p>
                    <p className="text-gray-900">{propertyPreview.neighborhood ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Township</p>
                    <p className="text-gray-900">{propertyPreview.township ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Building Class</p>
                    <p className="text-gray-900">{propertyPreview.buildingClass ?? "—"}</p>
                  </div>
                </div>

                {/* Note about additional data */}
                <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>
                      <span className="font-medium">More details available after adding:</span>{" "}
                      Once you add this property, you&apos;ll see full assessment history (up to 15 years), 
                      year-over-year changes, and be able to track appeals and find comparable properties.
                    </p>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setStep("lookup")
                      setPropertyPreview(null)
                    }}
                    className="flex-1 border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleAddProperty}
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Adding...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add This Property
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
