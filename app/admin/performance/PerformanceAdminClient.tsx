"use client"

import { useState } from "react"

export function PerformanceAdminClient({
  userId,
  canCreate,
  reason,
}: {
  userId: string
  canCreate: boolean
  reason: string | undefined
}) {
  const [loading, setLoading] = useState(false)

  async function createInvoice() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/create-performance-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? data.reason ?? "Failed")
      alert(`Created ${data.invoiceIds?.length ?? 0} invoice(s)`)
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create invoice")
    } finally {
      setLoading(false)
    }
  }

  if (!canCreate) {
    return (
      <p className="text-xs text-gray-500">
        Cannot create invoice: {reason ?? "unknown"}
      </p>
    )
  }

  return (
    <button
      onClick={createInvoice}
      disabled={loading}
      className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
    >
      {loading ? "Creating…" : "Create invoice"}
    </button>
  )
}
