import snapshot from "../data/outreach/approval-snapshot.json"
import { prisma } from "../lib/db"

async function main() {
  let upserted = 0
  for (const packet of snapshot.packets) {
    await prisma.outreachApprovalPacket.upsert({
      where: { externalId: packet.id },
      create: {
        externalId: packet.id,
        status: packet.status,
        organization: packet.organization,
        contact: packet.contact,
        role: packet.role,
        township: packet.township,
        units: packet.units ?? 0,
        channel: packet.channel,
        subject: packet.subject,
        summary: packet.summary,
        ownerCountNote: packet.ownerCountNote,
        draftedBy: packet.draftedBy,
        updatedLabel: packet.updated,
        risk: packet.risk,
        body: packet.body,
        blockers: packet.blockers ?? undefined,
        replySnippet: packet.replySnippet ?? undefined,
        source: snapshot.source,
      },
      update: {
        status: packet.status,
        organization: packet.organization,
        contact: packet.contact,
        role: packet.role,
        township: packet.township,
        units: packet.units ?? 0,
        channel: packet.channel,
        subject: packet.subject,
        summary: packet.summary,
        ownerCountNote: packet.ownerCountNote,
        draftedBy: packet.draftedBy,
        updatedLabel: packet.updated,
        risk: packet.risk,
        body: packet.body,
        blockers: packet.blockers ?? undefined,
        replySnippet: packet.replySnippet ?? undefined,
        source: snapshot.source,
      },
    })
    upserted += 1
  }
  const total = await prisma.outreachApprovalPacket.count()
  console.log(JSON.stringify({ upserted, total }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => prisma.$disconnect())
