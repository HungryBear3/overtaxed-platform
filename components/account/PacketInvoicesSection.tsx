import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type PacketInvoiceRow = {
  id: string
  invoiceNumber: string
  createdAt: Date
  packetStatus: "NOT_STARTED" | "GENERATING" | "READY" | "DELIVERED" | "MANUAL_REVIEW" | "FAILED"
  packetLastError: string | null
  invoiceStatus: "PENDING" | "PAID" | "OVERDUE" | "CANCELLED" | "REFUNDED"
}

const STATUS_COPY: Record<PacketInvoiceRow["packetStatus"], { label: string; tone: string; description: string }> = {
  NOT_STARTED: { label: "Awaiting payment", tone: "text-gray-600 bg-gray-100", description: "Payment not yet confirmed." },
  GENERATING: { label: "Generating", tone: "text-blue-700 bg-blue-50", description: "Building your packet now — usually done in under a minute." },
  READY: { label: "Ready", tone: "text-green-700 bg-green-50", description: "Your packet PDF is ready to download." },
  DELIVERED: { label: "Ready", tone: "text-green-700 bg-green-50", description: "Packet emailed and available below." },
  MANUAL_REVIEW: { label: "Needs review", tone: "text-amber-700 bg-amber-50", description: "Our team was alerted and will reach out — no action needed from you." },
  FAILED: { label: "Error", tone: "text-red-700 bg-red-50", description: "Something went wrong after payment. Support has been notified." },
}

export function PacketInvoicesSection({ rows }: { rows: PacketInvoiceRow[] }) {
  if (rows.length === 0) return null

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Appeal Packets</CardTitle>
        <CardDescription>DIY Pro packets you&apos;ve purchased.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const copy = STATUS_COPY[r.packetStatus]
          return (
            <div key={r.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 text-sm">Packet #{r.invoiceNumber}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${copy.tone}`}>{copy.label}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{copy.description}</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  {new Date(r.createdAt).toLocaleDateString()} · {r.invoiceStatus}
                </p>
              </div>
              <Link
                href={`/account/packets/${r.id}`}
                className="text-sm font-semibold text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
              >
                View →
              </Link>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
