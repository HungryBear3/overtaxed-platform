import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ManagedPropertiesList } from "@/components/account/ManagedPropertiesList"
import { SignOutButton } from "@/components/auth/SignOutButton"
import { ManageSubscriptionButton } from "@/components/account/ManageSubscriptionButton"
import { RefreshSubscriptionButton } from "@/components/account/RefreshSubscriptionButton"
import { ProfileForm } from "@/components/account/ProfileForm"
import { DeleteAccountSection } from "@/components/account/DeleteAccountSection"
import { getPropertyLimit } from "@/lib/billing/limits"
import { formatPIN } from "@/lib/cook-county"
import { isAppealSubmitted } from "@/lib/appeals/status"

export default async function AccountPage() {
  const session = await getSession()
  if (!session?.user) redirect("/auth/signin")

  // Fetch fresh user data and properties from DB
  const [freshUser, properties] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        subscriptionStartDate: true,
        subscriptionQuantity: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    }),
    prisma.property.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        pin: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        appeals: { select: { status: true }, orderBy: { taxYear: "desc" }, take: 5 },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  if (!freshUser) {
    redirect("/auth/signin")
  }

  const user = {
    ...session.user,
    name: freshUser.name,
    subscriptionTier: freshUser.subscriptionTier,
    subscriptionStatus: freshUser.subscriptionStatus,
    subscriptionStartDate: freshUser.subscriptionStartDate,
  }

  const tier = user.subscriptionTier ?? "COMPS_ONLY"
  const propertyLimit = getPropertyLimit(tier, freshUser.subscriptionQuantity)
  const canAddMore = properties.length < propertyLimit || propertyLimit >= 999
  const isNewFreeUser = tier === "COMPS_ONLY" && properties.length === 0 && (freshUser.subscriptionQuantity == null || freshUser.subscriptionQuantity === 0)

  const managedProperties = properties.map((p, index) => {
    const appeals = (p as { appeals: { status: string }[] }).appeals ?? []
    const hasSubmittedAppeal = appeals.some((a) => isAppealSubmitted(a.status))
    const appealStatusSummary =
      appeals.length === 0
        ? "No appeal"
        : appeals.some((a) => a.status === "FILED" || a.status === "UNDER_REVIEW" || a.status === "HEARING_SCHEDULED" || a.status === "DECISION_PENDING")
          ? "Appeal filed / in progress"
          : appeals.some((a) => a.status === "DRAFT" || a.status === "PENDING_FILING")
            ? "Draft appeal"
            : appeals.some((a) => a.status === "APPROVED" || a.status === "PARTIALLY_APPROVED" || a.status === "DENIED")
              ? "Appeal decided"
              : "Appeal"
    return {
      id: p.id,
      pin: formatPIN(p.pin),
      address: p.address,
      city: p.city,
      state: p.state,
      zipCode: p.zipCode,
      slotNumber: index + 1,
      appealStatusSummary,
      canRemove: !hasSubmittedAppeal,
    }
  })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Account</h1>
      <p className="text-gray-600 mb-8">Manage your account and subscription.</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your account details and plan</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Plan</p>
              <p className="font-medium text-gray-900">
                {user.subscriptionTier === "COMPS_ONLY" && "DIY reports only ($69/property)"}
                {user.subscriptionTier === "STARTER" && "Starter (1–2 properties, $149/property/year)"}
                {user.subscriptionTier === "GROWTH" && "Growth (3–9 properties, $124/property/year)"}
                {user.subscriptionTier === "PORTFOLIO" && "Portfolio (10–20 properties, $99/property/year)"}
                {user.subscriptionTier === "PERFORMANCE" && "Performance (4% of savings, deferred)"}
              </p>
              {user.subscriptionTier !== "COMPS_ONLY" && user.subscriptionTier !== "PERFORMANCE" && (
                <p className="text-xs text-gray-500 mt-1">
                  Up to {propertyLimit} property slots. Change plan on Pricing.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className={`font-medium ${user.subscriptionStatus === "ACTIVE" ? "text-green-600" : "text-gray-600"}`}>
                {user.subscriptionStatus === "INACTIVE" ? "Free Tier" : user.subscriptionStatus}
              </p>
            </div>
          </div>
          <div className="pt-2 border-t border-gray-100">
            <RefreshSubscriptionButton />
          </div>
          <div className="pt-4 border-t border-gray-100">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Update name, email, or password</h4>
            <ProfileForm initialName={freshUser.name} initialEmail={freshUser.email} />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Managed Properties</CardTitle>
          <CardDescription>
            Properties using your plan slots. Add, edit, or remove properties below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedPropertiesList
            properties={managedProperties}
            propertyLimit={propertyLimit}
            canAddMore={canAddMore}
            isNewFreeUser={isNewFreeUser}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-red-700">Danger zone</CardTitle>
          <CardDescription>Permanently delete your account</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountSection />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4">
        <Link
          href="/pricing"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          Change plan (upgrade or downgrade)
        </Link>
        {freshUser.stripeCustomerId && (
          <ManageSubscriptionButton />
        )}
        <SignOutButton variant="button" />
      </div>
    </div>
  )
}
