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
  assessmentHistory?: Array<{ taxYear: number; assessmentValue: number }>
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
  const [pendingCompsFromProperty, setPendingCompsFromProperty] = useState<{
    propertyId: string
    comps: Array<{
      pin: string
      address?: string
      city?: string
      zipCode?: string
      neighborhood?: string
      buildingClass?: string
      livingArea?: number
      yearBuilt?: number
      saleDate?: string
      salePrice?: number
      pricePerSqft?: number
    }>
  } | null>(null)
  const [townshipInfo, setTownshipInfo] = useState<{
    township: string | null
    noticeDate?: string | null
    lastFileDate?: string | null
    calendarUrl?: string
  } | null>(null)

  useEffect(() => {
    fetchProperties()
  }, [])

  // Read comps passed from property comps page (Start Appeal with These Comps)
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = sessionStorage.getItem("overtaxed_appeal_comps")
      if (!raw) {
        setPendingCompsFromProperty(null)
        return
      }
      const { propertyId: storedPropertyId, comps: storedComps } = JSON.parse(raw)
      if (storedPropertyId && Array.isArray(storedComps) && storedComps.length > 0) {
        setPendingCompsFromProperty({ propertyId: storedPropertyId, comps: storedComps })
      } else {
        setPendingCompsFromProperty(null)
      }
    } catch {
      setPendingCompsFromProperty(null)
    }
  }, [])

  // Auto-lookup township and deadlines when property is selected
  useEffect(() => {
    if (!selectedPropertyId || !properties.length) {
      setTownshipInfo(null)
      return
    }
    const prop = properties.find((p) => p.id === selectedPropertyId)
    if (!prop?.pin) {
      setTownshipInfo(null)
      return
    }
    let cancelled = false
    const pinRaw = prop.pin.replace(/\D/g, "")
    fetch(`/api/properties/lookup-deadline?pin=${encodeURIComponent(pinRaw)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setTownshipInfo({
          township: d.township ?? null,
          noticeDate: d.noticeDate ?? null,
          lastFileDate: d.lastFileDate ?? null,
          calendarUrl: d.calendarUrl,
        })
        // Auto-fill filing deadline from Assessor calendar (lastFileDate is the actual deadline)
        // Don't set noticeDate — that would trigger the 30-day calc and overwrite with notice+30
        if (d.lastFileDate && taxYear === 2025) {
          setFilingDeadline(d.lastFileDate)
        }
      })
      .catch(() => {
        if (!cancelled) setTownshipInfo({ township: null })
      })
    return () => { cancelled = true }
  }, [selectedPropertyId, properties])

  // Auto-calculate filing deadline (30 days from notice date) when user manually changes notice
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

  // Assessment for appeal: current value or history for selected tax year (condos often have value in history only)
  function getAssessmentForAppeal(prop: Property | undefined): number | null {
    if (!prop) return null
    if (prop.currentAssessmentValue && prop.currentAssessmentValue > 0) return prop.currentAssessmentValue
    const hist = prop.assessmentHistory?.find((h) => h.taxYear === taxYear)
    return hist?.assessmentValue ?? null
  }
  const effectiveAssessmentValue = getAssessmentForAppeal(selectedProperty)

  const ASSESSOR_CALENDAR_URL = "https://www.cookcountyassessoril.gov/assessment-calendar-and-deadlines"

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
      if (!effectiveAssessmentValue || effectiveAssessmentValue <= 0) {
        throw new Error(
          "No assessment value found for this property and tax year. Try refreshing property data from the property page first."
        )
      }

      const body: Record<string, unknown> = {
        propertyId: selectedPropertyId,
        taxYear,
        appealType,
        originalAssessmentValue: effectiveAssessmentValue,
        noticeDate: noticeDate ? new Date(noticeDate).toISOString() : undefined,
        filingDeadline: new Date(filingDeadline).toISOString(),
        notes: notes || undefined,
      }
      const compsToAdd = pendingCompsFromProperty?.propertyId === selectedPropertyId ? pendingCompsFromProperty.comps : []
      if (compsToAdd.length > 0) {
        body.comps = compsToAdd.map((c) => ({
          pin: c.pin,
          address: c.address ?? "",
          city: c.city ?? "",
          zipCode: c.zipCode ?? "",
          neighborhood: c.neighborhood ?? undefined,
          buildingClass: c.buildingClass ?? undefined,
          livingArea: c.livingArea ?? undefined,
          yearBuilt: c.yearBuilt ?? undefined,
          bedrooms: (c as { bedrooms?: number | null }).bedrooms ?? undefined,
          bathrooms: (c as { bathrooms?: number | null }).bathrooms ?? undefined,
          salePrice: c.salePrice ?? undefined,
          saleDate: c.saleDate ?? undefined,
          pricePerSqft: c.pricePerSqft ?? undefined,
          distanceFromSubject: (c as { distanceFromSubject?: number | null }).distanceFromSubject ?? undefined,
          compType: "SALES" as const,
        }))
      }
      const response = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create appeal")
      }

      sessionStorage.removeItem("overtaxed_appeal_comps")
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
    if (!effectiveAssessmentValue) return null
    const taxRate = selectedProperty?.taxRate || 0.075
    const equalizer = selectedProperty?.stateEqualizer || 3.0355
    return effectiveAssessmentValue * reductionPercent * equalizer * taxRate
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
            {/* Comps from property page — only when this property was the one we came from */}
            {pendingCompsFromProperty && pendingCompsFromProperty.propertyId === selectedPropertyId && pendingCompsFromProperty.comps.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="font-medium text-green-900 mb-1">
                  {pendingCompsFromProperty.comps.length} comps from the property page will be added to this appeal
                </p>
                <p className="text-sm text-green-800">
                  When you click Create Appeal below, all {pendingCompsFromProperty.comps.length} comparable properties will be attached automatically. Next: set your requested value on the appeal page, then download your summary and forms.
                </p>
              </div>
            )}

            {/* Guidance: select a property first */}
            {!selectedPropertyId && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-medium text-amber-900">
                  Select a property below to start an appeal. You can also go to <Link href="/properties" className="underline font-medium">Properties</Link>, open a property, and click <strong>Start Appeal</strong> to open this page with that property already selected.
                </p>
              </div>
            )}

            {/* Step-by-step guide */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="font-medium text-blue-900 mb-2">How to start an appeal (3 steps)</p>
              <ol className="text-sm text-blue-800 space-y-1">
                <li><strong>1. Select a property</strong> below — choose the one you want to appeal</li>
                <li><strong>2. Choose appeal type</strong> — filing deadline is auto-filled when we find your township, or enter from your notice</li>
                <li><strong>3. Click Create Appeal</strong> — {pendingCompsFromProperty?.propertyId === selectedPropertyId && (pendingCompsFromProperty?.comps.length ?? 0) > 0 ? "your comps will be added automatically, then " : ""}set requested value and download forms on the appeal page</li>
              </ol>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Tip: direct to comps when property selected but no comps yet */}
            {selectedPropertyId && (!pendingCompsFromProperty || pendingCompsFromProperty.propertyId !== selectedPropertyId) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-medium text-amber-900 mb-1">Stronger appeal with comparables</p>
                <p className="text-sm text-amber-800">
                  For best results, pick comparables first:{" "}
                  <Link href={`/properties/${selectedPropertyId}/comps`} className="underline font-medium">
                    View comps for this property
                  </Link>
                  . On that page, choose your comps and click <strong>Start Appeal with These Comps</strong> to return here with them attached. You can also add comps after creating the appeal.
                </p>
              </div>
            )}

            {/* Property Selection */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Step 1: Select Property</h2>
              <p className="text-sm text-gray-500 mb-4">Choose the property you want to appeal — this must be selected before you can create an appeal.</p>
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

            {/* Potential Savings Preview — show when we have any assessment (current or from history for selected tax year) */}
            {effectiveAssessmentValue && effectiveAssessmentValue > 0 && (
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
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Step 2: Appeal Details</h2>
              <p className="text-sm text-gray-500 mb-4">Select tax year, appeal type, and enter your filing deadline (required).</p>
              
              <div className="mb-4">
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

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Appeal Type
                </label>
                <div className="space-y-3">
                  <label
                    className={`block p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      appealType === "ASSESSOR"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="appealType"
                      value="ASSESSOR"
                      checked={appealType === "ASSESSOR"}
                      onChange={(e) => setAppealType(e.target.value as "ASSESSOR" | "BOARD_REVIEW")}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Assessor&apos;s Office Appeal</p>
                        <p className="text-sm text-gray-500 mt-1">
                          First-level appeal filed directly with the Cook County Assessor. 
                          This is the fastest option and typically resolves within 30-60 days. 
                          <strong className="text-gray-700"> Recommended for most homeowners.</strong>
                        </p>
                      </div>
                      {appealType === "ASSESSOR" && (
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </label>
                  
                  <label
                    className={`block p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                      appealType === "BOARD_REVIEW"
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="appealType"
                      value="BOARD_REVIEW"
                      checked={appealType === "BOARD_REVIEW"}
                      onChange={(e) => setAppealType(e.target.value as "ASSESSOR" | "BOARD_REVIEW")}
                      className="sr-only"
                    />
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">Board of Review Appeal</p>
                        <p className="text-sm text-gray-500 mt-1">
                          Second-level appeal filed after Assessor&apos;s decision, or if you missed the Assessor deadline. 
                          Takes longer (60-120 days) but provides a fresh review. 
                          <strong className="text-gray-700"> Use if you disagree with Assessor&apos;s decision.</strong>
                        </p>
                      </div>
                      {appealType === "BOARD_REVIEW" && (
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              {/* Township / Deadline — auto-looked up when property selected */}
              {selectedProperty && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm flex-1">
                      <p className="font-medium text-amber-800">Filing Deadline</p>
                      <p className="text-amber-700 mt-1">
                        Cook County reassesses on a 3-year cycle by township. We look up your township from your PIN and auto-fill the deadline when available (2025 calendar).
                      </p>
                      {townshipInfo ? (
                        <p className="text-amber-700 mt-2">
                          {townshipInfo.township ? (
                            <>
                              Your township: <strong>{townshipInfo.township}</strong>
                              {townshipInfo.lastFileDate && " — deadline auto-filled above."}{" "}
                              {townshipInfo.noticeDate && townshipInfo.lastFileDate && taxYear === 2025 && (
                                <span className="block mt-2 text-amber-800 font-medium">
                                  ✓ Synced with Cook County calendar: Notice {new Date(townshipInfo.noticeDate).toLocaleDateString("en-US")}, Last file {new Date(townshipInfo.lastFileDate).toLocaleDateString("en-US")}
                                </span>
                              )}
                            </>
                          ) : (
                            "Township could not be looked up. "
                          )}
                          <a
                            href={townshipInfo.calendarUrl || ASSESSOR_CALENDAR_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            View appeal calendar by township
                          </a>
                        </p>
                      ) : (
                        <p className="text-amber-700 mt-2">
                          Looking up township…
                        </p>
                      )}
                      <p className="text-amber-700 mt-2">
                        Or enter your notice date (30-day deadline auto-calculates) or check your notice letter.
                      </p>
                    </div>
                  </div>
                </div>
              )}

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
                    Date printed on your reassessment notice
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
                    {noticeDate 
                      ? "Auto-calculated: 30 days from notice date" 
                      : "Check your notice or Assessor's website"}
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
                  <p className="font-medium mb-2">What happens next?</p>
                  <ol className="space-y-2 text-blue-700">
                    <li className="flex gap-2">
                      <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                      <span><strong>Analysis:</strong> We find comparable properties that sold for less to support your case</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                      <span><strong>Forms:</strong> We generate Rule 15-compliant appeal forms with evidence packet</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                      <span><strong>Filing:</strong> Submit at the Cook County Assessor portal (we’ll link you). We cannot file on your behalf yet because the Cook County Assessor has not released a public API; we will add this when it is available.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="bg-blue-200 text-blue-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                      <span><strong>Track:</strong> Monitor your appeal status and receive updates until decision</span>
                    </li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex flex-col gap-3">
              {(!selectedPropertyId || !filingDeadline || !effectiveAssessmentValue) && !submitting && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {!selectedPropertyId
                    ? "Select a property above to enable Create Appeal."
                    : !effectiveAssessmentValue
                      ? (selectedPropertyId && (
                          <>
                            No assessment value for this property and tax year.{" "}
                            <Link href={`/properties/${selectedPropertyId}/refresh`} className="font-medium underline hover:text-amber-800">
                              Refresh property data
                            </Link>
                            {" "}or try a different tax year.
                          </>
                        )) || "No assessment value. Select a property and refresh its data."
                      : "Enter a filing deadline (or notice date for auto-calculation) to enable Create Appeal."}
                </p>
              )}
              <div className="flex gap-3">
                <Link
                  href="/appeals"
                  className="flex-1 text-center border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={!selectedPropertyId || !filingDeadline || !effectiveAssessmentValue || submitting}
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
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
