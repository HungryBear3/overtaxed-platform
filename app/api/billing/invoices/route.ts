// GET /api/billing/invoices - List user's invoices (Performance Fee and subscription)
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const invoices = await prisma.invoice.findMany({
      where: { userId: session.user.id },
      orderBy: { dueDate: "desc" },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        invoiceType: true,
        status: true,
        dueDate: true,
        paidAt: true,
        installmentNumber: true,
        taxSavingsTotal: true,
      },
    })

    return NextResponse.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        amount: Number(i.amount),
        invoiceType: i.invoiceType,
        status: i.status,
        dueDate: i.dueDate.toISOString(),
        paidAt: i.paidAt?.toISOString() ?? null,
        installmentNumber: i.installmentNumber,
        taxSavingsTotal: i.taxSavingsTotal ? Number(i.taxSavingsTotal) : null,
      })),
    })
  } catch (error) {
    console.error("[invoices] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
