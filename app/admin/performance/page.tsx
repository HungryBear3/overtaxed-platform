import Link from "next/link"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

/**
 * Contingency fee review — WITHDRAWN.
 *
 * The 22% contingency service and its performance-fee invoicing are held. This
 * page previously computed each user's granted savings and fee, then mounted an
 * invoice-create control gated on that eligibility. Both the computation and
 * the control are removed: an operator affordance that says "eligible to
 * invoice" is itself a held-product entry point, even when the API behind it
 * refuses. No contingency user data is read while the hold stands.
 */
export default async function AdminPerformancePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← Admin
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Contingency Fee Review</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">This review surface is withdrawn</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <p>
            The contingency service and contingency fee invoicing are held products. Fee
            eligibility is not calculated and no invoice can be created from this console.
          </p>
          <p className="text-gray-500">
            Restoring this surface requires lifting the product hold, not a change here.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
