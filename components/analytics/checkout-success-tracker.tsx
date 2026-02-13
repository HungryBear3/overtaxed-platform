"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { analytics } from "@/lib/analytics/events"

/**
 * Tracks conversion events when user returns from Stripe checkout.
 * Place in account layout (success_url = /account?checkout=...).
 */
export function CheckoutSuccessTracker() {
  const searchParams = useSearchParams()
  const tracked = useRef(false)

  useEffect(() => {
    const checkout = searchParams?.get("checkout")
    const slotsAdded = searchParams?.get("slots_added")
    const sessionId = searchParams?.get("session_id")

    if (!checkout || tracked.current) return

    if (checkout === "diy_success") {
      analytics.diyPurchase(69, sessionId ?? undefined)
      tracked.current = true
    } else if (checkout === "success") {
      const addSlots = parseInt(slotsAdded ?? "0", 10)
      const value = addSlots > 0 ? addSlots * 124 : 149
      analytics.subscriptionComplete(addSlots > 0 ? "add_slots" : "subscription", value, sessionId ?? undefined)
      tracked.current = true
    }
  }, [searchParams])

  return null
}
