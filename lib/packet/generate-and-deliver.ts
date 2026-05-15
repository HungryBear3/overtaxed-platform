// Shared appeal-packet fulfillment orchestrator.
// Invoked by:
//   - Stripe webhook (COMPS_ONLY / DIY Pro paid path — fire-and-forget after payment)
//   - Admin "regenerate packet" action (future)
//   - T3/T4 higher-touch tiers (future — same engine, different service wrapper)
//
// Contract:
//   - Input: Invoice.id
//   - Idempotent: guarded by Invoice.packetStatus — READY/DELIVERED are short-circuited
//   - Failure semantics:
//       weak data (no comps, missing requested value) → MANUAL_REVIEW (truthful, not fake success)
//       generation error                             → FAILED (ops alerted, retryable)

import { prisma } from "@/lib/db"

import { generateAppealSummaryPdf } from "@/lib/document-generation/appeal-summary"
import { buildPacketInputs, type AppealForPacket } from "./build-packet-inputs"
import { storePacket } from "./storage"
import {
  sendPacketReadyEmail,
  sendPacketManualReviewAlert,
  sendPacketFailureAlert,
} from "@/lib/email/send"

const MIN_COMPS_FOR_READY = 3
const EMAIL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB — Resend inline attachment ceiling

export type GenerateResult =
  | { ok: true; status: "DELIVERED" | "READY"; pdfUrl: string | null }
  | { ok: false; status: "MANUAL_REVIEW"; reason: string }
  | { ok: false; status: "FAILED"; error: string }
  | { ok: true; status: "SKIPPED"; reason: string }

export async function generatePacketForInvoice(invoiceId: string): Promise<GenerateResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { user: true },
  })
  if (!invoice) return { ok: false, status: "FAILED", error: "Invoice not found" }

  // Payment gate — never generate before payment is confirmed.
  if (invoice.status !== "PAID") {
    return { ok: false, status: "FAILED", error: "Invoice is not PAID" }
  }

  // Idempotency: already done once, don't regenerate unless explicitly reset.
  if (invoice.packetStatus === "READY" || invoice.packetStatus === "DELIVERED") {
    return { ok: true, status: "SKIPPED", reason: `Already ${invoice.packetStatus}` }
  }

  // Resolve the appeal. packetAppealId is preferred; fall back to user's most-recent appeal on the property.
  // Ownership: every Appeal lookup MUST scope by invoice.userId. The fallback path
  // also scopes by invoice.propertyId. We never hand a packet to user A built from user B's appeal.
  let appealId = invoice.packetAppealId
  if (!appealId && invoice.propertyId) {
    const latest = await prisma.appeal.findFirst({
      where: { userId: invoice.userId, propertyId: invoice.propertyId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    appealId = latest?.id ?? null
    if (appealId) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { packetAppealId: appealId } })
    }
  }
  if (!appealId) {
    const msg = "No appeal linked to invoice — cannot generate packet"
    await markManualReview(invoice.id, msg, invoice.user?.email ?? null)
    return { ok: false, status: "MANUAL_REVIEW", reason: msg }
  }

  // Ownership-scoped fetch. If invoice.propertyId is also set, we additionally
  // require the resolved appeal to belong to that property.
  const appeal = await prisma.appeal.findFirst({
    where: {
      id: appealId,
      userId: invoice.userId,
      ...(invoice.propertyId ? { propertyId: invoice.propertyId } : {}),
    },
    include: { property: true, compsUsed: { orderBy: { createdAt: "asc" } } },
  })
  if (!appeal || !appeal.property) {
    const msg = "Appeal or property missing or not owned by purchasing user"
    await markManualReview(invoice.id, msg, invoice.user?.email ?? null)
    return { ok: false, status: "MANUAL_REVIEW", reason: msg }
  }

  // ── Atomic claim: NOT_STARTED|MANUAL_REVIEW|FAILED → GENERATING ────────────
  // updateMany with packetStatus IN the allowed set ensures only ONE caller wins
  // when concurrent webhooks/workers race. Subsequent attempts see count=0 and skip.
  // We also exclude GENERATING here so a worker mid-flight can't be hijacked.
  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      status: "PAID",
      packetStatus: { in: ["NOT_STARTED", "MANUAL_REVIEW", "FAILED"] },
    },
    data: { packetStatus: "GENERATING", packetLastError: null },
  })
  if (claim.count === 0) {
    // Another worker already claimed the row, OR the row drifted out of the
    // allowed set between our read and our claim. Either way, skip safely.
    const fresh = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      select: { packetStatus: true },
    })
    return {
      ok: true,
      status: "SKIPPED",
      reason: `Concurrent claim — packet is ${fresh?.packetStatus ?? "in flight"}`,
    }
  }

  let pdfBytes: Uint8Array
  // pdfUrl is null when storage is in private mode (URL is never surfaced).
  // The download route reads via pdfPath under authenticated server-side `get()`.
  let pdfUrl: string | null
  let pdfPath: string
  try {
    const { data, diagnostics } = await buildPacketInputs(appeal as unknown as AppealForPacket)

    // Weak-data gate: require both usable comps AND a requested value for a READY packet.
    if (diagnostics.compCount < MIN_COMPS_FOR_READY) {
      const msg = `Only ${diagnostics.compCount} comparable(s) available — minimum ${MIN_COMPS_FOR_READY} required`
      await markManualReview(invoice.id, msg, invoice.user?.email ?? null)
      return { ok: false, status: "MANUAL_REVIEW", reason: msg }
    }
    if (diagnostics.requestedAssessmentValue == null) {
      const msg = "Appeal has no requested assessed value — required for packet"
      await markManualReview(invoice.id, msg, invoice.user?.email ?? null)
      return { ok: false, status: "MANUAL_REVIEW", reason: msg }
    }

    pdfBytes = await generateAppealSummaryPdf(data)

    const pinRaw = String(appeal.property.pin ?? "").replace(/\D/g, "").slice(-6)
    const filename = `overtaxed-appeal-${appeal.taxYear}-${pinRaw || "summary"}.pdf`
    pdfPath = `packets/${invoice.id}/${filename}`

    // Storage abstraction. Defaults to private mode — blob URL is never
    // surfaced and reads must go through authenticated `get()`. If
    // OT_PACKET_BLOB_ACCESS=public is set, falls back to bearer-URL semantics
    // protected by random suffix + path allowlist.
    const stored = await storePacket({ pathname: pdfPath, bytes: Buffer.from(pdfBytes) })
    pdfUrl = stored.url
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { packetStatus: "FAILED", packetLastError: error },
    })
    sendPacketFailureAlert(invoice.user?.email ?? null, invoice.id, error).catch((e) =>
      console.error("[packet] failure alert failed:", e),
    )
    return { ok: false, status: "FAILED", error }
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      packetStatus: "READY",
      packetPdfUrl: pdfUrl,
      packetPdfPath: pdfPath,
      packetGeneratedAt: new Date(),
      compPacketGenerated: true,
      packetLastError: null,
    },
  })

  // Deliver: always include signed/download link; attach PDF only if safely small.
  const userEmail = invoice.user?.email
  if (userEmail) {
    const attach = pdfBytes.byteLength <= EMAIL_ATTACHMENT_MAX_BYTES
    try {
      const sent = await sendPacketReadyEmail(userEmail, {
        downloadUrl: `${getAppUrl()}/account/packets/${invoice.id}`,
        invoiceId: invoice.id,
        pdfBytes: attach ? Buffer.from(pdfBytes) : null,
        filename: (pdfPath.split("/").pop() ?? "appeal-packet.pdf"),
      })
      if (sent) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { packetStatus: "DELIVERED", packetDeliveredAt: new Date() },
        })
        return { ok: true, status: "DELIVERED", pdfUrl }
      }
    } catch (e) {
      console.error("[packet] delivery email failed:", e)
    }
  }

  return { ok: true, status: "READY", pdfUrl }
}

async function markManualReview(invoiceId: string, reason: string, userEmail: string | null) {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { packetStatus: "MANUAL_REVIEW", packetLastError: reason },
  })
  sendPacketManualReviewAlert(userEmail, invoiceId, reason).catch((e) =>
    console.error("[packet] manual-review alert failed:", e),
  )
}

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")
}
