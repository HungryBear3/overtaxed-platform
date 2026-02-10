"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface CompItem {
  pin: string
  pinRaw: string
  address: string
  city: string
  zipCode: string
  neighborhood: string | null
  saleDate: string | null
  salePrice: number
  pricePerSqft: number | null
  livingArea: number | null
  yearBuilt: number | null
  buildingClass: string | null
  distanceFromSubject?: number | null
}

export function AddCompsDialog({
  propertyId,
  appealId,
  onAdded,
  onClose,
}: {
  propertyId: string
  appealId: string
  onAdded: () => void
  onClose: () => void
}) {
  const [comps, setComps] = useState<CompItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setError("")
    setLoading(true)
    fetch(`/api/properties/${propertyId}/comps?limit=20`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (!d.success) throw new Error(d.error || "Failed to fetch comps")
        setComps(d.comps)
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [propertyId])

  function toggle(pinRaw: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(pinRaw)) n.delete(pinRaw)
      else n.add(pinRaw)
      return n
    })
  }

  async function addSelected() {
    if (selected.size === 0) return
    setError("")
    setSubmitting(true)
    try {
      const toAdd = comps.filter((c) => selected.has(c.pinRaw))
      const body = {
        comps: toAdd.map((c) => ({
          pin: c.pinRaw,
          address: c.address,
          city: c.city,
          zipCode: c.zipCode,
          neighborhood: c.neighborhood,
          buildingClass: c.buildingClass,
          livingArea: c.livingArea,
          yearBuilt: c.yearBuilt,
          salePrice: c.salePrice,
          saleDate: c.saleDate,
          pricePerSqft: c.pricePerSqft,
          distanceFromSubject: c.distanceFromSubject ?? null,
          compType: "SALES" as const,
        })),
      }
      const res = await fetch(`/api/appeals/${appealId}/comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add comps")
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comps")
    } finally {
      setSubmitting(false)
    }
  }

  function formatCurrency(n: number | null): string {
    if (n == null) return "—"
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
  }
  function formatDate(s: string | null): string {
    if (!s) return "—"
    return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[85vh] w-full max-w-2xl overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <CardTitle>Add comparable properties</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 rounded-lg bg-amber-50 border-2 border-amber-300 px-4 py-4 text-sm text-amber-900 shrink-0">
            <p className="font-semibold mb-2">How many comps to add?</p>
            <p className="text-amber-800 mb-2">
              <strong>5–8 strong comps</strong> is usually best — you don&apos;t need all 20. Rule 15 requires at least 3 for sales analysis.
            </p>
            <p className="text-amber-800">
              <strong>Best comps:</strong> Recent sales (within 2 years), similar size (±25% living area), same neighborhood. Pick the ones with <strong>lower price per sqft</strong> than your property — they support a lower assessment.
            </p>
          </div>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : comps.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No comparable sales found for this property.</p>
          ) : (
            <div className="space-y-2">
              {comps.map((c) => (
                <label
                  key={c.pinRaw}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    selected.has(c.pinRaw) ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.pinRaw)}
                    onChange={() => toggle(c.pinRaw)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{c.address}</p>
                    <p className="text-sm text-gray-500">PIN: {c.pin}</p>
                    <p className="text-sm text-gray-600">
                      Sale {formatCurrency(c.salePrice)} • {formatDate(c.saleDate)} • {c.livingArea ?? "—"} sq ft
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </CardContent>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={addSelected}
            disabled={loading || selected.size === 0 || submitting}
          >
            {submitting ? "Adding…" : `Add ${selected.size} comp${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </Card>
    </div>
  )
}
