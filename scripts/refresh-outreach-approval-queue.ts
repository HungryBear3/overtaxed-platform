import { readFileSync } from "node:fs"
import { prisma } from "../lib/db"
import defaultSnapshot from "../data/outreach/approval-snapshot.json"

// Declared explicitly rather than inferred from the checked-in snapshot.
// `typeof defaultSnapshot.packets[number]` only describes the rows that happen
// to be in the file today, so `blockers` and `replySnippet` — optional in the
// schema and absent from most rows — are unrepresentable there.
type SnapshotPacket = {
  id: string
  status: string
  organization: string
  contact: string
  role: string
  township: string
  units: number
  channel: string
  subject: string
  summary: string
  ownerCountNote: string
  draftedBy: string
  updated: string
  risk: string
  body: string[]
  blockers?: string[]
  replySnippet?: string
}

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
