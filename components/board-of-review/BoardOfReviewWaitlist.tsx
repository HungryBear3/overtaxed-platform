"use client"

import { useState } from "react"

export function BoardOfReviewWaitlist() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/township-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Use a special sentinel township name to track Board of Review waitlist signups
        body: JSON.stringify({ email, township: "Board of Review Waitlist" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Something went wrong")
      setStatus("success")
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong")
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <p className="font-semibold text-green-800">You&apos;re on the list.</p>
        <p className="text-sm text-green-700 mt-1">
          We&apos;ll email you as soon as Board of Review support launches.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">
        Get notified when Board of Review support launches
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        We&apos;ll email you as soon as OverTaxed IL supports Board of Review appeals. No spam.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={status === "loading" || !email}
          className="shrink-0 bg-gray-900 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm"
        >
          {status === "loading" ? "Saving…" : "Notify me"}
        </button>
      </form>
      {status === "error" && (
        <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
      )}
    </div>
  )
}
