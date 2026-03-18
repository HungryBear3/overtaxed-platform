"use client"

import { useState } from "react"

interface Township {
  name: string
  district: string
  status: "OPEN" | "UPCOMING" | "CLOSED" | "FUTURE"
  openDate?: string
  closeDate?: string
  cities?: string
}

interface Props {
  townships: Township[]
  /** Pre-select a specific township (e.g. when coming from a geo-targeted link) */
  defaultTownship?: string
}

export function TownshipAlertForm({ townships, defaultTownship }: Props) {
  const [email, setEmail] = useState("")
  const [township, setTownship] = useState(defaultTownship ?? "")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  const actionableTownships = townships.filter(
    (t) => t.status === "OPEN" || t.status === "UPCOMING"
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !township) return
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/township-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, township }),
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
        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-semibold text-green-800">You&apos;re on the list.</p>
        <p className="text-sm text-green-700 mt-1">
          We&apos;ll email you when your township&apos;s appeal window opens — and again 7 days before it closes.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-blue-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-gray-900">
            Get notified when your township&apos;s window opens
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Free. No account needed. We&apos;ll email you when your appeal window opens and remind you 7 days before it closes.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="alert-township" className="block text-xs font-medium text-gray-700 mb-1">
              Your township
            </label>
            <select
              id="alert-township"
              value={township}
              onChange={(e) => setTownship(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select your township…</option>
              <optgroup label="Open Now — South District">
                {actionableTownships
                  .filter((t) => t.status === "OPEN")
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} (Open now)
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Opening Soon — South District">
                {actionableTownships
                  .filter((t) => t.status === "UPCOMING")
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} (Opening soon)
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Future Cycles (2027–2028)">
                {townships
                  .filter((t) => t.status === "FUTURE")
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} — {t.district} District{t.openDate ? ` (${t.openDate})` : ""}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label htmlFor="alert-email" className="block text-xs font-medium text-gray-700 mb-1">
              Your email
            </label>
            <input
              id="alert-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {status === "error" && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={status === "loading" || !email || !township}
          className="w-full sm:w-auto bg-blue-600 text-white font-semibold px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {status === "loading" ? "Saving…" : "Notify me when my window opens"}
        </button>

        <p className="text-xs text-gray-400">
          No spam. Unsubscribe any time. We&apos;ll only email you about your township&apos;s appeal window.
        </p>
      </form>
    </div>
  )
}
