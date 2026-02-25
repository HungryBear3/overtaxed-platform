/**
 * Performance Plan: 4% of 3-year tax savings.
 * Aggregation logic for calculating fees and creating invoices.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { createAndSendStripeInvoice } from "@/lib/billing/stripe-invoice"

const FEE_PERCENTAGE = 0.04

export type ThreeYearSavingsResult = {
  totalSavings: number
  feeAmount: number
  appealIds: string[]
  breakdownByYear: Record<number, { savings: number; appealIds: string[] }>
  startYear: number
  endYear: number
}

export type PerformancePlanWindow = {
  startDate: Date
  endDate: Date
  startYear: number
  endYear: number
} | null

/**
 * Get the 3-year performance plan window for a user.
 * Uses performancePlanStartDate; if null, returns null (user not on Performance plan or not yet started).
 */
export async function getPerformancePlanWindow(userId: string): Promise<PerformancePlanWindow> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { performancePlanStartDate: true, subscriptionTier: true },
  })
  if (!user || user.subscriptionTier !== "PERFORMANCE" || !user.performancePlanStartDate) {
    return null
  }
  const start = new Date(user.performancePlanStartDate)
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 3)
  const startYear = start.getFullYear()
  const endYear = startYear + 2 // 3 tax years: startYear, startYear+1, startYear+2
  return { startDate: start, endDate: end, startYear, endYear }
}

/**
 * Get 3-year tax savings for a Performance Plan user.
 * Sums taxSavings from appeals with outcome WON or PARTIALLY_WON within the plan window.
 * Excludes denials. Supports multiple properties and multiple appeals per tax year.
 */
export async function getThreeYearSavings(userId: string): Promise<ThreeYearSavingsResult | null> {
  const window = await getPerformancePlanWindow(userId)
  if (!window) return null

  const appeals = await prisma.appeal.findMany({
    where: {
      userId,
      outcome: { in: ["WON", "PARTIALLY_WON"] },
      taxSavings: { not: null },
      taxYear: { gte: window.startYear, lte: window.endYear },
    },
    select: {
      id: true,
      taxYear: true,
      taxSavings: true,
    },
  })

  const breakdownByYear: Record<number, { savings: number; appealIds: string[] }> = {}
  const appealIds: string[] = []
  let totalSavings = 0

  for (const a of appeals) {
    const savings = a.taxSavings ? Number(a.taxSavings) : 0
    if (savings <= 0) continue
    totalSavings += savings
    appealIds.push(a.id)
    if (!breakdownByYear[a.taxYear]) {
      breakdownByYear[a.taxYear] = { savings: 0, appealIds: [] }
    }
    breakdownByYear[a.taxYear].savings += savings
    breakdownByYear[a.taxYear].appealIds.push(a.id)
  }

  const feeAmount = totalSavings * FEE_PERCENTAGE

  return {
    totalSavings,
    feeAmount,
    appealIds,
    breakdownByYear,
    startYear: window.startYear,
    endYear: window.endYear,
  }
}

/**
 * Check if a Performance Plan user has completed their 3-year window and has savings to invoice.
 * For upfront: invoice when window has ended. For installments: first invoice when first reduction occurs.
 */
export async function shouldCreatePerformanceInvoice(
  userId: string
): Promise<
  | { should: true; savings: ThreeYearSavingsResult; paymentOption: "UPFRONT" | "INSTALLMENTS" }
  | { should: false; reason?: string }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      subscriptionTier: true,
      performancePlanStartDate: true,
      performancePlanPaymentOption: true,
    },
  })
  if (!user || user.subscriptionTier !== "PERFORMANCE") {
    return { should: false, reason: "not_performance_user" }
  }
  if (!user.performancePlanStartDate) {
    return { should: false, reason: "no_plan_start_date" }
  }

  const savings = await getThreeYearSavings(userId)
  if (!savings || savings.totalSavings <= 0) {
    return { should: false, reason: "no_savings" }
  }

  const paymentOption = user.performancePlanPaymentOption ?? "UPFRONT"
  const window = await getPerformancePlanWindow(userId)
  if (!window) return { should: false, reason: "no_window" }

  // Check for existing PERFORMANCE_FEE invoice for this user (idempotency)
  const existing = await prisma.invoice.findFirst({
    where: {
      userId,
      invoiceType: "PERFORMANCE_FEE",
      status: { not: "CANCELLED" },
    },
  })
  if (existing) {
    return { should: false, reason: "invoice_already_exists" }
  }

  const now = new Date()

  if (paymentOption === "UPFRONT") {
    // Invoice when 3-year window has ended
    if (now < window.endDate) {
      return { should: false, reason: "window_not_ended" }
    }
    return { should: true, savings, paymentOption: "UPFRONT" }
  }

  // INSTALLMENTS: first invoice when first reduction occurs (we have savings)
  // For MVP we create one invoice per installment. Installment 1 due 30 days after first reduction.
  // The plan says: first payment due 30 days after first successful appeal reduction.
  const firstAppealDate = await prisma.appeal.findFirst({
    where: {
      userId,
      outcome: { in: ["WON", "PARTIALLY_WON"] },
      taxSavings: { not: null },
      taxYear: { gte: window.startYear, lte: window.endYear },
    },
    orderBy: { decisionDate: "asc" },
    select: { decisionDate: true },
  })
  const anchorDate = firstAppealDate?.decisionDate ?? user.performancePlanStartDate
  // Allow creating first installment when we have savings
  return { should: true, savings, paymentOption: "INSTALLMENTS" }
}

function generateInvoiceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const r = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `INV-PF-${ts}-${r}`
}

/**
 * Create Performance Fee invoice(s).
 * Upfront: one invoice, due 30 days from now (or from final determination).
 * Installments: three invoices (1/3 each), due on anniversaries of first reduction.
 */
export async function createPerformanceFeeInvoice(
  userId: string,
  savings: ThreeYearSavingsResult,
  paymentOption: "UPFRONT" | "INSTALLMENTS"
): Promise<{ invoiceIds: string[] }> {
  const invoiceIds: string[] = []
  const dueOffsetDays = 30

  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { performancePlanStartDate: true },
  })
  const firstReductionDate = await prisma.appeal.findFirst({
    where: {
      userId,
      outcome: { in: ["WON", "PARTIALLY_WON"] },
      taxSavings: { not: null },
      taxYear: { gte: savings.startYear, lte: savings.endYear },
    },
    orderBy: { decisionDate: "asc" },
    select: { decisionDate: true },
  })
  const anchorDate =
    paymentOption === "UPFRONT"
      ? new Date() // Final determination = now (window ended)
      : firstReductionDate?.decisionDate ?? user?.performancePlanStartDate ?? new Date()
  const baseDue = new Date(anchorDate)
  baseDue.setDate(baseDue.getDate() + dueOffsetDays)

  const breakdownJson = JSON.parse(JSON.stringify(savings.breakdownByYear)) as Prisma.InputJsonValue

  if (paymentOption === "UPFRONT") {
    const dueDate = baseDue
    const invoice = await prisma.invoice.create({
      data: {
        userId,
        invoiceNumber: generateInvoiceNumber(),
        amount: savings.feeAmount,
        currency: "USD",
        invoiceType: "PERFORMANCE_FEE",
        performancePlanAppealIds: savings.appealIds,
        taxSavingsTotal: savings.totalSavings,
        taxSavingsBreakdown: breakdownJson as Prisma.InputJsonValue,
        feeAmount: savings.feeAmount,
        paymentOption: "UPFRONT",
        dueDate,
      },
    })
    invoiceIds.push(invoice.id)
    const stripeResult = await createAndSendStripeInvoice({
      ourInvoiceId: invoice.id,
      userId,
      amount: savings.feeAmount,
      invoiceNumber: invoice.invoiceNumber,
    })
    if (stripeResult.success) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { stripeInvoiceId: stripeResult.stripeInvoiceId },
      })
    }
    return { invoiceIds }
  }

  // INSTALLMENTS: 3 equal invoices
  const perInstallment = Math.round((savings.feeAmount / 3) * 100) / 100
  const remainder = Math.round((savings.feeAmount - perInstallment * 3) * 100) / 100
  for (let i = 1; i <= 3; i++) {
    const due = new Date(baseDue)
    due.setFullYear(due.getFullYear() + i - 1)
    const amount = i === 3 ? perInstallment + remainder : perInstallment
    const inv = await prisma.invoice.create({
      data: {
        userId,
        invoiceNumber: generateInvoiceNumber(),
        amount,
        currency: "USD",
        invoiceType: "PERFORMANCE_FEE",
        performancePlanAppealIds: savings.appealIds,
        taxSavingsTotal: savings.totalSavings,
        taxSavingsBreakdown: breakdownJson as Prisma.InputJsonValue,
        feeAmount: amount,
        paymentOption: "INSTALLMENTS",
        installmentNumber: i,
        dueDate: due,
      },
    })
    invoiceIds.push(inv.id)
    const stripeResult = await createAndSendStripeInvoice({
      ourInvoiceId: inv.id,
      userId,
      amount,
      invoiceNumber: inv.invoiceNumber,
      description: `Performance Fee – Installment ${i} of 3 (4% of 3-year tax savings)`,
    })
    if (stripeResult.success) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { stripeInvoiceId: stripeResult.stripeInvoiceId },
      })
    }
  }
  return { invoiceIds }
}
