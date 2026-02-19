import { AppLayout } from "@/components/navigation/app-layout"

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppLayout>{children}</AppLayout>
}
