import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import Link from "next/link"

export default async function DashboardPage() {
  const session = await getSession()
  
  if (!session?.user) {
    redirect("/auth/signin")
  }

  const { user } = session

  // Fetch user's properties with latest data
  const properties = await prisma.property.findMany({
    where: { userId: user.id },
    include: {
      appeals: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  })

  // Calculate summary stats
  const totalProperties = properties.length
  const totalAssessmentValue = properties.reduce(
    (sum, p) => sum + (p.currentAssessmentValue ? Number(p.currentAssessmentValue) : 0),
    0
  )
  const totalMarketValue = properties.reduce(
    (sum, p) => sum + (p.currentMarketValue ? Number(p.currentMarketValue) : 0),
    0
  )
  const activeAppeals = await prisma.appeal.count({
    where: {
      userId: user.id,
      status: { in: ["DRAFT", "PENDING_FILING", "FILED", "UNDER_REVIEW", "HEARING_SCHEDULED"] },
    },
  })

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">
            Welcome{user.name ? `, ${user.name}` : ""}!
          </h2>
          <p className="mt-2 text-gray-600">
            Manage your property tax appeals from your dashboard.
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Properties</p>
            <p className="text-3xl font-bold text-gray-900">{totalProperties}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Active Appeals</p>
            <p className="text-3xl font-bold text-blue-600">{activeAppeals}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Total Assessment</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalAssessmentValue)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-sm text-gray-500 uppercase tracking-wide">Total Market Value</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalMarketValue)}</p>
          </div>
        </div>

        {/* Account Status */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Account Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="font-medium text-gray-900">
                {user.subscriptionTier === "COMPS_ONLY" && "DIY reports only ($69/property)"}
                {user.subscriptionTier === "STARTER" && "Starter ($149/property/year)"}
                {user.subscriptionTier === "GROWTH" && "Growth (3–9 properties, $125/property/year)"}
                {user.subscriptionTier === "PORTFOLIO" && "Portfolio (10–20 properties, $100/property/year)"}
                {user.subscriptionTier === "PERFORMANCE" && "Performance (4% of savings, deferred)"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className={`font-medium ${
                user.subscriptionStatus === "ACTIVE" ? "text-green-600" : "text-gray-600"
              }`}>
                {user.subscriptionStatus === "INACTIVE" ? "Free Tier" : user.subscriptionStatus}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Role</p>
              <p className="font-medium text-gray-900">{user.role}</p>
            </div>
          </div>
        </div>

        {/* Recent Properties */}
        {totalProperties > 0 ? (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Your Properties</h3>
              <Link href="/properties" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View All
              </Link>
            </div>
            <div className="divide-y divide-gray-100">
              {properties.map((property) => (
                <Link
                  key={property.id}
                  href={`/properties/${property.id}`}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-gray-900">{property.address}</p>
                      <p className="text-sm text-gray-500">
                        {property.city}, {property.state} {property.zipCode}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">PIN: {property.pin}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">
                        {property.currentMarketValue 
                          ? formatCurrency(Number(property.currentMarketValue))
                          : "—"
                        }
                      </p>
                      <p className="text-xs text-gray-500">Market Value</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-8 mb-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No properties yet</h3>
            <p className="text-gray-500 mb-4">
              Add your first Cook County property to start monitoring assessments.
            </p>
            <Link
              href="/properties/add"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Your First Property
            </Link>
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link
            href="/properties/add"
            className="bg-blue-600 text-white rounded-lg shadow p-6 hover:bg-blue-700 transition-colors"
          >
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <h3 className="text-lg font-medium">Add Property</h3>
            </div>
            <p className="text-blue-100 text-sm">
              Add a Cook County property by PIN.
            </p>
          </Link>

          <Link
            href="/appeals/new"
            className="bg-green-600 text-white rounded-lg shadow p-6 hover:bg-green-700 transition-colors"
          >
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-lg font-medium">Start Appeal</h3>
            </div>
            <p className="text-green-100 text-sm">
              File an appeal to reduce your taxes.
            </p>
          </Link>

          <Link
            href="/appeals"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900">My Appeals</h3>
            </div>
            <p className="text-gray-600 text-sm">
              Track your appeal status and savings.
            </p>
          </Link>

          <Link
            href="/properties"
            className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-2">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900">My Properties</h3>
            </div>
            <p className="text-gray-600 text-sm">
              View and manage your properties.
            </p>
          </Link>
        </div>
    </div>
  )
}
