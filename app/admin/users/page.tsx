import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { properties: true, appeals: true } },
    },
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Users</h1>
      <p className="text-gray-600 mb-8">Manage customer accounts.</p>

      <Card>
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>{users.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="pb-3 font-medium">Email</th>
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Role</th>
                  <th className="pb-3 font-medium">Plan</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Properties</th>
                  <th className="pb-3 font-medium">Appeals</th>
                  <th className="pb-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100">
                    <td className="py-3 font-medium text-gray-900">{u.email}</td>
                    <td className="py-3 text-gray-600">{u.name ?? "—"}</td>
                    <td className="py-3">
                      <span
                        className={
                          u.role === "ADMIN"
                            ? "rounded bg-amber-100 px-2 py-0.5 text-amber-800"
                            : "text-gray-600"
                        }
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 text-gray-600">{u.subscriptionTier}</td>
                    <td className="py-3 text-gray-600">{u.subscriptionStatus}</td>
                    <td className="py-3 text-gray-600">{u._count.properties}</td>
                    <td className="py-3 text-gray-600">{u._count.appeals}</td>
                    <td className="py-3 text-gray-500">
                      {new Date(u.createdAt).toLocaleDateString("en-US")}
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
