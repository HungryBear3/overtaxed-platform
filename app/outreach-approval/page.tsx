import type { Metadata } from "next";
import { OutreachApprovalConsole } from "@/components/admin/OutreachApprovalConsole";

export const metadata: Metadata = {
  title: "Outreach Approval Prototype | OverTaxed IL",
  description: "No-send prototype for reviewing HOA outreach drafts before any manual send step.",
  robots: { index: false, follow: false },
};

export default function OutreachApprovalPrototypePage() {
  return <OutreachApprovalConsole />;
}
