"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface PropertyInfo {
  address: string
  city: string
  state: string
  zipCode: string
}

interface UserInfo {
  name: string | null
  email: string
}

interface FilingAuthorizationFormProps {
  appealId: string
  property: PropertyInfo
  user: UserInfo | null
  existingAuth?: {
    id: string
    signedAt: string
    ownerName: string
    ownerEmail: string
  } | null
  onSaved?: () => void
}

export function FilingAuthorizationForm({
  appealId,
  property,
  user,
  existingAuth,
  onSaved,
}: FilingAuthorizationFormProps) {
  const [ownerName, setOwnerName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [ownerAddress, setOwnerAddress] = useState("")
  const [ownerCity, setOwnerCity] = useState("")
  const [ownerState, setOwnerState] = useState("IL")
  const [ownerZip, setOwnerZip] = useState("")
  const [sameAsProperty, setSameAsProperty] = useState(true)
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (existingAuth) {
      setOwnerName(existingAuth.ownerName)
      setOwnerEmail(existingAuth.ownerEmail)
    } else if (user) {
      setOwnerName(user.name || "")
      setOwnerEmail(user.email || "")
    }
  }, [user, existingAuth])

  useEffect(() => {
    if (sameAsProperty) {
      setOwnerAddress(property.address)
      setOwnerCity(property.city)
      setOwnerState(property.state)
      setOwnerZip(property.zipCode)
    }
  }, [sameAsProperty, property])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!agreed) {
      setError("You must agree to the authorization to continue.")
      return
    }
    if (!ownerName.trim()) {
      setError("Your name is required.")
      return
    }
    if (!ownerEmail.trim()) {
      setError("Your email is required.")
      return
    }
    if (!ownerAddress.trim()) {
      setError("Mailing address is required.")
      return
    }
    if (!ownerCity.trim()) {
      setError("City is required.")
      return
    }
    if (!ownerZip.trim()) {
      setError("ZIP code is required.")
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/appeals/${appealId}/authorization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerPhone: ownerPhone.trim() || null,
          ownerAddress: ownerAddress.trim(),
          ownerCity: ownerCity.trim(),
          ownerState: ownerState.trim().toUpperCase().slice(0, 2) || "IL",
          ownerZip: ownerZip.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save authorization")
    } finally {
      setSaving(false)
    }
  }

  if (existingAuth) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="font-medium text-green-800">Authorization on file</p>
        <p className="text-sm text-green-700 mt-1">
          Signed {new Date(existingAuth.signedAt).toLocaleDateString()} by {existingAuth.ownerName}
        </p>
        <p className="text-xs text-green-600 mt-1">{existingAuth.ownerEmail}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-gray-900">
      <p className="text-sm text-gray-600">
        This form captures the information required for the Cook County Assessor Attorney/Representative Authorization.
        OverTaxed will use this to file your appeal on your behalf when staff-assisted filing is available.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ownerName" className="text-gray-900">Your full name *</Label>
          <Input
            id="ownerName"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Property owner name"
            required
            className="bg-white text-gray-900 placeholder:text-gray-400"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ownerEmail" className="text-gray-900">Your email *</Label>
          <Input
            id="ownerEmail"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="bg-white text-gray-900 placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ownerPhone" className="text-gray-900">Daytime phone (optional)</Label>
        <Input
          id="ownerPhone"
          type="tel"
          value={ownerPhone}
          onChange={(e) => setOwnerPhone(e.target.value)}
          placeholder="(312) 555-1234"
          className="bg-white text-gray-900 placeholder:text-gray-400"
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={sameAsProperty}
            onChange={(e) => setSameAsProperty(e.target.checked)}
            className="rounded border-gray-300"
          />
          Mailing address same as property address
        </label>
      </div>

      {!sameAsProperty && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ownerAddress" className="text-gray-900">Mailing address *</Label>
            <Input
              id="ownerAddress"
              value={ownerAddress}
              onChange={(e) => setOwnerAddress(e.target.value)}
              placeholder="Street address"
              required
              className="bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerCity" className="text-gray-900">City *</Label>
            <Input
              id="ownerCity"
              value={ownerCity}
              onChange={(e) => setOwnerCity(e.target.value)}
              placeholder="Chicago"
              required
              className="bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerState" className="text-gray-900">State</Label>
            <Input
              id="ownerState"
              value={ownerState}
              onChange={(e) => setOwnerState(e.target.value)}
              placeholder="IL"
              maxLength={2}
              className="bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ownerZip" className="text-gray-900">ZIP code *</Label>
            <Input
              id="ownerZip"
              value={ownerZip}
              onChange={(e) => setOwnerZip(e.target.value)}
              placeholder="60601"
              required
              className="bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label className="flex items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 rounded border-gray-300"
          />
          <span className="text-gray-900">
            I authorize OverTaxed to act as my representative and file this property tax appeal with the Cook County
            Assessor on my behalf. I certify that I am the property owner or authorized to act for the owner, and that
            the information provided is accurate.
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save authorization"}
      </button>
    </form>
  )
}
