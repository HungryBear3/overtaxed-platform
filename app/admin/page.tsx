import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Building2, FileText, AlertCircle } from "lucide-react"

export default async function AdminDashboardPage() {
  const [userCount, propertyCount, appealCount, activeAppeals] = await Promise.all([
    prisma.user.count(),
    prisma.property.count(),
    prisma.appeal.count(),
    prisma.appeal.count({
      where: {
        status: { in: ["DRAFT", "PENDING_FILING", "FILED", "UNDER_REVIEW", "HEARING_SCHEDULED", "DECISION_PENDING"] },
      },
    }),
  ])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
      <p className="text-gray-600 mb-8">Overview of users, properties, and appeals.</p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Users</CardTitle>
            <Users className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">{userCount}</p>
            <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Properties</CardTitle>
            <Building2 className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">{propertyCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Appeals</CardTitle>
            <FileText className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">{appealCount}</p>
            <Link href="/admin/appeals" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Active Appeals</CardTitle>
            <AlertCircle className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">{activeAppeals}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
