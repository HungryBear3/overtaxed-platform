"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

export function ReferralCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref && ref.length > 0 && ref.length <= 64) {
      // Store in cookie for 30 days
      const expires = new Date()
      expires.setDate(expires.getDate() + 30)
      document.cookie = `ot_ref=${encodeURIComponent(ref)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`

      // Fire-and-forget visit increment
      fetch("/api/referrals/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ref }),
      }).catch(() => {/* silent */})
    }
  }, [searchParams])

  return null
}
