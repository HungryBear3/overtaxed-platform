import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  hostFromRequest,
  isPreviewStubEnabled,
  marketingGateReason,
  previewNoopResponseBody,
} from "@/lib/marketing/preview-gate"
import { normalizeReferralCode } from "@/lib/referrals/code"

/**
 * Count a visit against a referral an admin already issued. This endpoint is
 * public, so it never creates a referral, never echoes what it was sent, and
 * answers a well-formed unknown code exactly as it answers a known one.
 */
export async function POST(request: NextRequest) {
  // Preview/dev/test: do not record referral visits.
  const host = hostFromRequest(request)
  if (isPreviewStubEnabled({ host })) {
    return NextResponse.json(previewNoopResponseBody(marketingGateReason({ host })))
  }

  let code: string | null
  try {
    const body: unknown = await request.json()
    code = normalizeReferralCode(
      typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined,
    )
  } catch {
    code = null
  }
  if (!code) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  try {
    await prisma.referral.updateMany({
      where: { code },
      data: { visits: { increment: 1 } },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
