"use client"

import { useState, useEffect } from "react"
import { FreeCheckForm } from "./FreeCheckForm"
import { FreeCheckResult } from "./FreeCheckResult"
import { LookupReceiptSchema, type LookupReceipt } from "@/lib/evidence/public-factual-contract"

/**
 * Only the server-issued lookup receipt is cached — never a result body. The
 * shared renderer reloads the result by server ID on every mount, so a stale
 * or hand-edited entry can at most point at a record the server still holds.
 *
 * Earlier keys carried normalized result bodies whose argument text read
 * "estimated overpayment of $X/year". They are removed unread.
 */
const SESSION_KEY = "freeCheckReceipt_v3"
const RETIRED_KEYS = ["freeCheckResult_v1", "freeCheckResult_v2"]

function loadCachedReceipt(): LookupReceipt | null {
  try {
    for (const k of RETIRED_KEYS) sessionStorage.removeItem(k)
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = LookupReceiptSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function saveCachedReceipt(receipt: LookupReceipt): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(receipt))
  } catch {
    // sessionStorage unavailable (private browsing quota, etc.) — silent
  }
}

function clearCachedReceipt(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function FreeCheckFormWrapper() {
  const [receipt, setReceipt] = useState<unknown>(null)

  useEffect(() => {
    const cached = loadCachedReceipt()
    if (cached) setReceipt(cached)
  }, [])

  function handleResult(r: unknown) {
    setReceipt(r)
    const parsed = LookupReceiptSchema.safeParse(r)
    if (parsed.success) saveCachedReceipt(parsed.data)
    else clearCachedReceipt()
  }

  function handleReset() {
    setReceipt(null)
    clearCachedReceipt()
  }

  return (
    <div className="space-y-8">
      <FreeCheckForm onResult={handleResult} onReset={handleReset} />
      {receipt !== null && <FreeCheckResult result={receipt} />}
    </div>
  )
}
