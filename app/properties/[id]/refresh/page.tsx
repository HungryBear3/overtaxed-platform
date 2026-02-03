"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

export default function PropertyRefreshPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    fetch(`/api/properties/${id}/refresh`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json()
        if (res.ok) {
          setStatus("success")
          setMessage(data.yearsUpdated?.length ? `Updated ${data.yearsUpdated.length} years of assessment data.` : "Property data refreshed.")
          setTimeout(() => router.push(`/properties/${id}`), 1500)
        } else {
          setStatus("error")
          setMessage(data.error || "Refresh failed")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Refresh failed")
      })
  }, [id, router])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow p-6 max-w-md text-center">
        {status === "loading" && (
          <>
            <div className="animate-spin h-10 w-10 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-700">Refreshing property data from Cook County…</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-900 font-medium">{message}</p>
            <p className="text-sm text-gray-500 mt-1">Redirecting to property…</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-gray-900 font-medium">Refresh failed</p>
            <p className="text-sm text-gray-600 mt-1">{message}</p>
            <Link href={`/properties/${id}`} className="mt-4 inline-block text-blue-600 hover:underline">
              Back to property
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
