import { AppLayout } from "@/components/navigation/app-layout"
import { CheckoutSuccessTracker } from "@/components/analytics/checkout-success-tracker"
import { Suspense } from "react"

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <CheckoutSuccessTracker />
      </Suspense>
      {children}
    </AppLayout>
  )
}
