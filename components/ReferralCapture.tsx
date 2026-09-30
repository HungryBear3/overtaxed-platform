"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { isClientPreviewStubMode } from "@/lib/marketing/preview-gate-client"
import { normalizeReferralCode } from "@/lib/referrals/code"

export function ReferralCapture() {
  const searchParams = useSearchParams()

  useEffect(() => {
    // Layout already gates the mount in preview, but if anyone else mounts
    // this component directly we must still refuse to set cookies or POST.
    if (isClientPreviewStubMode()) return

    // `?ref=` is visitor-controlled. Anything that is not a canonical code is
    // dropped here: no cookie, no request. Only the canonical form is stored.
    const ref = normalizeReferralCode(searchParams.get("ref"))
    if (ref) {
      // Store in cookie for 30 days
      const expires = new Date()
      expires.setDate(expires.getDate() + 30)
      document.cookie = `ot_ref=${ref}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`

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
