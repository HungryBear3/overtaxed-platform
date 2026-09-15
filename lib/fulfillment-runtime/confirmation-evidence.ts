import { prisma } from "@/lib/db"
import { confirmationEvidenceWritesEnabled } from "@/lib/fulfillment/flag"
export { confirmationEvidenceWritesEnabled } from "@/lib/fulfillment/flag"
import {
  sendOrderConfirmationWithReceipt,
  type EmailSendReceipt,
} from "@/lib/email/send"

/**
 * Phase 1 confirmation-email delivery evidence — strict default-off
 * (OT_CONFIRMATION_EVIDENCE_ENABLED), BEST-EFFORT persistence on the exact
 * newly paid OT settlement path. Contract
 * (see reports/claude/ot-delivery-evidence-phase1-20260831.md):
 * evidence-write failure never changes the webhook acknowledgment, never
 * releases the StripeEvent claim, and never duplicates a notification;
 * all-NULL = never attempted, SENT carries sentAt + provider message id,
 * FAILED carries only a bounded non-PII class; every outcome write is guarded
 * on `confirmationEmailSentAt: null` (first success wins, so a replayed or
 * out-of-order failure can never overwrite a truthful success). Never throws.
 * Promotion to a required write is a separately gated later slice.
 */

export type ConfirmationOrderArgs = {
  tier: string
  customerEmail: string
  customerName?: string
  address?: string
  amountPaid: number
}

export type ConfirmationEvidenceResult = {
  sent: boolean
  evidence: "RECORDED" | "WRITE_FAILED"
}

type ConfirmationSender = (args: ConfirmationOrderArgs) => Promise<EmailSendReceipt>

/** Best-effort "attempt is starting" marker; attemptedAt-IS-NULL guard keeps
 * only the first-ever attempt timestamp. */
async function recordConfirmationEmailAttempt(orderId: string): Promise<boolean> {
  try {
    await prisma.oTOrder.updateMany({
      where: { id: orderId, confirmationEmailAttemptedAt: null },
      data: {
        confirmationEmailStatus: "ATTEMPTED",
        confirmationEmailAttemptedAt: new Date(),
      },
    })
    return true
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError"
    console.error(
      `[confirmation-evidence] attempt write failed orderId=${orderId} error=${name} (best-effort; continuing)`,
    )
    return false
  }
}

/** Best-effort durable outcome write; success persists sentAt + provider
 * message identity, failure only the bounded class (first success wins). */
export async function recordConfirmationEmailOutcome(
  orderId: string,
  receipt: EmailSendReceipt,
): Promise<boolean> {
  try {
    if (receipt.ok) {
      await prisma.oTOrder.updateMany({
        where: { id: orderId, confirmationEmailSentAt: null },
        data: {
          confirmationEmailStatus: "SENT",
          confirmationEmailSentAt: new Date(),
          confirmationEmailMessageId: receipt.providerMessageId,
          confirmationEmailErrorClass: null,
        },
      })
    } else {
      await prisma.oTOrder.updateMany({
        where: { id: orderId, confirmationEmailSentAt: null },
        data: {
          confirmationEmailStatus: "FAILED",
          confirmationEmailErrorClass: receipt.errorClass,
        },
      })
    }
    return true
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError"
    console.error(
      `[confirmation-evidence] outcome write failed orderId=${orderId} sent=${receipt.ok} error=${name} (best-effort; continuing)`,
    )
    return false
  }
}

/**
 * Send the customer confirmation for a newly paid OT order and durably record
 * the attempt and its outcome. Callers must only reach this from the
 * not-already-paid settlement path with the evidence flag enabled; the
 * webhook's alreadyPaid guard remains the replay/no-resend authority.
 */
export async function sendOrderConfirmationWithEvidence(
  orderId: string,
  args: ConfirmationOrderArgs,
  options: { send?: ConfirmationSender } = {},
): Promise<ConfirmationEvidenceResult> {
  const attemptRecorded = await recordConfirmationEmailAttempt(orderId)

  let receipt: EmailSendReceipt
  try {
    receipt = await (options.send ?? sendOrderConfirmationWithReceipt)(args)
  } catch (err) {
    // Sender never throws by contract; boundary so evidence can't break the webhook.
    const name = err instanceof Error ? err.name : "UnknownError"
    console.error(`[confirmation-evidence] sender threw orderId=${orderId} error=${name}`)
    receipt = { ok: false, errorClass: "SEND_EXCEPTION" }
  }

  const outcomeRecorded = await recordConfirmationEmailOutcome(orderId, receipt)

  return {
    sent: receipt.ok,
    evidence: attemptRecorded && outcomeRecorded ? "RECORDED" : "WRITE_FAILED",
  }
}
