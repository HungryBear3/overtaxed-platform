"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

type ReviewAction = "approve" | "reject" | "revalidate"

export function OTNoticeReviewActions({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState<ReviewAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: ReviewAction) {
    setPending(action)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ot-orders/${encodeURIComponent(orderId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Review action failed")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review action failed")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex min-w-40 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={pending !== null} onClick={() => submit("approve")} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {pending === "approve" ? "Approving…" : "Approve notice"}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => submit("reject")} className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {pending === "reject" ? "Rejecting…" : "Reject notice"}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => submit("revalidate")} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800 disabled:opacity-50">
          {pending === "revalidate" ? "Checking…" : "Revalidate"}
        </button>
      </div>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
