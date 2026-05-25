import { prisma } from "@/lib/db"
import snapshot from "@/data/outreach/approval-snapshot.json"

export type OutreachApprovalStatus =
  | "needs_review"
  | "approved_no_send"
  | "sent_monitoring"
  | "blocked"
  | "bounced"
  | "reply"

export type OutreachApprovalEvent = {
  id: string
  action: string
  note: string | null
  actor: string
  createdAt: string
}

export type OutreachApprovalPacket = {
  id: string
  status: OutreachApprovalStatus
  organization: string
  contact: string
  role: string
  township: string
  units: number
  channel: "Email" | "Manual call"
  subject: string
  summary: string
  ownerCountNote: string
  draftedBy: "Rex" | "Abigail"
  updated: string
  risk: "low" | "medium" | "blocked"
  body: string[]
  blockers?: string[]
  replySnippet?: string
  auditTrail?: OutreachApprovalEvent[]
}

export type OutreachApprovalData = {
  packets: OutreachApprovalPacket[]
  counts: Record<OutreachApprovalStatus | "all", number>
  source: "database" | "workspace-docs"
  generatedAt: string
}

type ApprovalPacketRow = Awaited<ReturnType<typeof loadApprovalPacketRows>>[number]
type ProspectRow = Awaited<ReturnType<typeof loadProspectRows>>[number]
type SendRow = Awaited<ReturnType<typeof loadSendRows>>[number]
type ReplyRow = Awaited<ReturnType<typeof loadReplyRows>>[number]
type SuppressionRow = Awaited<ReturnType<typeof loadSuppressionRows>>[number]

const READY_STATUSES = new Set(["ok", "needs_review"])
const MONITORING_STATUSES = new Set(["queued", "sent", "delivered", "delivery_delayed", "opened", "clicked"])
const BOUNCED_STATUSES = new Set(["bounced", "complained", "suppressed", "skipped"])

function normalizeStatus(status: string): OutreachApprovalStatus {
  if (["needs_review", "approved_no_send", "sent_monitoring", "blocked", "bounced", "reply"].includes(status)) {
    return status as OutreachApprovalStatus
  }
  return "needs_review"
}

function normalizeRisk(risk: string): OutreachApprovalPacket["risk"] {
  if (risk === "low" || risk === "medium" || risk === "blocked") return risk
  return "medium"
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function bodyArray(value: unknown): string[] {
  const parsed = stringArray(value)
  return parsed?.length ? parsed : ["Record imported from the real outreach workspace. No outbound controls are available here."]
}

function packetFromApprovalRow(row: ApprovalPacketRow): OutreachApprovalPacket {
  return {
    id: row.id,
    status: normalizeStatus(row.status),
    organization: row.organization,
    contact: row.contact,
    role: row.role,
    township: row.township,
    units: row.units,
    channel: row.channel === "Manual call" ? "Manual call" : "Email",
    subject: row.subject,
    summary: row.summary,
    ownerCountNote: row.ownerCountNote,
    draftedBy: row.draftedBy === "Abigail" ? "Abigail" : "Rex",
    updated: formatRelativeDate(row.updatedAt),
    risk: normalizeRisk(row.risk),
    body: bodyArray(row.body),
    blockers: stringArray(row.blockers),
    replySnippet: row.replySnippet ?? undefined,
    auditTrail: row.events.map((event) => ({
      id: event.id,
      action: event.action,
      note: event.note,
      actor: event.actor,
      createdAt: event.createdAt.toISOString(),
    })),
  }
}

function formatRelativeDate(date: Date | null | undefined): string {
  if (!date) return "No timestamp"
  const now = Date.now()
  const diffMs = Math.max(0, now - date.getTime())
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function redactEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "[redacted contact]"
  const safeLocal = local.length <= 2 ? `${local[0] ?? "x"}…` : `${local.slice(0, 2)}…`
  return `${safeLocal}@${domain}`
}

function inferTownship(row: { buildingAddressNormalized?: string | null; buildingAddressRaw?: string | null }): string {
  const source = row.buildingAddressNormalized || row.buildingAddressRaw || "Unknown"
  const parts = source.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return "Unknown"
}

function unitsFromPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0
  const obj = payload as Record<string, unknown>
  const candidates = [obj.units, obj.unitCount, obj.unit_count, obj.numberOfUnits]
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.replace(/,/g, ""), 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function boardLabel(row: { boardName?: string | null; buildingName?: string | null; buildingAddressRaw?: string | null }): string {
  return row.boardName || row.buildingName || row.buildingAddressRaw || "Unnamed outreach prospect"
}

function campaignName(campaign?: { name: string } | null): string {
  return campaign?.name || "unassigned campaign"
}

function subjectForProspect(row: ProspectRow): string {
  return `Cook County assessment resource for ${boardLabel(row)}`
}

function bodyForProspect(row: ProspectRow): string[] {
  const label = boardLabel(row)
  const address = row.buildingAddressRaw || row.buildingAddressNormalized
  const addressLine = address ? `Public-record context: ${address}.` : "Public-record context is attached to this prospect row."
  return [
    `Draft for ${label}.`,
    "We prepared a short Cook County property-tax resource residents can use to check township deadlines and compare assessment context from public records.",
    "This should stay framed as a resident resource, not an association endorsement, resident list request, legal advice, or savings promise.",
    addressLine,
    "Sender remains disabled here. Approval only marks wording/readiness for a separate manual process.",
  ]
}

function packetFromProspect(row: ProspectRow): OutreachApprovalPacket {
  const isRejected = row.rowStatus === "rejected"
  const isRecentlyContacted = Boolean(row.lastContactedAt)
  const blocked = isRejected || isRecentlyContacted
  return {
    id: row.id,
    status: blocked ? "blocked" : "needs_review",
    organization: boardLabel(row),
    contact: redactEmail(row.boardEmail),
    role: "Board/contact email",
    township: inferTownship(row),
    units: unitsFromPayload(row.rawPayload),
    channel: "Email",
    subject: subjectForProspect(row),
    summary: blocked
      ? "Prospect is not send-ready. Review blocker details before any future manual sender step."
      : `Prospect from ${campaignName(row.campaign)} awaiting human copy/safety review.`,
    ownerCountNote: "Uses source prospect data only; no exact savings or over-assessment claim generated.",
    draftedBy: "Rex",
    updated: formatRelativeDate(row.updatedAt),
    risk: blocked ? "blocked" : row.rowStatus === "needs_review" ? "medium" : "low",
    blockers: [
      ...(isRejected ? ["Prospect row_status is rejected"] : []),
      ...(isRecentlyContacted ? ["Already contacted; cooldown/manual review required"] : []),
    ],
    body: bodyForProspect(row),
  }
}

function packetFromSend(row: SendRow): OutreachApprovalPacket {
  const status: OutreachApprovalStatus = MONITORING_STATUSES.has(row.status)
    ? "sent_monitoring"
    : BOUNCED_STATUSES.has(row.status)
      ? "bounced"
      : "blocked"
  const prospect = row.prospect
  const blockers = status === "bounced"
    ? [row.skippedReason, row.bounceType, row.bounceReason].filter((item): item is string => Boolean(item))
    : []

  return {
    id: row.id,
    status,
    organization: boardLabel(prospect),
    contact: redactEmail(row.email),
    role: "Outreach recipient",
    township: inferTownship(prospect),
    units: unitsFromPayload(prospect.rawPayload),
    channel: "Email",
    subject: `${row.status} · ${campaignName(row.campaign)}`,
    summary: `Real send row is ${row.status}. This screen is read-only and cannot resend or retry.`,
    ownerCountNote: `Template ${row.templateVersion}; UTM campaign ${row.utmCampaign}.`,
    draftedBy: "Rex",
    updated: formatRelativeDate(row.updatedAt),
    risk: status === "bounced" ? "blocked" : "medium",
    blockers: blockers.length ? blockers : undefined,
    body: [
      `Campaign: ${campaignName(row.campaign)}.`,
      `Current provider status: ${row.status}.`,
      row.deliveredAt ? `Delivered ${formatRelativeDate(row.deliveredAt)}.` : "No delivered timestamp on this row.",
      "No resend control is available here. Handle retries from the gated send workflow only.",
    ],
  }
}

function packetFromReply(row: ReplyRow): OutreachApprovalPacket {
  const prospect = row.prospect
  const isOptOut = row.replyType === "opt_out" || /unsubscribe|remove/i.test(row.bodyText)
  return {
    id: row.id,
    status: "reply",
    organization: prospect ? boardLabel(prospect) : redactEmail(row.email),
    contact: redactEmail(row.email),
    role: "Inbound reply",
    township: prospect ? inferTownship(prospect) : "Unknown",
    units: prospect ? unitsFromPayload(prospect.rawPayload) : 0,
    channel: "Email",
    subject: row.subject || `Reply · ${row.replyType}`,
    summary: `${row.replyType} reply is ${row.status}. Human handling required before any future contact.`,
    ownerCountNote: isOptOut ? "Treat as opt-out/suppression candidate." : "Reply content shown for review only.",
    draftedBy: "Abigail",
    updated: formatRelativeDate(row.createdAt),
    risk: isOptOut || row.replyType === "legal" ? "blocked" : "medium",
    blockers: isOptOut ? ["Opt-out/remove language detected", "Suppress before future outreach"] : undefined,
    replySnippet: row.bodyText.slice(0, 220),
    body: [
      "Inbound reply captured from outreach workflow.",
      row.bodyText.slice(0, 600),
      "Do not send follow-up from this screen.",
    ],
  }
}

function packetFromSuppression(row: SuppressionRow): OutreachApprovalPacket {
  return {
    id: row.id,
    status: "blocked",
    organization: redactEmail(row.email),
    contact: redactEmail(row.email),
    role: "Suppressed recipient",
    township: "Unknown",
    units: 0,
    channel: "Email",
    subject: `Suppressed · ${row.reason}`,
    summary: "Address is in outreach suppression. It must not be contacted by any future send cohort.",
    ownerCountNote: "Suppression is terminal unless manually investigated outside this UI.",
    draftedBy: "Rex",
    updated: formatRelativeDate(row.createdAt),
    risk: "blocked",
    blockers: [row.reason, row.source, row.note].filter((item): item is string => Boolean(item)),
    body: [
      `Suppression reason: ${row.reason}.`,
      `Source: ${row.source}.`,
      "No outbound controls are available on this screen.",
    ],
  }
}


async function loadApprovalPacketRows() {
  return prisma.outreachApprovalPacket.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 75,
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  })
}

async function loadProspectRows() {
  return prisma.outreachProspect.findMany({
    where: { rowStatus: { in: Array.from(READY_STATUSES) } },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 25,
    select: {
      id: true,
      boardName: true,
      buildingName: true,
      buildingAddressRaw: true,
      buildingAddressNormalized: true,
      boardEmail: true,
      rowStatus: true,
      rawPayload: true,
      lastContactedAt: true,
      updatedAt: true,
      campaign: { select: { name: true } },
    },
  })
}

async function loadSendRows() {
  return prisma.outreachSend.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 25,
    select: {
      id: true,
      email: true,
      status: true,
      skippedReason: true,
      deliveredAt: true,
      bounceType: true,
      bounceReason: true,
      templateVersion: true,
      utmCampaign: true,
      createdAt: true,
      updatedAt: true,
      campaign: { select: { name: true } },
      prospect: {
        select: {
          boardName: true,
          buildingName: true,
          buildingAddressRaw: true,
          buildingAddressNormalized: true,
          rawPayload: true,
        },
      },
    },
  })
}

async function loadReplyRows() {
  return prisma.outreachReply.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      email: true,
      replyType: true,
      subject: true,
      bodyText: true,
      status: true,
      createdAt: true,
      prospect: {
        select: {
          boardName: true,
          buildingName: true,
          buildingAddressRaw: true,
          buildingAddressNormalized: true,
          rawPayload: true,
        },
      },
    },
  })
}

async function loadSuppressionRows() {
  return prisma.outreachSuppression.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      email: true,
      reason: true,
      source: true,
      note: true,
      createdAt: true,
    },
  })
}

function countPackets(packets: OutreachApprovalPacket[]): OutreachApprovalData["counts"] {
  return {
    needs_review: packets.filter((packet) => packet.status === "needs_review").length,
    approved_no_send: packets.filter((packet) => packet.status === "approved_no_send").length,
    sent_monitoring: packets.filter((packet) => packet.status === "sent_monitoring").length,
    blocked: packets.filter((packet) => packet.status === "blocked").length,
    bounced: packets.filter((packet) => packet.status === "bounced").length,
    reply: packets.filter((packet) => packet.status === "reply").length,
    all: packets.length,
  }
}

function snapshotData(): OutreachApprovalData {
  const packets = snapshot.packets as OutreachApprovalPacket[]
  return {
    packets,
    counts: countPackets(packets),
    source: "workspace-docs",
    generatedAt: snapshot.generatedAt,
  }
}

export async function getOutreachApprovalData(): Promise<OutreachApprovalData> {
  const approvalPackets = await loadApprovalPacketRows()
  if (approvalPackets.length > 0) {
    const packets = approvalPackets.map(packetFromApprovalRow)
    return {
      packets,
      counts: countPackets(packets),
      source: "database",
      generatedAt: new Date().toISOString(),
    }
  }

  const [prospects, sends, replies, suppressions] = await Promise.all([
    loadProspectRows(),
    loadSendRows(),
    loadReplyRows(),
    loadSuppressionRows(),
  ])

  const packets = [
    ...replies.map(packetFromReply),
    ...suppressions.map(packetFromSuppression),
    ...sends.map(packetFromSend),
    ...prospects.map(packetFromProspect),
  ].slice(0, 75)

  if (packets.length === 0) return snapshotData()

  return {
    packets,
    counts: countPackets(packets),
    source: "database",
    generatedAt: new Date().toISOString(),
  }
}
