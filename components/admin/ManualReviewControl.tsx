"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { OTFulfillmentStatus } from "@/lib/fulfillment/types"

export type ManualReviewCapability = {
  eligible: boolean
  status: OTFulfillmentStatus | null
  statusRevision: number | null
  reason: string | null
}

export function ManualReviewControl({
  orderId,
  enabled,
  capability,
}: {
  orderId: string
  enabled: boolean
  capability: ManualReviewCapability
}) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!enabled) return null
  if (!capability.eligible || capability.status === null || capability.statusRevision === null) {
    if (capability.reason === "NO_FULFILLMENT_SUMMARY")
      return <p className="text-xs text-amber-800">Reconciliation is required before an admin hold is available.</p>
    return null
  }

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/evidence/${orderId}/manual-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ENTER_MANUAL_REVIEW",
          expectedStatus: capability.status,
          expectedStatusRevision: capability.statusRevision,
        }),
      })
      const result = await response.json().catch(() => null)
      if (response.status === 409) {
        setMessage("State changed; refresh and review current evidence")
        router.refresh()
      } else if (response.ok && result?.ok === true && result.outcome === "ENTERED_MANUAL_REVIEW") {
        router.refresh()
      } else {
        setMessage("The manual review hold was not applied.")
      }
    } catch {
      setMessage("The manual review hold was not applied.")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">This changes only the recorded state. It does not send or generate anything.</p>
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50"
      >
        {busy ? "Entering manual review…" : "Enter manual review"}
      </button>
      {message && <p role="status" className="text-xs text-amber-800">{message}</p>}
    </div>
  )
}
