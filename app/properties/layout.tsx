import { AppLayout } from "@/components/navigation/app-layout"

export default function PropertiesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppLayout>{children}</AppLayout>
}
