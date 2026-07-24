import { prisma } from "@/lib/db"
import { getSession } from "@/lib/auth/session"
import { OTNoticeReviewActions } from "@/components/admin/OTNoticeReviewActions"

function money(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export default async function AdminOrdersPage() {
  const session = await getSession()
  if ((session?.user as { role?: string } | undefined)?.role !== "ADMIN") {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-gray-600">Unauthorized.</div>
  }

  const orders = await prisma.oTOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 250,
  })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Orders</h1>
      <p className="mb-8 text-gray-600">OT checkout orders, filing-window evidence, and order-level recovery status.</p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">Received</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Window / Evidence</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Review actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-gray-100 align-top">
                <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                  {order.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{order.name || "—"}</div>
                  <div className="text-gray-600">{order.email}</div>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{order.tier}</td>
                <td className="px-4 py-3 text-gray-700">
                  <div>{order.propertyAddress || "—"}</div>
                  {order.propertyPin ? <div className="text-xs text-gray-500">PIN {order.propertyPin}</div> : null}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  <div>{order.township || "—"} / {order.windowStatus || "—"}</div>
                  <div>Notice: {order.reassessmentNoticeAddress || "—"}</div>
                  <div>Ack: {order.analysisAcknowledgedAt ? "recorded" : "—"}</div>
                  <div>Recovery: {((order as { recoveryReason?: string }).recoveryReason) || "—"}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-900">{money(order.amountPaid)}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {["NOTICE_REVIEW_REQUIRED", "CHECKOUT_PENDING", "CHECKOUT_FAILED"].includes(order.status) && !order.stripeSessionId ? (
                    <OTNoticeReviewActions orderId={order.id} />
                  ) : "—"}
                </td>
              </tr>
            ))}
            {orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-500">
                  No orders found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>


    </div>
  )
}
