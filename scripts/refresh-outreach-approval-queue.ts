import { readFileSync } from "node:fs"
import { prisma } from "../lib/db"
import defaultSnapshot from "../data/outreach/approval-snapshot.json"

type SnapshotPacket = typeof defaultSnapshot.packets[number]

type Snapshot = {
  source?: string
  packets: SnapshotPacket[]
}

const HUMAN_DECISION_STATUSES = new Set(["approved_no_send", "needs_edit", "blocked"])

function loadSnapshot(): Snapshot {
  const sourceArg = process.argv.find((arg) => arg.startsWith("--source="))
  if (!sourceArg) return defaultSnapshot
  const path = sourceArg.slice("--source=".length)
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot
}

async function main() {
  const snapshot = loadSnapshot()
  let created = 0
  let refreshed = 0
  let preservedDecision = 0

  for (const packet of snapshot.packets) {
    const existing = await prisma.outreachApprovalPacket.findUnique({ where: { externalId: packet.id } })
    const base = {
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
      source: snapshot.source ?? "workspace-docs",
    }

    if (!existing) {
      await prisma.outreachApprovalPacket.create({
        data: {
          externalId: packet.id,
          status: packet.status,
          ...base,
        },
      })
      created += 1
      continue
    }

    const keepStatus = HUMAN_DECISION_STATUSES.has(existing.status)
    await prisma.outreachApprovalPacket.update({
      where: { id: existing.id },
      data: {
        status: keepStatus ? existing.status : packet.status,
        ...base,
      },
    })
    if (keepStatus && existing.status !== packet.status) preservedDecision += 1
    refreshed += 1
  }

  const total = await prisma.outreachApprovalPacket.count()
  console.log(JSON.stringify({ created, refreshed, preservedDecision, total }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => prisma.$disconnect())
