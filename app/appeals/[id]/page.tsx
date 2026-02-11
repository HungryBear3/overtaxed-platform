"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AddCompsDialog } from "@/components/appeals/add-comps-dialog"
import { PdfDownloadButton } from "@/components/appeals/pdf-download-button"

interface Appeal {
  id: string
  propertyId: string
  property: {
    id: string
    pin: string
    address: string
    city: string
    state: string
    zipCode: string
    county: string
    neighborhood: string | null
    buildingClass: string | null
    livingArea: number | null
    yearBuilt: number | null
    currentAssessmentValue: number | null
    currentMarketValue: number | null
    taxCode: string | null
    taxRate: number | null
    stateEqualizer: number | null
    assessmentHistory?: Array<{
      taxYear: number
      assessmentValue: number
      changeAmount: number | null
      changePercent: number | null
    }>
  }
  taxYear: number
  status: string
  appealType: string
  filingMethod: string
  originalAssessmentValue: number
  requestedAssessmentValue: number | null
  finalAssessmentValue: number | null
  outcome: string | null
  reductionAmount: number | null
  reductionPercent: number | null
  taxSavings: number | null
  taxRate: number | null
  equalizationFactor: number | null
  noticeDate: string | null
  filingDeadline: string
  filedAt: string | null
  decisionDate: string | null
  hearingScheduled: boolean
  hearingDate: string | null
  hearingLocation: string | null
  evidenceSummary: string | null
  notes: string | null
  documents: Array<{
    id: string
    documentType: string
    fileName: string
    fileUrl: string
    fileSize: number | null
    createdAt: string
  }>
  compsUsed: Array<{
    id: string
    pin: string
    address: string
    compType: string
    neighborhood: string | null
    buildingClass: string | null
    livingArea: number | null
    yearBuilt: number | null
    bedrooms: number | null
    bathrooms: number | null
    salePrice: number | null
    saleDate: string | null
    pricePerSqft: number | null
    assessedMarketValue: number | null
    assessedMarketValuePerSqft: number | null
    distanceFromSubject: number | null
  }>
  relatedAppeals: Array<{
    id: string
    taxYear: number
    status: string
    outcome: string | null
    taxSavings: number | null
  }>
  createdAt: string
  updatedAt: string
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_FILING: "bg-yellow-100 text-yellow-700",
  FILED: "bg-blue-100 text-blue-700",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  HEARING_SCHEDULED: "bg-purple-100 text-purple-700",
  DECISION_PENDING: "bg-orange-100 text-orange-700",
  APPROVED: "bg-green-100 text-green-700",
  PARTIALLY_APPROVED: "bg-green-100 text-green-700",
  DENIED: "bg-red-100 text-red-700",
  WITHDRAWN: "bg-gray-100 text-gray-500",
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_FILING: "Pending Filing",
  FILED: "Filed",
  UNDER_REVIEW: "Under Review",
  HEARING_SCHEDULED: "Hearing Scheduled",
  DECISION_PENDING: "Decision Pending",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Partially Approved",
  DENIED: "Denied",
  WITHDRAWN: "Withdrawn",
}

const APPEAL_TYPE_LABELS: Record<string, string> = {
  ASSESSOR: "Assessor's Office",
  BOARD_REVIEW: "Board of Review",
  CERTIFICATE_ERROR: "Certificate of Error",
}

export default function AppealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [appeal, setAppeal] = useState<Appeal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [updating, setUpdating] = useState(false)
  const [showAddComps, setShowAddComps] = useState(false)
  const [editingRequested, setEditingRequested] = useState(false)
  const [requestedInput, setRequestedInput] = useState("")
  const [savingRequested, setSavingRequested] = useState(false)
  const [mapData, setMapData] = useState<{
    subject: { lat: number; lng: number; address: string } | null
    comps: Array<{ pin: string; address: string; lat: number; lng: number } | null>
  } | null>(null)
  const [mapAvailable, setMapAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    fetchAppeal()
  }, [id])

  useEffect(() => {
    if (!appeal?.id) {
      setMapData(null)
      return
    }
    let cancelled = false
    fetch(`/api/map/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setMapAvailable(!!data?.available)
      })
      .catch(() => {
        if (!cancelled) setMapAvailable(false)
      })
    fetch(`/api/appeals/${id}/map-data`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.success) return
        setMapData({ subject: data.subject ?? null, comps: data.comps ?? [] })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, appeal?.id])

  async function fetchAppeal() {
    try {
      const response = await fetch(`/api/appeals/${id}`)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Failed to fetch appeal")
      }

      setAppeal(data.appeal)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appeal")
    } finally {
      setLoading(false)
    }
  }

  async function updateRequestedValue() {
    if (!appeal) return
    const num = requestedInput.trim() ? parseInt(requestedInput.replace(/[^0-9]/g, ""), 10) : null
    if (num == null || num < 1) {
      setError("Enter a valid requested assessment value (whole number).")
      return
    }
    if (num >= appeal.originalAssessmentValue) {
      setError("Requested value should be lower than the original assessment to support a reduction.")
      return
    }
    setSavingRequested(true)
    setError("")
    try {
      const response = await fetch(`/api/appeals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedAssessmentValue: num }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to update")
      setAppeal({ ...appeal, requestedAssessmentValue: num })
      setEditingRequested(false)
      setRequestedInput("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save requested value")
    } finally {
      setSavingRequested(false)
    }
  }

  async function updateStatus(newStatus: string) {
    if (!appeal) return
    setUpdating(true)

    try {
      const response = await fetch(`/api/appeals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to update appeal")
      }

      setAppeal({ ...appeal, status: newStatus })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update appeal")
    } finally {
      setUpdating(false)
    }
  }

  async function deleteAppeal() {
    if (!confirm("Are you sure you want to delete this draft appeal?")) return
    
    try {
      const response = await fetch(`/api/appeals/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to delete appeal")
      }

      router.push("/appeals")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete appeal")
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

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—"
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  function formatNumber(value: number | null): string {
    if (value === null) return "—"
    return new Intl.NumberFormat("en-US").format(value)
  }

  // Calculate potential savings
  function calculatePotentialSavings(reductionPercent: number): number | null {
    if (!appeal) return null
    const taxRate = appeal.taxRate || appeal.property.taxRate || 0.075
    const equalizer = appeal.equalizationFactor || appeal.property.stateEqualizer || 3.0355
    return appeal.originalAssessmentValue * reductionPercent * equalizer * taxRate
  }

  // Days until deadline
  function daysUntilDeadline(): number | null {
    if (!appeal) return null
    const deadline = new Date(appeal.filingDeadline)
    const now = new Date()
    const diff = deadline.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error || !appeal) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-md">
          <svg className="w-16 h-16 mx-auto text-red-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Appeal not found</h2>
          <p className="text-gray-500 mb-6">{error || "The appeal you're looking for doesn't exist."}</p>
          <Link
            href="/appeals"
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
          >
            Back to Appeals
          </Link>
        </div>
      </div>
    )
  }

  const daysLeft = daysUntilDeadline()
  const isUrgent = daysLeft !== null && daysLeft <= 7 && daysLeft > 0
  const isPastDeadline = daysLeft !== null && daysLeft < 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/appeals" className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {appeal.taxYear} Appeal
                </h1>
                <p className="text-sm text-gray-500">
                  {appeal.property.address}, {appeal.property.city}
                </p>
              </div>
            </div>
            <span className={`px-4 py-2 rounded-full text-sm font-medium ${STATUS_COLORS[appeal.status]}`}>
              {STATUS_LABELS[appeal.status]}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Deadline Alert */}
        {appeal.status === "DRAFT" && (
          <div className={`mb-6 rounded-lg p-4 ${
            isPastDeadline 
              ? "bg-red-50 border border-red-200" 
              : isUrgent 
                ? "bg-yellow-50 border border-yellow-200"
                : "bg-blue-50 border border-blue-200"
          }`}>
            <div className="flex items-center gap-3">
              <svg className={`w-5 h-5 ${isPastDeadline ? "text-red-600" : isUrgent ? "text-yellow-600" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className={isPastDeadline ? "text-red-800" : isUrgent ? "text-yellow-800" : "text-blue-800"}>
                {isPastDeadline ? (
                  <p className="font-medium">Filing deadline has passed</p>
                ) : (
                  <>
                    <p className="font-medium">
                      {daysLeft} day{daysLeft !== 1 ? "s" : ""} until filing deadline
                    </p>
                    <p className="text-sm">Deadline: {formatDate(appeal.filingDeadline)}</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Assessment Values */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Assessment Values</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Original</p>
                  <p className="text-xl font-bold text-gray-900">
                    {formatCurrency(appeal.originalAssessmentValue)}
                  </p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-xs text-blue-600 uppercase tracking-wide">Requested</p>
                  <p className="text-xl font-bold text-blue-900">
                    {appeal.requestedAssessmentValue 
                      ? formatCurrency(appeal.requestedAssessmentValue)
                      : "Not set"}
                  </p>
                </div>
                <div className={`rounded-lg p-4 ${appeal.finalAssessmentValue ? "bg-green-50" : "bg-gray-50"}`}>
                  <p className={`text-xs uppercase tracking-wide ${appeal.finalAssessmentValue ? "text-green-600" : "text-gray-500"}`}>
                    Final
                  </p>
                  <p className={`text-xl font-bold ${appeal.finalAssessmentValue ? "text-green-900" : "text-gray-400"}`}>
                    {appeal.finalAssessmentValue 
                      ? formatCurrency(appeal.finalAssessmentValue)
                      : "Pending"}
                  </p>
                </div>
              </div>

              {/* Set requested assessment value — required for PDF download */}
              {(appeal.status === "DRAFT" || appeal.status === "PENDING_FILING") && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  {/* Assessment history context */}
                  {(appeal.property.assessmentHistory?.length ?? 0) > 0 && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">Assessment history (this property)</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-500 border-b border-gray-200">
                              <th className="py-1 pr-3">Tax year</th>
                              <th className="py-1 pr-3">Assessed value</th>
                              <th className="py-1">Change</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(appeal.property.assessmentHistory ?? []).map((ah) => {
                              const unavailable = ah.assessmentValue == null || ah.assessmentValue === 0
                              return (
                                <tr key={ah.taxYear} className="border-b border-gray-100">
                                  <td className="py-1.5 pr-3 font-medium">{ah.taxYear}</td>
                                  <td className="py-1.5 pr-3">{unavailable ? <span className="text-gray-500">Not available yet</span> : formatCurrency(ah.assessmentValue)}</td>
                                  <td className="py-1.5">
                                    {unavailable ? (
                                      <span className="text-gray-500">—</span>
                                    ) : ah.changePercent != null ? (
                                      <span className={ah.changePercent > 0 ? "text-red-600" : ah.changePercent < 0 ? "text-green-600" : "text-gray-500"}>
                                        {ah.changePercent > 0 ? "+" : ""}{ah.changePercent.toFixed(1)}%
                                      </span>
                                    ) : "—"}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <p className="text-sm font-medium text-gray-700 mb-1">
                    Requested assessment value is required before you can download your appeal summary PDF.
                  </p>
                  <p className="text-sm text-gray-600 mb-3">
                    Choose a value <strong>lower than the current assessment</strong> that your comparable sales support. Use your comps’ sale prices and $/sq ft to justify the number. Typical reductions are 10–20%. Enter a whole number (no commas).
                  </p>
                  {editingRequested || !appeal.requestedAssessmentValue ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="requested-value" className="sr-only">Requested assessment value</label>
                      <input
                        id="requested-value"
                        type="text"
                        inputMode="numeric"
                        placeholder="e.g. 250000"
                        value={requestedInput || (appeal.requestedAssessmentValue ?? "")}
                        onChange={(e) => setRequestedInput(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 w-36 text-lg font-semibold"
                      />
                      <span className="text-gray-500 text-sm">(must be less than original {formatCurrency(appeal.originalAssessmentValue)})</span>
                      <button
                        type="button"
                        onClick={updateRequestedValue}
                        disabled={savingRequested}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingRequested ? "Saving…" : "Save requested value"}
                      </button>
                      {appeal.requestedAssessmentValue && (
                        <button
                          type="button"
                          onClick={() => { setEditingRequested(false); setRequestedInput(""); setError(""); }}
                          className="px-3 py-2 text-gray-600 hover:text-gray-800"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">Requested value: <strong>{formatCurrency(appeal.requestedAssessmentValue)}</strong></span>
                      <button
                        type="button"
                        onClick={() => { setEditingRequested(true); setRequestedInput(String(appeal.requestedAssessmentValue)); }}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Change
                      </button>
                    </div>
                  )}
                </div>
              )}

              {appeal.outcome && appeal.reductionAmount && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Reduction Achieved</p>
                      <p className="text-lg font-semibold text-green-600">
                        {formatCurrency(appeal.reductionAmount)} ({appeal.reductionPercent?.toFixed(1)}%)
                      </p>
                    </div>
                    {appeal.taxSavings && (
                      <div className="text-right">
                        <p className="text-sm text-gray-500">Annual Tax Savings</p>
                        <p className="text-lg font-semibold text-green-600">
                          {formatCurrency(appeal.taxSavings)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Potential Savings (if no outcome yet) */}
            {!appeal.outcome && (
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

            {/* Property Details */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Property Details</h2>
                <Link
                  href={`/properties/${appeal.property.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  View Property →
                </Link>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">PIN</p>
                  <p className="font-medium text-gray-900">{appeal.property.pin}</p>
                </div>
                <div>
                  <p className="text-gray-500">Neighborhood</p>
                  <p className="font-medium text-gray-900">{appeal.property.neighborhood || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Living Area</p>
                  <p className="font-medium text-gray-900">
                    {appeal.property.livingArea ? `${formatNumber(appeal.property.livingArea)} sqft` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Year Built</p>
                  <p className="font-medium text-gray-900">{appeal.property.yearBuilt || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Building Class</p>
                  <p className="font-medium text-gray-900">{appeal.property.buildingClass || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Tax Code</p>
                  <p className="font-medium text-gray-900">{appeal.property.taxCode || "—"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Tax Rate</p>
                  <p className="font-medium text-gray-900">
                    {appeal.property.taxRate ? `${(appeal.property.taxRate * 100).toFixed(2)}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">State Equalizer</p>
                  <p className="font-medium text-gray-900">
                    {appeal.property.stateEqualizer?.toFixed(4) || "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Map & building photos (requires GOOGLE_MAPS_API_KEY) */}
            {(appeal.compsUsed.length > 0 || mapData?.subject) && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Map & building photos</h2>
                {mapAvailable === false ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p className="font-medium">Map and building photos are not available.</p>
                    <p className="mt-1">
                      Add <code className="bg-amber-100 px-1 rounded">GOOGLE_MAPS_API_KEY</code> to your environment (and enable Maps Static API and Street View Static API in Google Cloud Console) to show the map and Street View images.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 mb-3">
                      Subject (red S) and comparable locations. Building images from Google Street View. Map data © Google.
                    </p>
                    <div className="space-y-4">
                      <div className="rounded-lg overflow-hidden border border-gray-200">
                        <img
                          src={`/api/appeals/${appeal.id}/map-image`}
                          alt="Subject and comps map"
                          className="w-full h-auto min-h-[200px] bg-gray-100"
                        />
                        <p className="mt-2 text-xs text-gray-500">
                          <strong>S</strong> = your property. <strong>1, 2, 3…</strong> = comps in the same order as the list below.
                        </p>
                      </div>
                      {mapData?.subject && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-1">Subject property</p>
                          <img
                            src={`/api/map/streetview?lat=${mapData.subject.lat}&lng=${mapData.subject.lng}&size=300x200`}
                            alt="Subject building"
                            className="rounded-lg border border-gray-200 w-full max-w-sm h-auto"
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Comparable Properties */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  Comparable Properties ({appeal.compsUsed.length})
                </h2>
                <button
                  onClick={() => setShowAddComps(true)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  + Add Comps
                </button>
              </div>
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
                <p className="font-medium mb-1">How to choose comps</p>
                <p>
                  Add <strong>5–8 comparable sales</strong> that support a lower valuation. Rule 15 requires 3+ for sales analysis. Best comps: <strong>similar size</strong> (±25% living area), <strong>recent sale</strong> (within 2 years), same neighborhood, and <strong>lower price per sqft</strong> than your property — these strengthen your case.
                </p>
              </div>
              {showAddComps && (
                <AddCompsDialog
                  propertyId={appeal.property.id}
                  appealId={appeal.id}
                  onAdded={fetchAppeal}
                  onClose={() => setShowAddComps(false)}
                />
              )}
              {appeal.compsUsed.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No comparable properties added yet.</p>
                  <p className="text-sm mt-1">Add comps to strengthen your appeal.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {appeal.compsUsed.map((comp, compIndex) => {
                    const compCoords = mapData?.comps?.[compIndex]
                    return (
                    <div key={comp.id} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700" title="Same number as on map">
                              {compIndex + 1}
                            </span>
                            <p className="font-medium text-gray-900">{comp.address}</p>
                          </div>
                          <p className="text-sm text-gray-500 pl-8">PIN: {comp.pin}</p>
                        </div>
                        {mapAvailable !== false && compCoords && (
                          <img
                            src={`/api/map/streetview?lat=${compCoords.lat}&lng=${compCoords.lng}&size=120x90`}
                            alt=""
                            className="rounded border border-gray-200 shrink-0 w-[120px] h-[90px] object-cover"
                          />
                        )}
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          comp.compType === "SALES" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        }`}>
                          {comp.compType === "SALES" ? "Sales Comp" : "Equity Comp"}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                        <div>
                          <p className="text-gray-500">Living Area</p>
                          <p className="text-gray-900">{comp.livingArea ? `${formatNumber(comp.livingArea)} sqft` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Year Built</p>
                          <p className="text-gray-900">{comp.yearBuilt ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Sale Price</p>
                          <p className="text-gray-900">{formatCurrency(comp.salePrice)}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Sale Date</p>
                          <p className="text-gray-900">{comp.saleDate ? formatDate(comp.saleDate) : "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">$/sq ft</p>
                          <p className="text-gray-900">{comp.pricePerSqft != null ? `$${Math.round(comp.pricePerSqft).toLocaleString()}/sq ft` : "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Neighborhood</p>
                          <p className="text-gray-900">{comp.neighborhood ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Class</p>
                          <p className="text-gray-900">{comp.buildingClass ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Beds / Baths</p>
                          <p className="text-gray-900">
                            {(comp.bedrooms != null && comp.bedrooms > 0) || (comp.bathrooms != null && comp.bathrooms > 0)
                              ? `${(comp.bedrooms != null && comp.bedrooms > 0) ? comp.bedrooms : "—"} / ${(comp.bathrooms != null && comp.bathrooms > 0) ? comp.bathrooms.toFixed(1) : "—"}`
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">Distance</p>
                          <p className="text-gray-900">{comp.distanceFromSubject != null ? `${comp.distanceFromSubject.toFixed(2)} mi` : "—"}</p>
                        </div>
                      </div>
                    </div>
                  ); })}
                </div>
              )}
            </div>

            {/* Notes */}
            {appeal.notes && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Notes</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{appeal.notes}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Filing explained — so "Ready to File" vs "Mark as Filed" is clear */}
            {(appeal.status === "DRAFT" || appeal.status === "PENDING_FILING") && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="font-medium text-amber-900 mb-2">How filing works</p>
                <ul className="text-sm text-amber-800 space-y-2">
                  <li>
                    <strong>Ready to File</strong> means your appeal packet (summary + comps) is prepared. It does not submit the appeal for you.
                  </li>
                  <li>
                    You submit the appeal yourself at the{" "}
                    <a href="https://www.cookcountyassessoril.gov/file-appeal" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                      Cook County Assessor portal
                    </a>{" "}
                    (download your PDF from above first).
                  </li>
                  <li>
                    After you have submitted there, click <strong>Mark as Filed</strong> here so we can track your appeal status.
                  </li>
                  <li className="text-amber-700">
                    We cannot submit on your behalf yet: the Cook County Assessor has not released a public e-filing API. Once it is available, we will add filing-on-behalf for Starter+ plans.
                  </li>
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
              <div className="space-y-3">
                {/* Add comps first when none — primary next step before PDF / Ready to File */}
                {appeal.status === "DRAFT" && appeal.compsUsed.length === 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-2">
                    <p className="text-sm text-amber-900 font-medium mb-2">Next: add comparable properties</p>
                    <p className="text-xs text-amber-800 mb-3">Add at least 3 comps (5–8 recommended). Then set requested value, download your PDF, and mark Ready to File.</p>
                    <button
                      onClick={() => setShowAddComps(true)}
                      className="w-full bg-amber-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-amber-700"
                    >
                      Add Comps
                    </button>
                  </div>
                )}
                {appeal.status === "DRAFT" && appeal.compsUsed.length > 0 && (
                  <button
                    onClick={() => setShowAddComps(true)}
                    className="w-full border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50"
                  >
                    + Add more comps
                  </button>
                )}
                {appeal.compsUsed.length === 0 && (
                  <p className="text-xs text-gray-500">PDF and Ready to File are available after you add comps.</p>
                )}
                <PdfDownloadButton appealId={appeal.id} />
                {appeal.status === "DRAFT" && (
                  <>
                    <button
                      onClick={() => updateStatus("PENDING_FILING")}
                      disabled={updating || appeal.compsUsed.length < 3}
                      title={appeal.compsUsed.length < 3 ? "Add at least 3 comps first (Rule 15)" : undefined}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Ready to File
                    </button>
                    {appeal.compsUsed.length > 0 && appeal.compsUsed.length < 3 && (
                      <p className="text-xs text-amber-700">Add at least 3 comps before marking Ready to File.</p>
                    )}
                    <button
                      onClick={deleteAppeal}
                      className="w-full border border-red-300 text-red-600 py-2 px-4 rounded-lg font-medium hover:bg-red-50"
                    >
                      Delete Draft
                    </button>
                  </>
                )}
                {appeal.status === "PENDING_FILING" && (
                  <button
                    onClick={() => updateStatus("FILED")}
                    disabled={updating}
                    className="w-full bg-green-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    Mark as Filed
                  </button>
                )}
                {["FILED", "UNDER_REVIEW"].includes(appeal.status) && (
                  <button
                    onClick={() => updateStatus("HEARING_SCHEDULED")}
                    disabled={updating}
                    className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
                  >
                    Hearing Scheduled
                  </button>
                )}
                {!["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(appeal.status) && (
                  <button
                    onClick={() => updateStatus("WITHDRAWN")}
                    disabled={updating}
                    className="w-full border border-gray-300 text-gray-600 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    Withdraw Appeal
                  </button>
                )}
                {appeal.status === "WITHDRAWN" && (
                  <button
                    onClick={() => updateStatus("DRAFT")}
                    disabled={updating}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Reopen as draft
                  </button>
                )}
              </div>
            </div>

            {/* Appeal Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Appeal Info</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tax Year</dt>
                  <dd className="font-medium text-gray-900">{appeal.taxYear}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Appeal Type</dt>
                  <dd className="font-medium text-gray-900">{APPEAL_TYPE_LABELS[appeal.appealType]}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Filing Method</dt>
                  <dd className="font-medium text-gray-900 capitalize">{appeal.filingMethod.toLowerCase()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Notice Date</dt>
                  <dd className="font-medium text-gray-900">{formatDate(appeal.noticeDate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Filing Deadline</dt>
                  <dd className="font-medium text-gray-900">{formatDate(appeal.filingDeadline)}</dd>
                </div>
                {appeal.filedAt && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Filed On</dt>
                    <dd className="font-medium text-gray-900">{formatDate(appeal.filedAt)}</dd>
                  </div>
                )}
                {appeal.hearingScheduled && appeal.hearingDate && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Hearing Date</dt>
                    <dd className="font-medium text-purple-600">{formatDate(appeal.hearingDate)}</dd>
                  </div>
                )}
                {appeal.decisionDate && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Decision Date</dt>
                    <dd className="font-medium text-gray-900">{formatDate(appeal.decisionDate)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Documents - upload not available in MVP */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Documents</h2>
              {appeal.documents.length === 0 ? (
                <p className="text-sm text-gray-500">Document upload will be available in a future update. For now, use the Download summary PDF to get your evidence packet.</p>
              ) : (
                <ul className="space-y-2">
                  {appeal.documents.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-gray-700 truncate">{doc.fileName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Related Appeals */}
            {appeal.relatedAppeals.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Related Appeals</h2>
                <ul className="space-y-2">
                  {appeal.relatedAppeals.map((ra) => (
                    <li key={ra.id}>
                      <Link
                        href={`/appeals/${ra.id}`}
                        className="flex items-center justify-between text-sm hover:bg-gray-50 p-2 rounded -mx-2"
                      >
                        <span className="text-gray-700">{ra.taxYear} Appeal</span>
                        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[ra.status]}`}>
                          {STATUS_LABELS[ra.status]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
