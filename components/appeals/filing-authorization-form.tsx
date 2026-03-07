"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { safeResJson } from "@/lib/utils"

function UploadOfficialForm({
  appealId,
  onUploaded,
  hasUpload,
}: {
  appealId: string
  onUploaded?: () => void
  hasUpload: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError("")
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/api/appeals/${appealId}/authorization/upload`, {
        method: "POST",
        body: formData,
      })
      const data = await safeResJson<{ error?: string }>(res)
      if (!res.ok) throw new Error(data.error || "Upload failed")
      onUploaded?.()
      if (inputRef.current) inputRef.current.value = ""
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-900 mb-1">
        {hasUpload ? "Replace" : "Upload"} signed official Cook County form
      </p>
      <p className="text-xs text-gray-600 mb-2">
        Download the form from the link above, sign it, and upload the PDF here. Staff will use this when filing.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        disabled={uploading}
        className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
      />
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}

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

// Direct PDF link to official Cook County Attorney/Representative Authorization form
const OFFICIAL_FORM_URL = "https://prodassets.cookcountyassessoril.gov/s3fs-public/form_documents/attorneyrepresentativeauthorizationform.pdf?VersionId=Lf5aaF.oc6aPygRAoAqn2JS5B56_MAxa"

interface FilingAuthorizationFormProps {
  appealId: string
  property: PropertyInfo
  user: UserInfo | null
  existingAuth?: {
    id: string
    signedAt: string
    ownerName: string
    ownerEmail: string
    uploadedPdfUrl?: string | null
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
      const data = await safeResJson<{ error?: string }>(res)
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
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 [color-scheme:light]">
          <p className="font-medium text-green-800">Authorization complete</p>
          <p className="text-sm text-green-700 mt-1">
            E-signed {new Date(existingAuth.signedAt).toLocaleDateString()} by {existingAuth.ownerName}
          </p>
          <p className="text-sm text-green-700 mt-1">
            {existingAuth.uploadedPdfUrl
              ? "We've filled the official Cook County form with your information and your e-signature. This is the final document we keep on file and use when filing your appeal."
              : "Your authorization is on file. Download your copy below."}
          </p>
          <a
            href={`/api/appeals/${appealId}/authorization/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download your authorization form
          </a>
        </div>
        <details className="rounded-lg border border-gray-200 p-4">
          <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
            Replace with a different signed form?
          </summary>
          <p className="text-sm text-gray-600 mt-2 mb-2">
            If you prefer to print, sign, and upload the form yourself, you can replace the e-signed version here.
          </p>
          <UploadOfficialForm appealId={appealId} onUploaded={onSaved} hasUpload={!!existingAuth.uploadedPdfUrl} />
        </details>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-gray-900">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-900 mb-2">How it works</p>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside mb-2">
          <li>We fill Cook County&apos;s official authorization form with your property and contact info below.</li>
          <li>You e-sign by checking the authorization box and saving.</li>
          <li>We generate the complete document with your e-signature—that&apos;s the final form we keep on file and use when filing.</li>
        </ol>
        <p className="text-sm text-blue-800">
          Cook County accepts electronic signatures; notarization is not required. You can download your copy after signing.
        </p>
      </div>
      <p className="text-sm font-medium text-gray-700">Your information (we pre-fill the official form with this)</p>

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

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <label className="flex items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 rounded border-gray-300"
          />
          <span className="text-gray-900">
            <strong>E-signature:</strong> I authorize OverTaxed IL to act as my representative and file this property tax appeal with the Cook County
            Assessor on my behalf. I certify that I am the property owner or authorized to act for the owner, and that
            the information provided is accurate. By checking this box and saving, I am electronically signing the official authorization form.
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Generating your authorization form…" : "E-sign and save authorization form"}
      </button>

      <details className="pt-2 border-t border-gray-200">
        <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
          Alternative: prefer to print and sign the form yourself?
        </summary>
        <p className="text-sm text-gray-600 mt-2 mb-2">
          You can download the blank Cook County form, sign it, and upload it here instead of e-signing above.
        </p>
        <a
          href={OFFICIAL_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:text-blue-700 underline mb-2 inline-block"
        >
          Download blank Cook County form →
        </a>
        <UploadOfficialForm appealId={appealId} onUploaded={onSaved} hasUpload={false} />
      </details>
    </form>
  )
}
