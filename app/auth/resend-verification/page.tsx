"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

export default function ResendVerificationPage() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [message, setMessage] = useState("")
  const [devLink, setDevLink] = useState<string | null>(null)
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/auth/email-status")
      .then((r) => r.json())
      .then((d) => setSmtpConfigured(d.smtpConfigured))
      .catch(() => setSmtpConfigured(null))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("loading")
    setMessage("")
    setDevLink(null)

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (res.ok) {
        setStatus("success")
        if (data._devLink) {
          setMessage("SMTP not configured. Use the link below to verify your email:")
          setDevLink(data._devLink)
        } else {
          setMessage(data.message || "Verification email sent. Check your inbox.")
        }
      } else {
        setStatus("error")
        setMessage(data.error || "Failed to send")
      }
    } catch {
      setStatus("error")
      setMessage("Failed to send verification email")
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-2xl font-bold text-gray-900">
            Resend verification email
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email to receive a new verification link.
          </p>
          {smtpConfigured === false && (
            <p className="mt-2 text-center text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
              SMTP not configured. The verification link will appear below when you submit. Or add{" "}
              <code className="bg-amber-100 px-1">ALLOW_DEV_VERIFICATION_LINK=true</code> to .env.local to always show it.
            </p>
          )}
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {message && (
            <div
              className={`px-4 py-3 rounded-md text-sm ${
                status === "success"
                  ? "bg-green-50 border border-green-200 text-green-700"
                  : "bg-red-50 border border-red-200 text-red-700"
              }`}
            >
              {message}
              {devLink && (
                <a
                  href={devLink}
                  className="mt-2 block font-medium text-blue-600 hover:underline"
                >
                  Click here to verify (dev)
                </a>
              )}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "loading" ? "Sending..." : "Send verification email"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          <Link href="/auth/signin" className="font-medium text-blue-600 hover:text-blue-500">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
