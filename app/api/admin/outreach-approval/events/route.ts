import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { canApproveNoSend, isReviewAction, nextStatusForAction } from "@/lib/outreach/approval-actions"

async function requireAdmin(request: NextRequest) {
  const session = await getSession(request)
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
  if (!isAdmin) throw new Error("Unauthorized")
  const user = session?.user as { email?: string | null; name?: string | null }
  return user.email || user.name || "admin"
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdmin(request)
    const body = await request.json()
    const packetId = typeof body.packetId === "string" ? body.packetId : ""
    const action = typeof body.action === "string" ? body.action : ""
    const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null

    if (!packetId || !isReviewAction(action)) {
      return NextResponse.json({ error: "packetId and valid action are required" }, { status: 400 })
    }

    const packet = await prisma.outreachApprovalPacket.findUnique({ where: { id: packetId } })
    if (!packet) return NextResponse.json({ error: "Packet not found" }, { status: 404 })
    if (action === "approve_no_send" && !canApproveNoSend(packet.status as Parameters<typeof canApproveNoSend>[0])) {
      return NextResponse.json({ error: "Blocked, approved, reply, and bounce packets cannot be approved from this queue" }, { status: 409 })
    }

    const nextStatus = nextStatusForAction(action)
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.outreachApprovalEvent.create({
        data: { packetId, action, note, actor },
      })
      const updated = nextStatus
        ? await tx.outreachApprovalPacket.update({ where: { id: packetId }, data: { status: nextStatus } })
        : packet
      return { event, status: updated.status }
    })

    return NextResponse.json({
      ok: true,
      status: result.status,
      event: {
        id: result.event.id,
        action: result.event.action,
        note: result.event.note,
        actor: result.event.actor,
        createdAt: result.event.createdAt.toISOString(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error"
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 })
  }
}
