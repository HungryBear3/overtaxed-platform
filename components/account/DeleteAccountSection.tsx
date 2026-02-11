"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"

export function DeleteAccountSection() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (confirm !== "DELETE") {
      setError('Type DELETE to confirm.')
      return
    }
    if (!password.trim()) {
      setError("Enter your password.")
      return
    }
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to delete account")
        return
      }
      await signOut({ redirectTo: "/auth/signin" })
    } catch {
      setError("Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <h3 className="text-sm font-semibold text-red-800">Delete account</h3>
      <p className="text-sm text-red-700 mt-1">
        Permanently delete your account and data. This cannot be undone. Some data may be retained as required by law.
      </p>
      <form onSubmit={handleDelete} className="mt-3 space-y-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          className="w-full max-w-xs rounded border border-red-200 px-3 py-2 text-sm text-gray-900"
        />
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder='Type DELETE to confirm'
          className="w-full max-w-xs rounded border border-red-200 px-3 py-2 text-sm text-gray-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </div>
  )
}
