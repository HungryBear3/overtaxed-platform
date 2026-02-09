"use client"

import { useState, useEffect, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface AssessmentHistory {
  id: string
  taxYear: number
  assessmentValue: number
  landValue: number | null
  improvementValue: number | null
  marketValue: number | null
  changeAmount: number | null
  changePercent: number | null
  source: string | null
  createdAt: string
}

interface Appeal {
  id: string
  taxYear: number
  status: string
  appealType: string
  originalAssessmentValue: number
  requestedAssessmentValue: number | null
  finalAssessmentValue: number | null
  outcome: string | null
  reductionAmount: number | null
  reductionPercent: number | null
  taxSavings: number | null
  filedAt: string | null
  decisionDate: string | null
  createdAt: string
}

interface Property {
  id: string
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
  county: string
  neighborhood: string | null
  subdivision: string | null
  block: string | null
  buildingClass: string | null
  cdu: string | null
  livingArea: number | null
  landSize: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  exteriorWall: string | null
  roofType: string | null
  heatingType: string | null
  currentAssessmentValue: number | null
  currentLandValue: number | null
  currentImprovementValue: number | null
  currentMarketValue: number | null
  // Tax information
  taxCode: string | null
  taxRate: number | null
  stateEqualizer: number | null
  monitoringEnabled: boolean
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
  assessmentHistory: AssessmentHistory[]
  appeals: Appeal[]
}

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchProperty()
  }, [resolvedParams.id])

  async function fetchProperty() {
    try {
      const response = await fetch(`/api/properties/${resolvedParams.id}`)
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Property not found")
      }

      setProperty(data.property)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load property")
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

  function formatDate(dateString: string | null): string {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  function getStatusBadge(status: string) {
    const statusColors: Record<string, string> = {
      DRAFT: "bg-gray-100 text-gray-700",
      PENDING_FILING: "bg-yellow-100 text-yellow-700",
      FILED: "bg-blue-100 text-blue-700",
      UNDER_REVIEW: "bg-purple-100 text-purple-700",
      HEARING_SCHEDULED: "bg-orange-100 text-orange-700",
      APPROVED: "bg-green-100 text-green-700",
      PARTIALLY_APPROVED: "bg-green-100 text-green-700",
      DENIED: "bg-red-100 text-red-700",
      WITHDRAWN: "bg-gray-100 text-gray-700",
    }
    const color = statusColors[status] || "bg-gray-100 text-gray-700"
    const label = status.replace(/_/g, " ").toLowerCase()
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>
        {label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-48 mb-8"></div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="h-6 bg-gray-200 rounded w-full mb-4"></div>
              <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-6 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Property Not Found</h2>
          <p className="text-gray-600 mb-4">{error || "The property you're looking for doesn't exist."}</p>
          <Link href="/properties" className="text-blue-600 hover:text-blue-700 font-medium">
            Back to Properties
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/properties" className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{property.address}</h1>
              <p className="text-gray-500">
                {property.city}, {property.state} {property.zipCode}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>PIN: {property.pin}</span>
              {property.neighborhood && <span>• Neighborhood: {property.neighborhood}</span>}
              {property.monitoringEnabled ? (
                <span className="inline-flex items-center gap-1 text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  Monitoring Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-400">
                  <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                  Monitoring Paused
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/appeals/new?propertyId=${property.id}`)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Start Appeal
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Assessment Summary */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Assessment Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-xs text-blue-600 uppercase tracking-wide font-medium">Total Assessment</p>
              <p className="text-2xl font-bold text-blue-900">
                {formatCurrency(property.currentAssessmentValue)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">Market Value</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(property.currentMarketValue)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">Land Value</p>
              <p className="text-xl font-semibold text-gray-900">
                {formatCurrency(property.currentLandValue)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 uppercase tracking-wide font-medium">Improvement Value</p>
              <p className="text-xl font-semibold text-gray-900">
                {formatCurrency(property.currentImprovementValue)}
              </p>
            </div>
          </div>
        </div>

        {/* Estimated Savings */}
        {property.currentAssessmentValue && property.currentAssessmentValue > 0 && (() => {
          // Use actual tax rate if available, otherwise use average (7.5%)
          const taxRate = property.taxRate || 0.075
          const stateEqualizer = property.stateEqualizer ?? 3.0355
          const hasActualRate = !!property.taxRate
          
          // Calculate savings for different reduction percentages
          const calcSavings = (reductionPercent: number) => 
            property.currentAssessmentValue! * reductionPercent * stateEqualizer * taxRate
          
          return (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow p-6 border border-green-200">
              <div>
                <h2 className="text-lg font-semibold text-green-900 mb-2">Potential Annual Tax Savings</h2>
                <p className="text-sm text-green-700 mb-4">
                  {hasActualRate 
                    ? `Based on your property's actual tax rate (${(taxRate * 100).toFixed(2)}%):`
                    : "Estimated savings if your assessment is reduced:"
                  }
                </p>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase tracking-wide">10% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calcSavings(0.10))}
                    </p>
                    <p className="text-xs text-green-600">/year in taxes</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase tracking-wide">15% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calcSavings(0.15))}
                    </p>
                    <p className="text-xs text-green-600">/year in taxes</p>
                  </div>
                  <div className="bg-white/60 rounded-lg p-3">
                    <p className="text-xs text-green-600 uppercase tracking-wide">20% Reduction</p>
                    <p className="text-xl font-bold text-green-800">
                      {formatCurrency(calcSavings(0.20))}
                    </p>
                    <p className="text-xs text-green-600">/year in taxes</p>
                  </div>
                </div>
                {property.taxCode && (
                  <div className="mb-3 text-sm text-green-700">
                    <span className="font-medium">Tax Code:</span> {property.taxCode}
                    {hasActualRate && (
                      <span className="ml-4">
                        <span className="font-medium">Tax Rate:</span> {(taxRate * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
                <div className="text-xs text-green-700 space-y-1">
                  <p className="italic">
                    * Calculated using: Assessment Reduction × State Equalizer ({stateEqualizer.toFixed(3)}) × Tax Rate ({(taxRate * 100).toFixed(2)}%)
                  </p>
                  <p>
                    {hasActualRate 
                      ? "Actual savings may vary based on exemptions you qualify for. "
                      : "Your actual savings depend on your tax code and exemptions. "
                    }
                    <a 
                      href={`https://www.cookcountypropertyinfo.com/cookviewerpinresults.aspx?pin=${property.pin.replace(/-/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline hover:text-green-800"
                    >
                      View your actual tax bills on Cook County Treasurer →
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Property Details */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Property Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Bedrooms</p>
              <p className="text-lg font-medium text-gray-900">{property.bedrooms ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Bathrooms</p>
              <p className="text-lg font-medium text-gray-900">{property.bathrooms ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Living Area</p>
              <p className="text-lg font-medium text-gray-900">
                {property.livingArea ? `${formatNumber(property.livingArea)} sqft` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Land Size</p>
              <p className="text-lg font-medium text-gray-900">
                {property.landSize ? `${formatNumber(property.landSize)} sqft` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Year Built</p>
              <p className="text-lg font-medium text-gray-900">{property.yearBuilt ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Building Class</p>
              <p className="text-lg font-medium text-gray-900">{property.buildingClass ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Exterior</p>
              <p className="text-lg font-medium text-gray-900">{property.exteriorWall ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Roof Type</p>
              <p className="text-lg font-medium text-gray-900">{property.roofType ?? "—"}</p>
            </div>
          </div>
          
          {/* Explanation for missing details */}
          {(!property.bedrooms && !property.bathrooms && !property.livingArea && !property.yearBuilt) && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500 flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  <strong>Why are some details missing?</strong>{" "}
                  {property.buildingClass?.startsWith("2") || property.buildingClass === "299" ? (
                    <>For condominiums and some multi-unit buildings, Cook County maintains detailed characteristics at the building level rather than individual unit level. This is normal and doesn&apos;t affect your ability to appeal your assessment.</>
                  ) : (
                    <>Some property details may not be available in Cook County records. This doesn&apos;t affect your ability to appeal your assessment.</>
                  )}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Assessment History */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Assessment History</h2>
          {property.assessmentHistory.length === 0 ? (
            <p className="text-gray-500">No assessment history available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 text-xs text-gray-500 uppercase tracking-wide">Tax Year</th>
                    <th className="text-right py-3 px-2 text-xs text-gray-500 uppercase tracking-wide">Assessment</th>
                    <th className="text-right py-3 px-2 text-xs text-gray-500 uppercase tracking-wide">Market Value</th>
                    <th className="text-right py-3 px-2 text-xs text-gray-500 uppercase tracking-wide">Change</th>
                    <th className="text-left py-3 px-2 text-xs text-gray-500 uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {property.assessmentHistory.map((history) => {
                    const unavailable = history.assessmentValue == null || history.assessmentValue === 0
                    return (
                      <tr key={history.id} className="border-b border-gray-100">
                        <td className="py-3 px-2 font-medium text-gray-900">{history.taxYear}</td>
                        <td className="py-3 px-2 text-right text-gray-900">{unavailable ? <span className="text-gray-500">Not available yet</span> : formatCurrency(history.assessmentValue)}</td>
                        <td className="py-3 px-2 text-right text-gray-900">{unavailable ? <span className="text-gray-500">—</span> : formatCurrency(history.marketValue)}</td>
                        <td className="py-3 px-2 text-right">
                          {unavailable ? (
                            <span className="text-gray-400">—</span>
                          ) : history.changePercent !== null ? (
                            <span className={history.changePercent > 0 ? "text-red-600" : "text-green-600"}>
                              {history.changePercent > 0 ? "+" : ""}
                              {history.changePercent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-sm text-gray-500">{history.source ?? "—"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Appeals */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Appeals</h2>
            <button
              type="button"
              onClick={() => router.push(`/appeals/new?propertyId=${property.id}`)}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Start Appeal
            </button>
          </div>
          {property.appeals.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No appeals filed yet for this property.</p>
              <p className="text-sm text-gray-400">
                Start an appeal to challenge your property tax assessment.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {property.appeals.map((appeal) => (
                <div key={appeal.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-medium text-gray-900">Tax Year {appeal.taxYear}</span>
                      <span className="text-gray-400 mx-2">•</span>
                      <span className="text-gray-500 text-sm">{appeal.appealType.replace(/_/g, " ")}</span>
                    </div>
                    {getStatusBadge(appeal.status)}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Original</p>
                      <p className="font-medium">{formatCurrency(appeal.originalAssessmentValue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Requested</p>
                      <p className="font-medium">{formatCurrency(appeal.requestedAssessmentValue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Final</p>
                      <p className="font-medium">{formatCurrency(appeal.finalAssessmentValue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Savings</p>
                      <p className={`font-medium ${appeal.taxSavings && appeal.taxSavings > 0 ? "text-green-600" : ""}`}>
                        {formatCurrency(appeal.taxSavings)}
                      </p>
                    </div>
                  </div>
                  {(appeal.filedAt || appeal.decisionDate) && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
                      {appeal.filedAt && <span>Filed: {formatDate(appeal.filedAt)}</span>}
                      {appeal.decisionDate && <span>Decision: {formatDate(appeal.decisionDate)}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <Link
            href={`/properties/${property.id}/comps`}
            className="flex-1 bg-white border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50 text-center"
          >
            Find Comparable Properties
          </Link>
          <Link
            href={`/properties/${property.id}/refresh`}
            className="flex-1 bg-white border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50 text-center"
          >
            Refresh Property Data
          </Link>
        </div>
      </main>
    </div>
  )
}
