"use client"

import { useState } from "react"
import { FreeCheckForm } from "./FreeCheckForm"
import { FreeCheckResult, type Result } from "./FreeCheckResult"

export function FreeCheckFormWrapper() {
  const [result, setResult] = useState<Result | null>(null)

  return (
    <div className="space-y-8">
      <FreeCheckForm onResult={setResult} />
      {result && <FreeCheckResult result={result} />}
    </div>
  )
}
