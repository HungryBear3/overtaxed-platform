import type { Metadata } from "next";
import { OutreachApprovalConsole } from "@/components/admin/OutreachApprovalConsole";
import { getOutreachApprovalData } from "@/lib/outreach/approval-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Outreach Approval Queue | OverTaxed IL",
  description: "Internal read-only queue for reviewing HOA outreach records before any manual send step.",
  robots: { index: false, follow: false },
};

export default async function OutreachApprovalPage() {
  const data = await getOutreachApprovalData();
  return <OutreachApprovalConsole data={data} />;
}
