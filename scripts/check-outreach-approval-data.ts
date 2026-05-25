import { getOutreachApprovalData } from "../lib/outreach/approval-queue"

async function main() {
  const data = await getOutreachApprovalData()
  console.log(JSON.stringify({
    source: data.source,
    counts: data.counts,
    packets: data.packets.length,
    sample: data.packets[0]
      ? { status: data.packets[0].status, organization: data.packets[0].organization }
      : null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
