"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function openPortal() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to open billing portal")
        return
      }
      if (data.url) {
        window.location.href = data.url
      } else {
        setError("Portal URL not available")
      }
    } catch {
      setError("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        className="h-10"
        onClick={openPortal}
        disabled={loading}
      >
        {loading ? "Opening…" : "Manage subscription (cancel, payment)"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
