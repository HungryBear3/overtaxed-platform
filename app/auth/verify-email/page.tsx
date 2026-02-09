"use client"

import { useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import Link from "next/link"

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("Missing verification link.")
      return
    }
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setStatus("success")
          setMessage(data.message || "Email verified.")
        } else {
          setStatus("error")
          setMessage(data.error || "Verification failed.")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Something went wrong.")
      })
  }, [token])

  if (status === "loading") {
    return (
      <p className="text-gray-600">Verifying your email…</p>
    )
  }

  if (status === "error") {
    return (
      <div className="space-y-4">
        <p className="text-red-600">{message}</p>
        <Link href="/auth/signin" className="text-blue-600 hover:underline">Back to sign in</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-green-600">{message}</p>
      <Link
        href="/auth/signin"
        className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Sign in
      </Link>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Verify your email</h1>
      <Suspense fallback={<p className="text-gray-600">Loading…</p>}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  )
}
