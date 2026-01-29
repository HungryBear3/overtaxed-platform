"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

interface Property {
  id: string
  pin: string
  address: string
  city: string
  state: string
  county: string
  currentAssessmentValue: number | null
  currentMarketValue: number | null
  taxCode: string | null
  taxRate: number | null
  stateEqualizer: number | null
}

export default function NewAppealPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedPropertyId = searchParams.get("propertyId")

  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Form state
  const [selectedPropertyId, setSelectedPropertyId] = useState(preselectedPropertyId || "")
  const [taxYear, setTaxYear] = useState(new Date().getFullYear())
  const [appealType, setAppealType] = useState<"ASSESSOR" | "BOARD_REVIEW">("ASSESSOR")
  const [noticeDate, setNoticeDate] = useState("")
  const [filingDeadline, setFilingDeadline] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    fetchProperties()
  }, [])

  // Auto-calculate filing deadline (30 days from notice date)
  useEffect(() => {
    if (noticeDate) {
      const notice = new Date(noticeDate)
      const deadline = new Date(notice)
      deadline.setDate(deadline.getDate() + 30)
      setFilingDeadline(deadline.toISOString().split("T")[0])
    }
  }, [noticeDate])

  async function fetchProperties() {
    try {
      const response = await fetch("/api/properties")
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Failed to fetch properties")
      }

      setProperties(data.properties)
      
      // If preselected property, verify it exists
      if (preselectedPropertyId && !data.properties.find((p: Property) => p.id === preselectedPropertyId)) {
        setSelectedPropertyId("")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties")
    } finally {
      setLoading(false)
    }
  }

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      if (!selectedPropertyId) {
        throw new Error("Please select a property")
      }
      if (!filingDeadline) {
        throw new Error("Filing deadline is required")
      }
      if (!selectedProperty?.currentAssessmentValue) {
        throw new Error("Selected property has no assessment value")
      }

      const response = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: selectedPropertyId,
          taxYear,
          appealType,
          originalAssessmentValue: selectedProperty.currentAssessmentValue,
          noticeDate: noticeDate ? new Date(noticeDate).toISOString() : undefined,
          filingDeadline: new Date(filingDeadline).toISOString(),
          notes: notes || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create appeal")
      }

      router.push(`/appeals/${data.appeal.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create appeal")
    } finally {
      setSubmitting(false)
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

  // Calculate potential savings
  function calculatePotentialSavings(reductionPercent: number): number | null {
    if (!selectedProperty?.currentAssessmentValue) return null
    const taxRate = selectedProperty.taxRate || 0.075
    const equalizer = selectedProperty.stateEqualizer || 3.0355
    return selectedProperty.currentAssessmentValue * reductionPercent * equalizer * taxRate
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/appeals" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Start New Appeal</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {properties.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No properties yet</h3>
            <p className="text-gray-500 mb-6">
              You need to add a property before you can start an appeal.
            </p>
            <Link
              href="/properties/add"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
            >
              Add Your First Property
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Property Selection */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Property</h2>
              <div className="space-y-3">
                {properties.map((property) => (
                  <label
                    key={property.id}
                    className={`block p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      selectedPropertyId === property.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="property"
                      value={property.id}
                      checked={selectedPropertyId === property.id}
                      onChange={(e) => setSelectedPropertyId(e.target.value)}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{property.address}</p>
                        <p className="text-sm text-gray-500">
                          {property.city}, {property.state} • PIN: {property.pin}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Assessment</p>
                        <p className="font-medium text-gray-900">
                          {formatCurrency(property.currentAssessmentValue)}
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Potential Savings Preview */}
            {selectedProperty?.currentAssessmentValue && (
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow p-6 border border-green-200">
                <h2 className="text-lg font-semibold text-green-900 mb-3">Potential Annual Savings</h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase">10% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calculatePotentialSavings(0.10))}
                    </p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase">15% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calculatePotentialSavings(0.15))}
                    </p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase">20% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calculatePotentialSavings(0.20))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Appeal Details */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Appeal Details</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tax Year
                  </label>
                  <select
                    value={taxYear}
                    onChange={(e) => setTaxYear(parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {[0, 1, 2].map((offset) => {
                      const year = new Date().getFullYear() - offset
                      return (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Appeal Type
                  </label>
                  <select
                    value={appealType}
                    onChange={(e) => setAppealType(e.target.value as "ASSESSOR" | "BOARD_REVIEW")}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="ASSESSOR">Assessor&apos;s Office</option>
                    <option value="BOARD_REVIEW">Board of Review</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notice Date <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={noticeDate}
                    onChange={(e) => setNoticeDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Date you received the reassessment notice
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Filing Deadline *
                  </label>
                  <input
                    type="date"
                    value={filingDeadline}
                    onChange={(e) => setFilingDeadline(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Usually 30 days from notice date
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any notes about this appeal..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">What happens next?</p>
                  <ul className="space-y-1 text-blue-700">
                    <li>• We&apos;ll gather comparable properties to support your appeal</li>
                    <li>• Generate appeal forms ready for filing</li>
                    <li>• Track your appeal status through the process</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3">
              <Link
                href="/appeals"
                className="flex-1 text-center border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={!selectedPropertyId || !filingDeadline || submitting}
                className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Appeal"
                )}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
