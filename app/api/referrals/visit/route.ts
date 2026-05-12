import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  hostFromRequest,
  isPreviewStubEnabled,
  marketingGateReason,
  previewNoopResponseBody,
} from "@/lib/marketing/preview-gate"

export async function POST(request: NextRequest) {
  // Preview/dev/test: do not record referral visits.
  const host = hostFromRequest(request)
  if (isPreviewStubEnabled({ host })) {
    return NextResponse.json(previewNoopResponseBody(marketingGateReason({ host })))
  }

  try {
    const { code } = await request.json()
    if (!code || typeof code !== "string") {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    await prisma.referral.upsert({
      where: { code },
      update: { visits: { increment: 1 } },
      create: { code, visits: 1 },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
