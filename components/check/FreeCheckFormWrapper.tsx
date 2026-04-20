"use client"

import { useState, useEffect } from "react"
import { FreeCheckForm } from "./FreeCheckForm"
import { FreeCheckResult, type Result } from "./FreeCheckResult"

const SESSION_KEY = "freeCheckResult_v1"

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
