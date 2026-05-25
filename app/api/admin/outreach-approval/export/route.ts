import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

async function requireAdmin(request: NextRequest) {
  const session = await getSession(request)
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
  if (!isAdmin) throw new Error("Unauthorized")
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "")
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const packets = await prisma.outreachApprovalPacket.findMany({
      where: { status: "approved_no_send" },
      orderBy: { updatedAt: "desc" },
      include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
    })

    const rows = [
      ["organization", "contact", "channel", "subject", "body", "latest_review_note", "latest_review_actor", "updated_at"],
      ...packets.map((packet) => [
        packet.organization,
        packet.contact,
        packet.channel,
        packet.subject,
        Array.isArray(packet.body) ? packet.body.join("\n\n") : JSON.stringify(packet.body),
        packet.events[0]?.note || packet.events[0]?.action || "",
        packet.events[0]?.actor || "",
        packet.updatedAt.toISOString(),
      ]),
    ]

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="ot-approved-outreach-no-send.csv"',
        "x-ot-outreach-safe-export": "review-only-no-send",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error"
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 })
  }
}
