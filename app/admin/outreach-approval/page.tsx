import type { Metadata } from "next";
import { OutreachApprovalConsole } from "@/components/admin/OutreachApprovalConsole";

export const metadata: Metadata = {
  title: "Outreach Approval Queue | OverTaxed IL",
  description: "Internal prototype for reviewing HOA outreach drafts before any manual send step.",
  robots: { index: false, follow: false },
};

export default function OutreachApprovalPage() {
  return <OutreachApprovalConsole />;
}
