"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

interface Property {
  id: string
  pin: string
  address: string
  city: string
  state: string
  zipCode: string
}

interface ManagedPropertiesListProps {
  properties: Property[]
  propertyLimit: number
  canAddMore: boolean
}

export function ManagedPropertiesList({
  properties,
  propertyLimit,
  canAddMore,
}: ManagedPropertiesListProps) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(id: string, address: string) {
    if (!confirm(`Remove "${address}" from your managed properties? This frees up a slot.`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/properties/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to remove property")
      }
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove property")
    } finally {
      setDeletingId(null)
    }
  }

  const limitLabel = propertyLimit >= 999 ? "unlimited" : propertyLimit

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">
          {properties.length} of {limitLabel} slots used — each property below uses one active seat on your plan.
        </p>
        {canAddMore && (
          <Link
            href="/properties/add"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            + Add property
          </Link>
        )}
      </div>
      {properties.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">
          No properties yet.{" "}
          <Link href="/properties/add" className="text-blue-600 hover:underline">
            Add your first property
          </Link>{" "}
          to use your plan slots.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {properties.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between py-3 first:pt-0"
            >
              <div>
                <p className="font-medium text-gray-900">{p.address}</p>
                <p className="text-sm text-gray-500">
                  PIN: {p.pin}
                  {p.city && ` · ${p.city}, ${p.state} ${p.zipCode}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/properties/${p.id}`}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  View / Edit
                </Link>
                <button
                  onClick={() => handleDelete(p.id, p.address)}
                  disabled={!!deletingId}
                  className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  {deletingId === p.id ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
