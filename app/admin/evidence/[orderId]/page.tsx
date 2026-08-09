import Link from "next/link"
import { loadAdminEvidenceView } from "@/lib/admin/evidence-loader"
import { EvidenceConsolePanel, EvidenceDisabledPanel } from "@/components/admin/EvidenceConsolePanel"

export const dynamic = "force-dynamic"

export default async function AdminEvidencePage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const result = await loadAdminEvidenceView(orderId)

  if (result.kind === "unauthorized") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center text-sm text-gray-600">Unauthorized.</div>
    )
  }

  if (result.kind === "disabled") {
    return <EvidenceDisabledPanel />
  }

  if (result.kind === "not_found") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-gray-600">Order not found.</p>
        <div className="mt-4">
          <Link href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-900">
            ← Back to orders
          </Link>
        </div>
      </div>
    )
  }

  return (
    <EvidenceConsolePanel
      view={result.view}
      manualReviewControlEnabled={result.manualReviewControlEnabled}
      manualReviewCapability={result.manualReviewCapability}
      adminEvents={result.adminEvents}
    />
  )
}
