import "server-only"

import { normalizePIN } from "@/lib/cook-county"
import { produceNeutralReport as produce } from "@/lib/fulfillment/neutral-report-content"

export async function produceNeutralReport(input: { orderId: string; propertyPin?: string; deadline?: number }) {
  if (process.env.NODE_ENV === "test") {
    return produce({ orderId: input.orderId, propertyPin: input.propertyPin ?? "", deadline: input.deadline })
  }
  if (process.env.OT_NEUTRAL_REPORT_ACTIVE !== "1") return { ok: false as const, blocker: "NEUTRAL_REPORT_INACTIVE" }
  const [{ resolveNeutralOrderAuthority }, { prismaNeutralReportRepository }] = await Promise.all([
    import("@/lib/fulfillment-runtime/neutral-order-authority"),
    import("@/lib/fulfillment-runtime/neutral-report-repository"),
  ])
  const authority = await resolveNeutralOrderAuthority(input.orderId)
  const pin = normalizePIN(authority?.propertyPin ?? "")
  if (!authority || !/^\d{14}$/.test(pin)) return { ok: false as const, blocker: "ORDER_NOT_ADMITTED_OR_SETTLED" }
  return produce({ orderId: input.orderId, propertyPin: pin, deadline: input.deadline }, { active: true, repository: prismaNeutralReportRepository })
}
