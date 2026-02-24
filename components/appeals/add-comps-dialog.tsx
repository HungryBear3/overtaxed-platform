"use client"

import { useState, useEffect } from "react"
import { X, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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
  bedrooms: number | null
  bathrooms: number | null
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
  const [compsSource, setCompsSource] = useState<string>("")
  const [needsUnitConfirmation, setNeedsUnitConfirmation] = useState(false)
  const [unitForRetry, setUnitForRetry] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualComp, setManualComp] = useState({
    pin: "",
    address: "",
    city: "",
    zipCode: "",
    salePrice: "",
    saleDate: "",
    livingArea: "",
    yearBuilt: "",
    bedrooms: "",
    bathrooms: "",
    neighborhood: "",
    buildingClass: "",
  })

  async function fetchComps(unitNumber?: string | null) {
    setError("")
    setNeedsUnitConfirmation(false)
    setLoading(true)
    try {
      const url = `/api/properties/${propertyId}/comps?limit=20${unitNumber ? `&unitNumber=${encodeURIComponent(unitNumber)}` : ""}`
      const r = await fetch(url)
      const d = await r.json()
      if (d.needsUnitConfirmation) {
        setNeedsUnitConfirmation(true)
        setComps([])
        setCompsSource("")
        setError("")
        return
      }
      if (!d.success) throw new Error(d.error || "Failed to fetch comps")
      setComps(d.comps)
      setCompsSource(d.source ?? "")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch comps")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchComps()
  }, [propertyId])

  function toggle(pinRaw: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(pinRaw)) n.delete(pinRaw)
      else n.add(pinRaw)
      return n
    })
  }

  async function addManualComp(e: React.FormEvent) {
    e.preventDefault()
    const price = parseFloat(manualComp.salePrice)
    if (!manualComp.address.trim() || isNaN(price) || price < 1) {
      setError("Address and sale price are required")
      return
    }
    setError("")
    setSubmitting(true)
    try {
      const saleDateVal = manualComp.saleDate
        ? (manualComp.saleDate.includes("T") ? manualComp.saleDate : `${manualComp.saleDate}T12:00:00Z`)
        : null
      const pinVal = manualComp.pin.trim().replace(/\D/g, "")
      const body = {
        comps: [
          {
            pin: pinVal.length === 14 ? pinVal : undefined,
            address: manualComp.address.trim(),
            city: manualComp.city.trim() || "",
            zipCode: manualComp.zipCode.trim() || "",
            neighborhood: manualComp.neighborhood.trim() || null,
            buildingClass: manualComp.buildingClass.trim() || null,
            livingArea: manualComp.livingArea ? parseInt(manualComp.livingArea, 10) : null,
            yearBuilt: manualComp.yearBuilt ? parseInt(manualComp.yearBuilt, 10) : null,
            bedrooms: manualComp.bedrooms ? parseInt(manualComp.bedrooms, 10) : null,
            bathrooms: manualComp.bathrooms ? parseFloat(manualComp.bathrooms) : null,
            salePrice: price,
            saleDate: saleDateVal,
            pricePerSqft: manualComp.livingArea ? price / parseInt(manualComp.livingArea, 10) : null,
            compType: "SALES",
            dataSource: "manual",
          },
        ],
      }
      const res = await fetch(`/api/appeals/${appealId}/comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add comp")
      setManualComp({
        pin: "",
        address: "",
        city: "",
        zipCode: "",
        salePrice: "",
        saleDate: "",
        livingArea: "",
        yearBuilt: "",
        bedrooms: "",
        bathrooms: "",
        neighborhood: "",
        buildingClass: "",
      })
      setShowManualForm(false)
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add comp")
    } finally {
      setSubmitting(false)
    }
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
          bedrooms: c.bedrooms ?? null,
          bathrooms: c.bathrooms ?? null,
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
            <p className="text-amber-800 mb-2">
              <strong>Best comps:</strong> Recent sales (within 2 years), similar size (±25% living area), same neighborhood. Pick the ones with <strong>lower price per sqft</strong> than your property — they support a lower assessment.
            </p>
            <p className="text-amber-700 text-xs">
              {compsSource ? (
                <>Comps from <strong>{compsSource}</strong>. {compsSource.includes("Realie") ? "Realie provides sqft, beds, baths when available." : "Enriched with Realie when available (marked with * in the PDF)."} You can also add comps manually if needed.</>
              ) : (
                <>Comps are sourced from Cook County and enriched with Realie when available (marked with * in the PDF). You can also add comps manually if needed.</>
              )}
            </p>
          </div>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {needsUnitConfirmation ? (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                <p className="text-sm font-medium text-amber-900 mb-2">
                  Unit number may be required for this address
                </p>
                <p className="text-sm text-amber-800 mb-4">
                  To find comparables for this condo or apartment, enter your unit number (e.g. 2B or 101).
                </p>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <Label htmlFor="unit-retry">Unit number</Label>
                    <Input
                      id="unit-retry"
                      value={unitForRetry}
                      onChange={(e) => setUnitForRetry(e.target.value)}
                      placeholder="e.g. 2B"
                      className="mt-1"
                    />
                  </div>
                  <Button
                    onClick={() => fetchComps(unitForRetry.trim() || null)}
                    disabled={!unitForRetry.trim()}
                  >
                    Search comps
                  </Button>
                </div>
                <p className="text-xs text-amber-700 mt-3">
                  If this is a single-family home, you can add comps manually below.
                </p>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setShowManualForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add comp manually instead
              </Button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : comps.length === 0 && !showManualForm ? (
            <div className="space-y-4">
              <p className="py-4 text-center text-gray-500">No comparable sales found for this property.</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowManualForm(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add comp manually
              </Button>
            </div>
          ) : comps.length === 0 && showManualForm ? (
            <form onSubmit={addManualComp} className="space-y-4">
              <p className="text-sm text-gray-600">Add a comparable sale you know about (e.g. from a neighbor, listing).</p>
              <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">How to find comp data</summary>
                <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-gray-600">
                  <li>Use <a href="https://www.redfin.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Redfin</a> or <a href="https://www.zillow.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Zillow</a> sold listings for address, sale price, sale date, sq ft, beds, baths.</li>
                  <li>To get the Cook County PIN: search by address at{" "}
                    <a href="https://www.cookcountyassessoril.gov/address-search" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">cookcountyassessor.com/address-search</a> — PIN is required for Rule 15.</li>
                  <li>If Zillow or Redfin show a PIN, confirm it at the Assessor site before entering.</li>
                </ul>
              </details>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="manual-pin">Cook County PIN (optional, 14 digits)</Label>
                  <Input
                    id="manual-pin"
                    value={manualComp.pin}
                    onChange={(e) => setManualComp((m) => ({ ...m, pin: e.target.value }))}
                    placeholder="e.g. 16-01-216-001-0000"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="manual-address">Address *</Label>
                  <Input
                    id="manual-address"
                    value={manualComp.address}
                    onChange={(e) => setManualComp((m) => ({ ...m, address: e.target.value }))}
                    placeholder="123 Main St"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="manual-city">City</Label>
                  <Input
                    id="manual-city"
                    value={manualComp.city}
                    onChange={(e) => setManualComp((m) => ({ ...m, city: e.target.value }))}
                    placeholder="Chicago"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-zip">ZIP</Label>
                  <Input
                    id="manual-zip"
                    value={manualComp.zipCode}
                    onChange={(e) => setManualComp((m) => ({ ...m, zipCode: e.target.value }))}
                    placeholder="60601"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-salePrice">Sale price *</Label>
                  <Input
                    id="manual-salePrice"
                    type="number"
                    min={1}
                    value={manualComp.salePrice}
                    onChange={(e) => setManualComp((m) => ({ ...m, salePrice: e.target.value }))}
                    placeholder="350000"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="manual-saleDate">Sale date</Label>
                  <Input
                    id="manual-saleDate"
                    type="date"
                    value={manualComp.saleDate}
                    onChange={(e) => setManualComp((m) => ({ ...m, saleDate: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="manual-livingArea">Living area (sq ft)</Label>
                  <Input
                    id="manual-livingArea"
                    type="number"
                    min={1}
                    value={manualComp.livingArea}
                    onChange={(e) => setManualComp((m) => ({ ...m, livingArea: e.target.value }))}
                    placeholder="1500"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-yearBuilt">Year built</Label>
                  <Input
                    id="manual-yearBuilt"
                    type="number"
                    min={1800}
                    max={new Date().getFullYear() + 1}
                    value={manualComp.yearBuilt}
                    onChange={(e) => setManualComp((m) => ({ ...m, yearBuilt: e.target.value }))}
                    placeholder="1995"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-bedrooms">Bedrooms</Label>
                  <Input
                    id="manual-bedrooms"
                    type="number"
                    min={0}
                    value={manualComp.bedrooms}
                    onChange={(e) => setManualComp((m) => ({ ...m, bedrooms: e.target.value }))}
                    placeholder="3"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-bathrooms">Bathrooms</Label>
                  <Input
                    id="manual-bathrooms"
                    type="number"
                    min={0}
                    step={0.5}
                    value={manualComp.bathrooms}
                    onChange={(e) => setManualComp((m) => ({ ...m, bathrooms: e.target.value }))}
                    placeholder="2"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-neighborhood">Neighborhood</Label>
                  <Input
                    id="manual-neighborhood"
                    value={manualComp.neighborhood}
                    onChange={(e) => setManualComp((m) => ({ ...m, neighborhood: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <Label htmlFor="manual-buildingClass">Building class</Label>
                  <Input
                    id="manual-buildingClass"
                    value={manualComp.buildingClass}
                    onChange={(e) => setManualComp((m) => ({ ...m, buildingClass: e.target.value }))}
                    placeholder="e.g. 2-01"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setShowManualForm(false)}>
                  Back
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Adding…" : "Add comp"}
                </Button>
              </div>
            </form>
          ) : (
            <>
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
              {showManualForm ? (
                <form onSubmit={addManualComp} className="mt-6 pt-6 border-t space-y-4">
                  <p className="text-sm font-medium text-gray-700">Add another comp manually</p>
                  <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700">How to find comp data</summary>
                    <ul className="mt-2 list-disc list-inside space-y-1 text-sm text-gray-600">
                      <li>Use <a href="https://www.redfin.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Redfin</a> or <a href="https://www.zillow.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Zillow</a> sold listings for address, sale price, sale date, sq ft, beds, baths.</li>
                      <li>To get the Cook County PIN: search by address at{" "}
                        <a href="https://www.cookcountyassessoril.gov/address-search" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">cookcountyassessor.com/address-search</a> — PIN is required for Rule 15.</li>
                      <li>If Zillow or Redfin show a PIN, confirm it at the Assessor site before entering.</li>
                    </ul>
                  </details>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <Label htmlFor="manual-pin-2">Cook County PIN (optional, 14 digits)</Label>
                      <Input
                        id="manual-pin-2"
                        value={manualComp.pin}
                        onChange={(e) => setManualComp((m) => ({ ...m, pin: e.target.value }))}
                        placeholder="e.g. 16-01-216-001-0000"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="manual-address-2">Address *</Label>
                      <Input
                        id="manual-address-2"
                        value={manualComp.address}
                        onChange={(e) => setManualComp((m) => ({ ...m, address: e.target.value }))}
                        placeholder="123 Main St"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="manual-city-2">City</Label>
                      <Input
                        id="manual-city-2"
                        value={manualComp.city}
                        onChange={(e) => setManualComp((m) => ({ ...m, city: e.target.value }))}
                        placeholder="Chicago"
                      />
                    </div>
                    <div>
                      <Label htmlFor="manual-salePrice-2">Sale price *</Label>
                      <Input
                        id="manual-salePrice-2"
                        type="number"
                        min={1}
                        value={manualComp.salePrice}
                        onChange={(e) => setManualComp((m) => ({ ...m, salePrice: e.target.value }))}
                        placeholder="350000"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="manual-saleDate-2">Sale date</Label>
                      <Input
                        id="manual-saleDate-2"
                        type="date"
                        value={manualComp.saleDate}
                        onChange={(e) => setManualComp((m) => ({ ...m, saleDate: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="manual-livingArea-2">Living area (sq ft)</Label>
                      <Input
                        id="manual-livingArea-2"
                        type="number"
                        min={1}
                        value={manualComp.livingArea}
                        onChange={(e) => setManualComp((m) => ({ ...m, livingArea: e.target.value }))}
                        placeholder="1500"
                      />
                    </div>
                  </div>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? "Adding…" : "Add manual comp"}
                  </Button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowManualForm(true)}
                  className="mt-4 text-sm text-blue-600 hover:text-blue-700"
                >
                  + Add comp manually
                </button>
              )}
            </>
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
