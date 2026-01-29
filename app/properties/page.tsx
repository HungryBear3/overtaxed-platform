"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface Property {
  id: string
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
  neighborhood: string | null
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  currentAssessmentValue: number | null
  currentMarketValue: number | null
  monitoringEnabled: boolean
  createdAt: string
  latestAssessment: {
    taxYear: number
    assessmentValue: number
    changeAmount: number | null
    changePercent: number | null
  } | null
  latestAppeal: {
    id: string
    taxYear: number
    status: string
    outcome: string | null
  } | null
}

export default function PropertiesPage() {
  const router = useRouter()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchProperties()
  }, [])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string, address: string) {
    if (!confirm(`Are you sure you want to remove "${address}" from your account?`)) {
      return
    }

    try {
      const response = await fetch(`/api/properties/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to delete property")
      }

      setProperties(properties.filter((p) => p.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete property")
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
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${color}`}>
        {label}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-48 mb-8"></div>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-lg shadow p-6">
                  <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">My Properties</h1>
            </div>
            <Link
              href="/properties/add"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Property
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {properties.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No properties yet</h3>
            <p className="text-gray-500 mb-6">
              Add your first Cook County property to start monitoring assessments and filing appeals.
            </p>
            <Link
              href="/properties/add"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Your First Property
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {properties.map((property) => (
              <div
                key={property.id}
                className="bg-white rounded-lg shadow hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <Link
                        href={`/properties/${property.id}`}
                        className="text-lg font-semibold text-gray-900 hover:text-blue-600"
                      >
                        {property.address}
                      </Link>
                      <p className="text-gray-500 text-sm">
                        {property.city}, {property.state} {property.zipCode}
                      </p>
                      <p className="text-gray-400 text-xs mt-1">
                        PIN: {property.pin}
                        {property.neighborhood && ` • Neighborhood: ${property.neighborhood}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {property.monitoringEnabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          Monitoring
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                          Paused
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Assessment</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(property.currentAssessmentValue)}
                      </p>
                      {property.latestAssessment?.changePercent && (
                        <p className={`text-xs ${property.latestAssessment.changePercent > 0 ? "text-red-600" : "text-green-600"}`}>
                          {property.latestAssessment.changePercent > 0 ? "+" : ""}
                          {property.latestAssessment.changePercent.toFixed(1)}% from last year
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Market Value</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(property.currentMarketValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Details</p>
                      <p className="text-sm text-gray-700">
                        {property.bedrooms && `${property.bedrooms} bed`}
                        {property.bathrooms && ` • ${property.bathrooms} bath`}
                        {property.livingArea && ` • ${formatNumber(property.livingArea)} sqft`}
                      </p>
                      {property.yearBuilt && (
                        <p className="text-xs text-gray-500">Built {property.yearBuilt}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Latest Appeal</p>
                      {property.latestAppeal ? (
                        <div>
                          {getStatusBadge(property.latestAppeal.status)}
                          <p className="text-xs text-gray-500 mt-1">
                            Tax Year {property.latestAppeal.taxYear}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">No appeals</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                    <div className="flex gap-2">
                      <Link
                        href={`/properties/${property.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        View Details
                      </Link>
                      <span className="text-gray-300">|</span>
                      <Link
                        href={`/properties/${property.id}/comps`}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Find Comps
                      </Link>
                    </div>
                    <button
                      onClick={() => handleDelete(property.id, property.address)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
