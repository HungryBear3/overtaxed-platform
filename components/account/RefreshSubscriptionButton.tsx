"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function RefreshSubscriptionButton() {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  async function syncFromStripe() {
    setSyncing(true)
    setError("")
    setSuccessMsg("")
    try {
      const res = await fetch("/api/billing/sync-subscription", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Sync failed")
        return
      }
      const count = data.subscriptionCount ?? 0
      const qty = data.subscriptionQuantity ?? 0
      setSuccessMsg(
        `Synced: ${qty} slot${qty !== 1 ? "s" : ""}${count > 0 ? ` from ${count} subscription${count !== 1 ? "s" : ""}` : ""}. Reloading…`
      )
      setTimeout(() => window.location.reload(), 1800)
    } catch {
      setError("Something went wrong")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-500">
        If your property count doesn’t match what you paid, sync from Stripe:
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={syncFromStripe}
        disabled={syncing}
      >
        {syncing ? "Syncing…" : "Refresh subscription from Stripe"}
      </Button>
      {successMsg && <p className="text-sm text-green-700">{successMsg}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
