import PricingPageClient from "@/components/ot-design/PricingPageClient"
import { neutralReportCopyEnabled } from "@/lib/copy/neutral-report"
import "../ot-design.css"

export default function PricingPage() {
  return <PricingPageClient neutralReport={neutralReportCopyEnabled()} />
}
