"use client"

import { useState } from "react"
import Link from "next/link"
import { formatPIN } from "@/lib/cook-county"
import { useRouter } from "next/navigation"

interface FilingQueueRowProps {
  appeal: {
    id: string
    taxYear: number
    status: string
    filingDeadline: Date
    property: { id: string; pin: string; address: string; city: string; state: string; zipCode: string }
    user: { id: string; email: string; name: string | null }
    filingAuthorization: {
      propertyAddress: string
      propertyCity: string
      propertyState: string
      propertyZip: string
      propertyPin: string
      ownerName: string
      ownerEmail: string
      ownerPhone: string | null
      ownerAddress: string
      ownerCity: string
      ownerState: string
      ownerZip: string
      signedAt: Date
    }
  }
}

export function FilingQueueRow({ appeal }: FilingQueueRowProps) {
  const router = useRouter()
  const [marking, setMarking] = useState(false)
  const auth = appeal.filingAuthorization

  async function handleMarkAsFiled() {
    if (!confirm("Mark this appeal as filed with Cook County? This will set status to Filed and record the filing date.")) return
    setMarking(true)
    try {
      const res = await fetch(`/api/appeals/${appeal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "FILED",
          filedAt: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to update")
      }
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to mark as filed")
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 [color-scheme:light]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">{appeal.property.address}</h3>
          <p className="text-sm text-gray-500">
            PIN {formatPIN(appeal.property.pin)} · {appeal.taxYear} · {appeal.status}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            User: {appeal.user.email} {appeal.user.name && `(${appeal.user.name})`}
          </p>
          <p className="text-sm text-gray-500">
            Filing deadline: {new Date(appeal.filingDeadline).toLocaleDateString("en-US")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/appeals/${appeal.id}`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View appeal
          </Link>
          <a
            href={`/api/appeals/${appeal.id}/download-summary`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Appeal packet
          </a>
          <a
            href={`/api/appeals/${appeal.id}/authorization/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
          >
            Auth PDF
          </a>
          {appeal.status === "PENDING_STAFF_FILING" && (
            <button
              type="button"
              onClick={handleMarkAsFiled}
              disabled={marking}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              {marking ? "Updating…" : "Mark as filed"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Authorization data (for county form)
        </h4>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <span className="text-gray-500">Property:</span>{" "}
            <span className="text-gray-900">
              {auth.propertyAddress}, {auth.propertyCity} {auth.propertyState} {auth.propertyZip}
            </span>
          </div>
          <div>
            <span className="text-gray-500">PIN:</span>{" "}
            <span className="font-mono text-gray-900">{auth.propertyPin}</span>
          </div>
          <div>
            <span className="text-gray-500">Owner:</span>{" "}
            <span className="text-gray-900">{auth.ownerName}</span>
          </div>
          <div>
            <span className="text-gray-500">Email:</span>{" "}
            <span className="text-gray-900">{auth.ownerEmail}</span>
          </div>
          <div>
            <span className="text-gray-500">Phone:</span>{" "}
            <span className="text-gray-900">{auth.ownerPhone || "—"}</span>
          </div>
          <div>
            <span className="text-gray-500">Mailing:</span>{" "}
            <span className="text-gray-900">
              {auth.ownerAddress}, {auth.ownerCity} {auth.ownerState} {auth.ownerZip}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Signed:</span>{" "}
            <span className="text-gray-900">
              {new Date(auth.signedAt).toLocaleString("en-US")}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
