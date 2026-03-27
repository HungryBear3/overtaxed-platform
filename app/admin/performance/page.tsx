import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PerformanceAdminClient } from "./PerformanceAdminClient"
import {
  getPerformancePlanWindow,
  getThreeYearSavings,
  shouldCreatePerformanceInvoice,
} from "@/lib/billing/performance-fee"

export default async function AdminPerformancePage() {
  const performanceUsers = await prisma.user.findMany({
    where: { subscriptionTier: "PERFORMANCE" },
    select: {
      id: true,
      email: true,
      name: true,
      performancePlanStartDate: true,
      performancePlanPaymentOption: true,
      invoices: {
        where: { invoiceType: "PERFORMANCE_FEE" },
        select: { id: true, status: true, amount: true, dueDate: true },
      },
    },
  })

  const userData = await Promise.all(
    performanceUsers.map(async (u) => {
      const window = await getPerformancePlanWindow(u.id)
      const savings = await getThreeYearSavings(u.id)
      const invoiceCheck = await shouldCreatePerformanceInvoice(u.id)
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        performancePlanStartDate: u.performancePlanStartDate?.toISOString() ?? null,
        performancePlanPaymentOption: u.performancePlanPaymentOption,
        invoices: u.invoices.map((i) => ({
          id: i.id,
          status: i.status,
          amount: Number(i.amount),
          dueDate: i.dueDate.toISOString(),
        })),
        window: window
          ? {
              startYear: window.startYear,
              endYear: window.endYear,
              endDate: window.endDate.toISOString(),
            }
          : null,
        savings: savings
          ? {
              totalSavings: savings.totalSavings,
              feeAmount: savings.feeAmount,
              appealCount: savings.appealIds.length,
            }
          : null,
        canCreateInvoice: invoiceCheck.should,
        invoiceReason: !invoiceCheck.should ? invoiceCheck.reason : null,
      }
    })
  )

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← Admin
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Performance Plan</h1>
      <p className="text-gray-600 mb-8">
        Users on Performance (4% of 3-year savings). Create invoices when eligible.
      </p>

      <div className="space-y-4">
        {userData.length === 0 ? (
          <p className="text-gray-500">No Performance users.</p>
        ) : (
          userData.map((u) => (
            <Card key={u.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {u.name ?? u.email}
                  <span className="ml-2 text-sm font-normal text-gray-500">({u.email})</span>
                </CardTitle>
                <CardDescription>
                  Plan start: {u.performancePlanStartDate ?? "—"} · Payment:{" "}
                  {u.performancePlanPaymentOption ?? "—"} · Window:{" "}
                  {u.window ? `${u.window.startYear}–${u.window.endYear}` : "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {u.savings && (
                  <p className="text-sm">
                    <strong>3-year savings:</strong> ${u.savings.totalSavings.toFixed(2)} → Fee: $
                    {u.savings.feeAmount.toFixed(2)} ({u.savings.appealCount} appeals)
                  </p>
                )}
                {u.invoices.length > 0 && (
                  <p className="text-sm">
                    <strong>Invoices:</strong>{" "}
                    {u.invoices.map((i) => `${i.status} $${i.amount.toFixed(2)}`).join(", ")}
                  </p>
                )}
                <PerformanceAdminClient
                  userId={u.id}
                  canCreate={u.canCreateInvoice}
                  reason={u.invoiceReason ?? undefined}
                />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
