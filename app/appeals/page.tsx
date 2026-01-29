"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface Appeal {
  id: string
  propertyId: string
  property: {
    id: string
    pin: string
    address: string
    city: string
    county: string
  }
  taxYear: number
  status: string
  appealType: string
  originalAssessmentValue: number
  requestedAssessmentValue: number | null
  finalAssessmentValue: number | null
  outcome: string | null
  reductionAmount: number | null
  taxSavings: number | null
  filingDeadline: string
  filedAt: string | null
  hearingScheduled: boolean
  hearingDate: string | null
  createdAt: string
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

export default function AppealsPage() {
  const router = useRouter()
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all")

  useEffect(() => {
    fetchAppeals()
  }, [])

  async function fetchAppeals() {
    try {
      const response = await fetch("/api/appeals")
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Failed to fetch appeals")
      }

      setAppeals(data.appeals)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load appeals")
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

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—"
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const filteredAppeals = appeals.filter((appeal) => {
    if (filter === "active") {
      return !["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(appeal.status)
    }
    if (filter === "completed") {
      return ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(appeal.status)
    }
    return true
  })

  const activeCount = appeals.filter(
    (a) => !["APPROVED", "PARTIALLY_APPROVED", "DENIED", "WITHDRAWN"].includes(a.status)
  ).length
  
  const totalSavings = appeals
    .filter((a) => a.taxSavings)
    .reduce((sum, a) => sum + (a.taxSavings || 0), 0)

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">Appeals</h1>
            </div>
            <Link
              href="/appeals/new"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Start New Appeal
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Total Appeals</p>
            <p className="text-2xl font-bold text-gray-900">{appeals.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Active Appeals</p>
            <p className="text-2xl font-bold text-blue-600">{activeCount}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Total Tax Savings</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalSavings)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(["all", "active", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {f === "all" ? "All" : f === "active" ? "Active" : "Completed"}
            </button>
          ))}
        </div>

        {/* Appeals List */}
        {filteredAppeals.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {filter === "all" ? "No appeals yet" : `No ${filter} appeals`}
            </h3>
            <p className="text-gray-500 mb-6">
              {filter === "all"
                ? "Start an appeal for one of your properties to reduce your property taxes."
                : "No appeals match this filter."}
            </p>
            {filter === "all" && (
              <Link
                href="/appeals/new"
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Start Your First Appeal
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAppeals.map((appeal) => (
              <Link
                key={appeal.id}
                href={`/appeals/${appeal.id}`}
                className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {appeal.property.address}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {appeal.property.city}, {appeal.property.county} County • PIN: {appeal.property.pin}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[appeal.status]}`}>
                      {STATUS_LABELS[appeal.status]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Tax Year</p>
                      <p className="font-medium text-gray-900">{appeal.taxYear}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Original Assessment</p>
                      <p className="font-medium text-gray-900">{formatCurrency(appeal.originalAssessmentValue)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Filing Deadline</p>
                      <p className="font-medium text-gray-900">{formatDate(appeal.filingDeadline)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">
                        {appeal.outcome ? "Tax Savings" : "Potential Savings"}
                      </p>
                      <p className={`font-medium ${appeal.taxSavings ? "text-green-600" : "text-gray-900"}`}>
                        {appeal.taxSavings ? formatCurrency(appeal.taxSavings) : "TBD"}
                      </p>
                    </div>
                  </div>

                  {appeal.hearingScheduled && appeal.hearingDate && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2 text-purple-700">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-sm font-medium">
                          Hearing scheduled for {formatDate(appeal.hearingDate)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
