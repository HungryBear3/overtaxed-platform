"use client"

import { useState, useEffect } from "react"
import { FreeCheckForm } from "./FreeCheckForm"
import {
  FreeCheckResult,
  isCanonicalResultOutcome,
  type Result,
} from "./FreeCheckResult"
import { CC_02 } from "@/lib/copy/canonical"

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
    const parsed = JSON.parse(raw) as unknown
    if (isCompleteCachedResult(parsed)) return parsed
    return null
  } catch {
    return null
  }
}

function isNullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

/** Browser JSON is untrusted. Reject partial migrations rather than trying to
 * complete or infer them from optimistic capability fragments. */
function isCompleteCachedResult(value: unknown): value is Result {
  if (!value || typeof value !== "object") return false
  const result = value as Record<string, unknown>
  const subject = result.subject as Record<string, unknown> | null
  if (result.success !== true || !subject || typeof subject !== "object") return false
  if (
    typeof subject.pin !== "string" || subject.pin.trim() === "" ||
    typeof subject.address !== "string" ||
    typeof subject.city !== "string" ||
    typeof subject.zipCode !== "string" ||
    !(subject.township === null || typeof subject.township === "string") ||
    !(subject.neighborhoodCode === null || typeof subject.neighborhoodCode === "string") ||
    !isNullableNumber(subject.taxYear) ||
    !isNullableNumber(subject.assessedTotalValue) ||
    !isNullableNumber(subject.marketValue)
  ) return false
  if (
    typeof result.compCount !== "number" || !Number.isInteger(result.compCount) || result.compCount < 0 ||
    !Array.isArray(result.comps) ||
    !isNullableNumber(result.avgComparableAssessedValue) ||
    !isNullableNumber(result.equityRatio) ||
    typeof result.targetEquityRatio !== "number" || !Number.isFinite(result.targetEquityRatio) ||
    !isNullableNumber(result.avgCompEquityRatio) ||
    !isNullableNumber(result.assessmentGap) ||
    !isNullableNumber(result.potentialOverpaymentPerYear) ||
    !isNullableNumber(result.potentialOverpayment3Year) ||
    !(result.appealArgumentText === null || typeof result.appealArgumentText === "string") ||
    !(result.appealWindowStatus === null || typeof result.appealWindowStatus === "object") ||
    !(result.propertyCharacteristics === null || typeof result.propertyCharacteristics === "object") ||
    typeof result.source !== "string" ||
    !(result.disclosure == null || result.disclosure === CC_02) ||
    !isCanonicalResultOutcome(result.outcome)
  ) return false
  return true
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
