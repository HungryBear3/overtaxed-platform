"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"

interface Comp {
  pin: string
  pinRaw?: string
  address: string
  city: string
  state?: string
  zipCode?: string
  propertyClass: string | null
  buildingClass?: string | null
  livingArea: number | null
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  saleDate: string | null
  salePrice: number | null
  pricePerSqft?: number | null
  currentAssessmentValue: number | null
  neighborhood: string | null
  distanceFromSubject?: number | null
  dataSource?: string | null
}

export default function PropertyCompsPage() {
  const router = useRouter()
  const params = useParams()
  const propertyId = params.id as string

  const [comps, setComps] = useState<Comp[]>([])
  const [dataSource, setDataSource] = useState<string | null>(null)
  const [dataSourceNote, setDataSourceNote] = useState<string | null>(null)
  const [realieCompsNote, setRealieCompsNote] = useState<string | null>(null)
  const [includeRealie, setIncludeRealie] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingRealie, setLoadingRealie] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchComps(false)
  }, [propertyId])

  async function fetchComps(includeRealieComps: boolean) {
    if (includeRealieComps) setLoadingRealie(true)
    else setLoading(true)
    try {
      const url = includeRealieComps
        ? `/api/properties/${propertyId}/comps?limit=20&includeRealieComps=1`
        : `/api/properties/${propertyId}/comps?limit=20`
      const res = await fetch(url)
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/auth/signin")
          return
        }
        throw new Error(data.error || "Failed to fetch comps")
      }

      const list = (data.comps || []).map((c: Record<string, unknown>) => ({
        ...c,
        state: (c.state as string) ?? "IL",
        propertyClass: (c.buildingClass as string) ?? (c.propertyClass as string) ?? null,
      }))
      setComps(list)
      setDataSource((data.dataSource as string) ?? null)
      setDataSourceNote((data.dataSourceNote as string) ?? null)
      setRealieCompsNote((data.realieCompsNote as string) ?? null)
      if (includeRealieComps) setIncludeRealie(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comps")
    } finally {
      setLoading(false)
      setLoadingRealie(false)
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
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href={`/properties/${propertyId}`} className="text-gray-500 hover:text-gray-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Comparable Properties</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Data source & how to choose comps */}
        <div className="mb-6 space-y-4">
          {dataSource && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
              <p className="text-sm text-gray-700">
                <span className="font-medium">Data source:</span> {dataSource}
                {dataSourceNote && (
                  <span className="block mt-1 text-gray-600">{dataSourceNote}</span>
                )}
              </p>
              {realieCompsNote && (
                <p className="text-sm text-green-700 mt-2 font-medium">{realieCompsNote}</p>
              )}
              {!includeRealie && comps.length > 0 && (
                <button
                  type="button"
                  onClick={() => fetchComps(true)}
                  disabled={loadingRealie}
                  className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  {loadingRealie ? "Loading…" : "Also include Realie recently sold comparables (1–2 API calls)"}
                </button>
              )}
            </div>
          )}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
            <p className="font-medium text-blue-900 mb-2">How many comps do I need?</p>
            <p className="text-sm text-blue-800 mb-3">
              Cook County typically expects <strong>at least 3–5 comparable sales</strong> for a strong appeal. We show up to 20 matches ranked by similarity (location, size, age, class). Use the <strong>best 5–10</strong> that are most similar to your property — quality matters more than quantity. Lower $/sq ft comps support a lower requested value.
            </p>
            <p className="font-medium text-blue-900 mb-1">How to choose the best comps</p>
            <ul className="text-sm text-blue-800 list-disc list-inside space-y-1">
              <li><strong>Similar size</strong> — Prefer comps within ~20% of your property’s living area so the assessor can compare like to like. Cook County data is often sparse; when you add comps to an appeal we add richer data (Realie) for your summary and PDF.</li>
              <li><strong>Same neighborhood & class</strong> — Same neighborhood and building class strengthen your argument (Rule 15).</li>
              <li><strong>Recent sales</strong> — Newer sales carry more weight; we filter to recent years.</li>
              <li><strong>Lower $/sq ft</strong> — Comps with lower $/sq ft support a lower requested value for your property.</li>
              <li>If living area or beds/baths show as "—", that PIN has no detail in Cook County yet; your appeal PDF will still include any enriched data we have once these comps are on the appeal.</li>
            </ul>
          </div>
        </div>

        {comps.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No comparable properties found</h3>
            <p className="text-gray-500 mb-6">
              We couldn't find any comparable sales for this property. Try adjusting the search criteria or check back later.
            </p>
            <Link
              href={`/properties/${propertyId}`}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
            >
              Back to Property
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Found {comps.length} comparable properties</p>
                  <p className="text-blue-700">
                    These properties are similar in size, age, location, and class. Use them to support your appeal.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Address
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        PIN
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Class
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Living Area
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Year Built
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Sale Date
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Sale Price
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        $/sq ft
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Assessment
                      </th>
                      {comps.some((c) => c.dataSource) && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Source
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {comps.map((comp, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{comp.address}</div>
                          <div className="text-xs text-gray-500">{comp.city}, {comp.state}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {comp.pin}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {comp.propertyClass || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {comp.livingArea ? `${comp.livingArea.toLocaleString()} sq ft` : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {comp.yearBuilt || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                          {formatDate(comp.saleDate)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                          {formatCurrency(comp.salePrice)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {comp.pricePerSqft != null ? `$${Math.round(comp.pricePerSqft).toLocaleString()}/sq ft` : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                          {formatCurrency(comp.currentAssessmentValue)}
                        </td>
                        {comps.some((c) => c.dataSource) && (
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                            {comp.dataSource === "Realie (Premium Comparables)" ? "Realie" : "County"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <p className="text-sm text-gray-600">
                When you start an appeal below, all {comps.length} comps will be added to your appeal automatically. Next steps: create the appeal, set your requested value, then download your summary and forms.
              </p>
              <div className="flex gap-3">
                <Link
                  href={`/properties/${propertyId}`}
                  className="flex-1 text-center border border-gray-300 text-gray-700 py-3 px-4 rounded-lg font-medium hover:bg-gray-50"
                >
                  Back to Property
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const rawComps = comps.map((c) => ({
                        pin: c.pinRaw ?? c.pin,
                        address: c.address,
                        city: c.city,
                        zipCode: c.zipCode ?? "",
                        neighborhood: c.neighborhood ?? undefined,
                        buildingClass: c.buildingClass ?? c.propertyClass ?? undefined,
                        livingArea: c.livingArea ?? undefined,
                        yearBuilt: c.yearBuilt ?? undefined,
                        bedrooms: c.bedrooms ?? undefined,
                        bathrooms: c.bathrooms ?? undefined,
                        saleDate: c.saleDate ?? undefined,
                        salePrice: c.salePrice ?? undefined,
                        pricePerSqft: c.pricePerSqft ?? undefined,
                        distanceFromSubject: c.distanceFromSubject ?? undefined,
                      }))
                      sessionStorage.setItem(
                        "overtaxed_appeal_comps",
                        JSON.stringify({ propertyId, comps: rawComps })
                      )
                      router.push(`/appeals/new?propertyId=${propertyId}`)
                    } catch (e) {
                      router.push(`/appeals/new?propertyId=${propertyId}`)
                    }
                  }}
                  className="flex-1 text-center bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700"
                >
                  Start Appeal with These Comps
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
