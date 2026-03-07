// GET/PATCH /api/admin/system-config - Read/update system config (rep code, etc.)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

export const COOK_COUNTY_REP_CODE_KEY = "COOK_COUNTY_REP_CODE"
export const FILING_BUSINESS_EMAIL_KEY = "FILING_BUSINESS_EMAIL"

async function requireAdmin(request?: NextRequest) {
  const session = await getSession(request)
  const isAdmin = (session?.user as { role?: string })?.role === "ADMIN"
  if (!isAdmin) throw new Error("Unauthorized")
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { in: [COOK_COUNTY_REP_CODE_KEY, FILING_BUSINESS_EMAIL_KEY] },
      },
    })
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]))
    return NextResponse.json({
      repCode: map[COOK_COUNTY_REP_CODE_KEY] ?? "",
      filingBusinessEmail: map[FILING_BUSINESS_EMAIL_KEY] ?? "",
    })
  } catch (error) {
    console.error("[admin/system-config GET]", error)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request)
    const body = await request.json()
    const repCode = typeof body.repCode === "string" ? body.repCode.trim() : undefined
    const filingBusinessEmail =
      typeof body.filingBusinessEmail === "string" ? body.filingBusinessEmail.trim() : undefined

    if (repCode !== undefined) {
      await prisma.systemConfig.upsert({
        where: { key: COOK_COUNTY_REP_CODE_KEY },
        create: { key: COOK_COUNTY_REP_CODE_KEY, value: repCode },
        update: { value: repCode },
      })
    }
    if (filingBusinessEmail !== undefined) {
      await prisma.systemConfig.upsert({
        where: { key: FILING_BUSINESS_EMAIL_KEY },
        create: { key: FILING_BUSINESS_EMAIL_KEY, value: filingBusinessEmail },
        update: { value: filingBusinessEmail },
      })
    }

    const configs = await prisma.systemConfig.findMany({
      where: {
        key: { in: [COOK_COUNTY_REP_CODE_KEY, FILING_BUSINESS_EMAIL_KEY] },
      },
    })
    const map = Object.fromEntries(configs.map((c) => [c.key, c.value]))
    return NextResponse.json({
      repCode: map[COOK_COUNTY_REP_CODE_KEY] ?? "",
      filingBusinessEmail: map[FILING_BUSINESS_EMAIL_KEY] ?? "",
    })
  } catch (error) {
    console.error("[admin/system-config PATCH]", error)
    return NextResponse.json({ error: "Unauthorized or failed to update" }, { status: 401 })
  }
}
