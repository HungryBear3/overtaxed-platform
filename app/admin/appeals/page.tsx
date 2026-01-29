import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { formatPIN } from "@/lib/cook-county"

export default async function AdminAppealsPage() {
  const appeals = await prisma.appeal.findMany({
    orderBy: [{ taxYear: "desc" }, { createdAt: "desc" }],
    include: {
      property: { select: { id: true, pin: true, address: true, city: true } },
      user: { select: { id: true, email: true, name: true } },
    },
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Appeals</h1>
      <p className="text-gray-600 mb-8">View and manage all appeals.</p>

      <Card>
        <CardHeader>
          <CardTitle>All appeals</CardTitle>
          <CardDescription>{appeals.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="pb-3 font-medium">Property</th>
                  <th className="pb-3 font-medium">User</th>
                  <th className="pb-3 font-medium">Tax Year</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Outcome</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {appeals.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100">
                    <td className="py-3">
                      <div className="font-medium text-gray-900">{a.property.address}</div>
                      <div className="text-gray-500">{formatPIN(a.property.pin)} · {a.property.city}</div>
                    </td>
                    <td className="py-3">
                      <div className="text-gray-900">{a.user.email}</div>
                      {a.user.name && (
                        <div className="text-gray-500">{a.user.name}</div>
                      )}
                    </td>
                    <td className="py-3 text-gray-600">{a.taxYear}</td>
                    <td className="py-3 text-gray-600">{a.appealType}</td>
                    <td className="py-3">
                      <span
                        className={
                          a.status === "DRAFT"
                            ? "rounded bg-gray-100 px-2 py-0.5 text-gray-700"
                            : a.status === "APPROVED" || a.status === "PARTIALLY_APPROVED"
                              ? "rounded bg-green-100 px-2 py-0.5 text-green-800"
                              : a.status === "DENIED"
                                ? "rounded bg-red-100 px-2 py-0.5 text-red-800"
                                : "rounded bg-blue-100 px-2 py-0.5 text-blue-800"
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="py-3 text-gray-600">{a.outcome ?? "—"}</td>
                    <td className="py-3 text-gray-500">
                      {new Date(a.createdAt).toLocaleDateString("en-US")}
                    </td>
                    <td className="py-3">
                      <Link
                        href={`/appeals/${a.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
