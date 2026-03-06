import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { formatPIN } from "@/lib/cook-county"
import { ClipboardCheck } from "lucide-react"

export default async function AdminFilingQueuePage() {
  const appealsWithAuth = await prisma.appeal.findMany({
    where: {
      filingAuthorization: { isNot: null },
      status: { in: ["DRAFT", "PENDING_FILING"] },
    },
    orderBy: [{ filingDeadline: "asc" }, { createdAt: "desc" }],
    include: {
      property: { select: { id: true, pin: true, address: true, city: true, state: true, zipCode: true } },
      user: { select: { id: true, email: true, name: true } },
      filingAuthorization: true,
    },
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Filing Queue</h1>
      <p className="text-gray-600 mb-8">
        Appeals with signed authorization, ready for staff-assisted filing. Use this data when submitting at the Cook County portal.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Appeals with authorization
          </CardTitle>
          <CardDescription>{appealsWithAuth.length} appeal(s) with signed authorization</CardDescription>
        </CardHeader>
        <CardContent>
          {appealsWithAuth.length === 0 ? (
            <p className="text-gray-500 py-8 text-center">No appeals with signed authorization yet.</p>
          ) : (
            <div className="space-y-6">
              {appealsWithAuth.map((a) => {
                const auth = a.filingAuthorization!
                return (
                  <div
                    key={a.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 [color-scheme:light]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">{a.property.address}</h3>
                        <p className="text-sm text-gray-500">
                          PIN {formatPIN(a.property.pin)} · {a.taxYear} · {a.status}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          User: {a.user.email} {a.user.name && `(${a.user.name})`}
                        </p>
                        <p className="text-sm text-gray-500">
                          Filing deadline: {new Date(a.filingDeadline).toLocaleDateString("en-US")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/appeals/${a.id}`}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          View appeal
                        </Link>
                        <a
                          href={`/api/appeals/${a.id}/download-summary`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Appeal packet
                        </a>
                        <a
                          href={`/api/appeals/${a.id}/authorization/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                        >
                          Auth PDF
                        </a>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Authorization data (for county form)
                      </h4>
                      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <span className="text-gray-500">Property:</span>{" "}
                          <span className="text-gray-900">
                            {auth.propertyAddress}, {auth.propertyCity} {auth.propertyState} {auth.propertyZip}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">PIN:</span>{" "}
                          <span className="font-mono text-gray-900">{auth.propertyPin}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Owner:</span>{" "}
                          <span className="text-gray-900">{auth.ownerName}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Email:</span>{" "}
                          <span className="text-gray-900">{auth.ownerEmail}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Phone:</span>{" "}
                          <span className="text-gray-900">{auth.ownerPhone || "—"}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Mailing:</span>{" "}
                          <span className="text-gray-900">
                            {auth.ownerAddress}, {auth.ownerCity} {auth.ownerState} {auth.ownerZip}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Signed:</span>{" "}
                          <span className="text-gray-900">
                            {new Date(auth.signedAt).toLocaleString("en-US")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
