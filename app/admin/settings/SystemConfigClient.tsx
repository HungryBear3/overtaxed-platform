"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SystemConfigClient() {
  const [repCode, setRepCode] = useState("")
  const [filingBusinessEmail, setFilingBusinessEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch("/api/admin/system-config")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load")
        return res.json()
      })
      .then((data) => {
        setRepCode(data.repCode ?? "")
        setFilingBusinessEmail(data.filingBusinessEmail ?? "")
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch("/api/admin/system-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repCode, filingBusinessEmail }),
      })
      if (!res.ok) throw new Error("Failed to save")
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading…</p>
  }

  return (
    <form onSubmit={handleSave}>
      <Card>
        <CardHeader>
          <CardTitle>Filing credentials</CardTitle>
          <CardDescription>
            Rep code from Cook County Board of Review and business email for submitting appeals on behalf of property owners.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repCode">Cook County rep code</Label>
            <Input
              id="repCode"
              value={repCode}
              onChange={(e) => setRepCode(e.target.value)}
              placeholder="e.g. from Board of Review registration"
              className="max-w-md"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="filingBusinessEmail">Business email for filings</Label>
            <Input
              id="filingBusinessEmail"
              type="email"
              value={filingBusinessEmail}
              onChange={(e) => setFilingBusinessEmail(e.target.value)}
              placeholder="e.g. filings@overtaxed-il.com"
              className="max-w-md"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-600">Settings saved.</p>}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </CardContent>
      </Card>
    </form>
  )
}
