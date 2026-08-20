"use client"

import { useState, useEffect } from "react"
import { FreeCheckForm } from "./FreeCheckForm"
import { FreeCheckResult, type Result } from "./FreeCheckResult"

/**
 * Bumped from `_v1` deliberately.
 *
 * The payload contract changed: a result now carries `outcome`, `disclosure`,
 * and the window capability flags. A `_v1` entry written by the previous build
 * carries none of them — but it does carry a populated `appealArgumentText`
 * whose body reads "resulting in an estimated overpayment of $X/year". Reading
 * it back under the new renderer replayed that claim to a returning visitor.
 *
 * Renaming the key retires every such entry at once. The gates downstream are
 * still fail-closed on their own, because a key rename protects nothing against
 * the next hand-crafted or partially-migrated payload.
 */
const SESSION_KEY = "freeCheckResult_v2"

function loadCachedResult(): Result | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Result
    // Basic shape guard: must have success and a subject with a pin
    if (parsed?.success && parsed?.subject?.pin) return parsed
    return null
  } catch {
    return null
  }
}

function saveCachedResult(result: Result): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(result))
  } catch {
    // sessionStorage unavailable (private browsing quota, etc.) — silent
  }
}

function clearCachedResult(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function FreeCheckFormWrapper() {
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    const cached = loadCachedResult()
    if (cached) setResult(cached)
  }, [])

  function handleResult(r: Result) {
    setResult(r)
    saveCachedResult(r)
  }

  function handleReset() {
    setResult(null)
    clearCachedResult()
  }

  return (
    <div className="space-y-8">
      <FreeCheckForm onResult={handleResult} onReset={handleReset} />
      {result && <FreeCheckResult result={result} />}
    </div>
  )
}
