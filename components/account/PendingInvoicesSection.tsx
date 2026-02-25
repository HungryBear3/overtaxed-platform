"use client"

import { useState } from "react"

type Invoice = {
  id: string
  invoiceNumber: string
  amount: number
  invoiceType: string
  status: string
  dueDate: string
}

export function PendingInvoicesSection({ invoices }: { invoices: Invoice[] }) {
  const [loading, setLoading] = useState<string | null>(null)

  async function handlePay(invoiceId: string) {
    setLoading(invoiceId)
    try {
      const res = await fetch("/api/billing/pay-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to create payment")
      if (data.url) window.location.href = data.url
    } catch (err) {
      alert(err instanceof Error ? err.message : "Payment failed")
    } finally {
      setLoading(null)
    }
  }

  const pending = invoices.filter((i) => i.status === "PENDING" && i.invoiceType === "PERFORMANCE_FEE")
  if (pending.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h4 className="text-sm font-medium text-amber-900">Pending Performance Fee Invoice(s)</h4>
      <ul className="mt-2 space-y-2">
        {pending.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between text-sm">
            <span>
              {inv.invoiceNumber} – ${inv.amount.toFixed(2)} (due {new Date(inv.dueDate).toLocaleDateString()})
            </span>
            <button
              onClick={() => handlePay(inv.id)}
              disabled={!!loading}
              className="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading === inv.id ? "Redirecting…" : "Pay now"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
