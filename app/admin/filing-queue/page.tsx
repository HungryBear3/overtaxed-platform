import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClipboardCheck } from "lucide-react"
import { FilingQueueRow } from "./FilingQueueRow"

export default async function AdminFilingQueuePage() {
  const appealsWithAuth = await prisma.appeal.findMany({
    where: {
      filingAuthorization: { isNot: null },
      status: { in: ["DRAFT", "PENDING_FILING", "PENDING_STAFF_FILING"] },
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
              {appealsWithAuth.map((a: { id: string; filingDeadline: Date | null; filingAuthorization: unknown }) => (
                <FilingQueueRow
                  key={a.id}
                  appeal={{
                    ...a,
                    filingDeadline: a.filingDeadline,
                    filingAuthorization: a.filingAuthorization!,
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
