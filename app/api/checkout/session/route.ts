import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { z } from "zod"
import { prisma } from "@/lib/db"
import { getPropertyByPIN, normalizePIN, searchPropertiesByAddress } from "@/lib/cook-county"
import { normalizeFreeCheckSearchInput } from "@/lib/free-check-address"
import { getFreeCheckAppealWindowStatus } from "@/lib/free-check-appeal-window"
import { getClientIdentifier, rateLimit } from "@/lib/rate-limit"
import {
  ASSESSOR_CALENDAR_URL,
  TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
} from "@/lib/appeals/township-deadlines"
import {
  type CheckoutWindowSnapshot,
  issueAnalysisAcknowledgmentToken,
  verifyAnalysisAcknowledgmentToken,
} from "@/lib/checkout/window-gate-token"
import {
  OT_ANALYSIS_ACK_VERSION,
  OT_CHECKOUT_CREATING_LEASE_MS,
  STRIPE_MAX_CHECKOUT_SECONDS,
  STRIPE_MIN_CHECKOUT_SECONDS,
  buildOtContractKey,
  canonicalJson,
  dateKey,
  isWindowSnapshotFresh,
  normalizeEmail,
  normalizeWhitespace,
} from "@/lib/checkout/ot-contract"
import {
  hostFromRequest,
  isPreviewStubEnabled,
  marketingGateReason,
  previewNoopResponseBody,
} from "@/lib/marketing/preview-gate"

const PRICE_MAP: Record<"T2" | "T3", string | undefined> = {
  T2: process.env.STRIPE_PRICE_T2_DIY_PRO?.trim(),
  T3: process.env.STRIPE_PRICE_T3_DFY?.trim(),
}

const PAID_STATUSES = ["PAID", "PAID_RECOVERY_REQUIRED"] as const
const isPaidStatus = (status: string | null | undefined) =>
  PAID_STATUSES.includes(status as (typeof PAID_STATUSES)[number])

function checkoutContractMatches(
  order: {
    tier: string
    email: string
    name: string | null
    propertyAddress: string | null
    propertyPin: string | null
    township: string | null
    windowStatus: string | null
    windowOpenDate: Date | null
    windowCloseDate: Date | null
    windowSourceUpdated: Date | string | null
    eligibilitySnapshot: unknown
    analysisAcknowledgedAt: Date | null
    reassessmentNoticeDate: Date | null
    reassessmentNoticeAddress: string | null
    checkoutAmountCents: number | null
    checkoutCurrency: string | null
  },
  input: {
    tier: "T2" | "T3"
    email: string
    name: string
    propertyAddress: string
    analysisAcknowledged: boolean
    reassessmentNoticeDate: string | null
    reassessmentNoticeAddress: string | null
    checkoutAmountCents: number | null
    checkoutCurrency: string | null
  },
  snapshot: CheckoutWindowSnapshot,
) {
  return order.tier === input.tier &&
    order.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
    order.name === input.name &&
    order.propertyAddress === input.propertyAddress &&
    normalizePIN(order.propertyPin ?? "") === snapshot.pin &&
    order.township === snapshot.township &&
    order.windowStatus === snapshot.status &&
    dateKey(order.windowOpenDate) === snapshot.openDate &&
    dateKey(order.windowCloseDate) === snapshot.closeDate &&
    dateKey(order.windowSourceUpdated) === dateKey(snapshot.sourceUpdated) &&
    canonicalJson(order.eligibilitySnapshot) === canonicalJson(snapshot) &&
    Boolean(order.analysisAcknowledgedAt) === input.analysisAcknowledged &&
    dateKey(order.reassessmentNoticeDate) === input.reassessmentNoticeDate &&
    (order.reassessmentNoticeAddress ?? null) === input.reassessmentNoticeAddress &&
    (order.checkoutAmountCents ?? null) === input.checkoutAmountCents &&
    (order.checkoutCurrency ?? null) === input.checkoutCurrency
}

function checkoutNoticeIdentityMatches(
  order: {
    tier: string
    email: string
    name: string | null
    propertyAddress: string | null
    propertyPin: string | null
    township: string | null
    windowStatus: string | null
    windowOpenDate: Date | null
    windowCloseDate: Date | null
    windowSourceUpdated: Date | string | null
    eligibilitySnapshot: unknown
    reassessmentNoticeDate: Date | null
    reassessmentNoticeAddress: string | null
  },
  input: {
    tier: "T2" | "T3"
    email: string
    name: string
    propertyAddress: string
    reassessmentNoticeDate: string | null
    reassessmentNoticeAddress: string | null
  },
  snapshot: CheckoutWindowSnapshot,
) {
  return order.tier === input.tier &&
    order.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
    order.name === input.name &&
    order.propertyAddress === input.propertyAddress &&
    normalizePIN(order.propertyPin ?? "") === snapshot.pin &&
    order.township === snapshot.township &&
    order.windowStatus === snapshot.status &&
    dateKey(order.windowOpenDate) === snapshot.openDate &&
    dateKey(order.windowCloseDate) === snapshot.closeDate &&
    dateKey(order.windowSourceUpdated) === dateKey(snapshot.sourceUpdated) &&
    canonicalJson(order.eligibilitySnapshot) === canonicalJson(snapshot) &&
    dateKey(order.reassessmentNoticeDate) === input.reassessmentNoticeDate &&
    (order.reassessmentNoticeAddress ?? null) === input.reassessmentNoticeAddress
}

const CheckoutInput = z.object({
  tier: z.enum(["T2", "T3"]),
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(5).max(200),
  checkoutKey: z.string().uuid(),
  propertyPin: z.string().max(32).optional(),
  analysisAcknowledged: z.boolean().optional(),
  acknowledgmentToken: z.string().max(3000).optional(),
  reassessmentNoticeDate: z.string().date().optional(),
  reassessmentNoticeAddress: z.string().trim().min(5).max(200).optional(),
})

type AddressCandidate = {
  pin: string
  address: string
  city: string
  township: string | null
}

async function findOtOrderByContractKey(contractKey: string) {
  if (typeof prisma.oTOrder.findUnique !== "function") return null
  return prisma.oTOrder.findUnique({ where: { contractKey } as any })
}

async function findOtOrderByCheckoutKey(checkoutKey: string) {
  if (typeof prisma.oTOrder.findUnique !== "function") return null
  return prisma.oTOrder.findUnique({ where: { checkoutKey } as any })
}

async function resolveLostCheckoutClaim(orderId: string, stripe: Stripe) {
  if (typeof prisma.oTOrder.findUnique !== "function") {
    return NextResponse.json(
      { error: "A checkout session is already being created. Refresh in a moment.", code: "CHECKOUT_ALREADY_STARTED" },
      { status: 409 },
    )
  }
  const current = await prisma.oTOrder.findUnique({ where: { id: orderId } as any })
  if (!current) {
    return NextResponse.json(
      { error: "This checkout changed while it was starting. Refresh and try again.", code: "CHECKOUT_STATE_UNRESOLVED" },
      { status: 409 },
    )
  }
  if (isPaidStatus(current.status)) {
    return NextResponse.json(
      { error: "This checkout has already been paid.", code: "ORDER_ALREADY_PAID" },
      { status: 409 },
    )
  }
  if (current.status === "CHECKOUT_CREATED" && current.stripeSessionId) {
    const prior = await stripe.checkout.sessions.retrieve(current.stripeSessionId)
    if (prior?.status === "open" && prior.url) return NextResponse.json({ url: prior.url })
  }
  return NextResponse.json(
    { error: "A checkout session is already being created. Refresh in a moment.", code: "CHECKOUT_ALREADY_STARTED" },
    { status: 409 },
  )
}

function candidateFromRecord(record: Record<string, unknown>): AddressCandidate | null {
  const pin = normalizePIN(String(record.pin ?? ""))
  if (pin.length !== 14) return null
  return {
    pin,
    address: String(record.property_address ?? record.prop_address_full ?? "").trim(),
    city: String(record.property_city ?? record.prop_address_city_name ?? "").trim(),
    township: String(record.township_name ?? "").trim() || null,
  }
}

async function resolveProperty(address: string, selectedPin?: string) {
  const normalized = normalizeFreeCheckSearchInput(address)
  const search = await searchPropertiesByAddress(normalized.address, normalized.city || undefined, 5)
  if (!search.success || !search.data?.length) {
    return { error: NextResponse.json({ error: "We could not confirm that Cook County property.", code: "PROPERTY_NOT_FOUND" }, { status: 400 }) }
  }

  const candidates = Array.from(
    new Map(
      search.data
        .map((row) => candidateFromRecord(row as unknown as Record<string, unknown>))
        .filter((row): row is AddressCandidate => Boolean(row))
        .map((row) => [row.pin, row]),
    ).values(),
  )
  const normalizedSelected = selectedPin ? normalizePIN(selectedPin) : ""
  if (!normalizedSelected && candidates.length > 1) {
    return { error: NextResponse.json({ error: "We found more than one possible match.", code: "ADDRESS_AMBIGUOUS", candidates }, { status: 409 }) }
  }
  const selected = normalizedSelected
    ? candidates.find((candidate) => candidate.pin === normalizedSelected)
    : candidates[0]
  if (!selected) {
    return { error: NextResponse.json({ error: "Choose one of the confirmed property matches.", code: "PROPERTY_SELECTION_INVALID", candidates }, { status: 400 }) }
  }

  const result = await getPropertyByPIN(selected.pin)
  if (!result.success || !result.data) {
    return { error: NextResponse.json({ error: "We could not load the confirmed property.", code: "PROPERTY_LOOKUP_FAILED" }, { status: 400 }) }
  }
  return { property: result.data }
}

function currentCookCountyDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function snapshotFor(property: Record<string, unknown>): CheckoutWindowSnapshot {
  const township = String(property.township ?? "").trim() || "Unknown"
  const window = getFreeCheckAppealWindowStatus(township)
  const verifiedAt = `${TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED}T12:00:00.000Z`
  const baseSnapshot: CheckoutWindowSnapshot = {
    pin: normalizePIN(String(property.pin ?? "")),
    township: window.township,
    status: window.status,
    openDate: window.openDate,
    closeDate: window.closeDate,
    sourceUpdated: TOWNSHIP_DEADLINES_2026_SOURCE_UPDATED,
    sourceUrl: ASSESSOR_CALENDAR_URL,
    verifiedAt,
  }
  const status = window.status === "open" && !isWindowSnapshotFresh(baseSnapshot) ? "unknown" : window.status
  return {
    ...baseSnapshot,
    township: window.township,
    status,
    openDate: status === "unknown" ? null : baseSnapshot.openDate,
    closeDate: status === "unknown" ? null : baseSnapshot.closeDate,
  }
}

function publicWindow(snapshot: CheckoutWindowSnapshot) {
  return {
    township: snapshot.township,
    status: snapshot.status,
    openDate: snapshot.openDate,
    closeDate: snapshot.closeDate,
    sourceUpdated: snapshot.sourceUpdated,
    sourceUrl: snapshot.sourceUrl,
    verifiedAt: snapshot.verifiedAt,
  }
}

function windowCloseCutoff(snapshot: CheckoutWindowSnapshot, now: Date = new Date()) {
  if (!snapshot.closeDate) return null
  const close = new Date(`${snapshot.closeDate}T23:59:59.000Z`)
  if (Number.isNaN(close.getTime())) return null
  const max = new Date(now.getTime() + STRIPE_MAX_CHECKOUT_SECONDS * 1000)
  return close.getTime() < max.getTime() ? close : max
}

export async function POST(req: NextRequest) {
  const host = hostFromRequest(req)
  if (isPreviewStubEnabled({ host })) {
    return NextResponse.json(previewNoopResponseBody(marketingGateReason({ host })))
  }

  const { allowed } = rateLimit(getClientIdentifier(req), 10, 60_000)
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait and try again.", code: "CHECKOUT_RATE_LIMITED" },
      { status: 429 },
    )
  }

  const parsed = CheckoutInput.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the checkout details and try again.", code: "INVALID_CHECKOUT_INPUT" }, { status: 400 })
  }
  const input = parsed.data
  const normalizedEmail = normalizeEmail(input.email)
  const priceId = PRICE_MAP[input.tier]
  if (!priceId) {
    return NextResponse.json({ error: "This checkout option is unavailable.", code: "CHECKOUT_TIER_UNAVAILABLE" }, { status: 400 })
  }
  const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeSecret) {
    return NextResponse.json({ error: "Checkout is temporarily unavailable.", code: "CHECKOUT_NOT_CONFIGURED" }, { status: 503 })
  }
  const stripe = new Stripe(stripeSecret)

  const resolved = await resolveProperty(input.address, input.propertyPin)
  if (resolved.error) return resolved.error
  const property = resolved.property as unknown as Record<string, unknown>
  const snapshot = snapshotFor(property)
  const window = publicWindow(snapshot)
  const resolvedPropertyAddress = String(property.address ?? input.address).slice(0, 200)
  const noticeReassessmentDate = input.reassessmentNoticeDate
    ? new Date(`${input.reassessmentNoticeDate}T12:00:00Z`)
    : null
  const normalizedNoticeAddress = input.reassessmentNoticeAddress
    ? normalizeWhitespace(input.reassessmentNoticeAddress)
    : null
  let approvedNoticeOrder: Record<string, unknown> | null = null

  if (input.tier === "T3" && snapshot.status !== "open") {
    if (input.reassessmentNoticeDate && input.reassessmentNoticeAddress) {
      const noticeEvidence = {
        date: input.reassessmentNoticeDate ?? null,
        address: input.reassessmentNoticeAddress ?? null,
      }
      const placeholderContractKey = buildOtContractKey({
        tier: input.tier,
        email: normalizedEmail,
        name: input.name,
        propertyAddress: resolvedPropertyAddress,
        propertyPin: snapshot.pin,
        township: snapshot.township,
        snapshot,
        noticeEvidence,
        acknowledgmentEvidence: { acknowledged: false, version: null },
        priceId: PRICE_MAP[input.tier]!,
        productId: "notice_review_pending",
        amountCents: 0,
        currency: "usd",
      })
      const existingCheckoutOrder = await findOtOrderByCheckoutKey(input.checkoutKey)
      const noticeOrder = existingCheckoutOrder ?? await findOtOrderByContractKey(placeholderContractKey) ?? await prisma.oTOrder.upsert({
        where: {
          contractKey: placeholderContractKey,
        } as any,
        create: {
          contractKey: placeholderContractKey,
          checkoutKey: input.checkoutKey,
          tier: input.tier,
          email: normalizedEmail,
          name: input.name,
          propertyAddress: resolvedPropertyAddress,
          propertyPin: snapshot.pin,
          township: snapshot.township,
          windowStatus: snapshot.status,
          windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
          windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
          windowSourceUpdated: snapshot.sourceUpdated,
          windowVerifiedAt: new Date(snapshot.verifiedAt),
          eligibilitySnapshot: snapshot,
          reassessmentNoticeDate: noticeReassessmentDate,
          reassessmentNoticeAddress: normalizedNoticeAddress,
          noticeEvidence: {
            type: "reassessment_notice",
            date: input.reassessmentNoticeDate,
            address: normalizedNoticeAddress,
          },
          amountPaid: 0,
          status: "NOTICE_REVIEW_REQUIRED",
          noticeReviewStatus: "PENDING",
        } as any,
        update: {},
      })
      if (isPaidStatus(noticeOrder.status)) {
        return NextResponse.json(
          { error: "This checkout has already been paid.", code: "ORDER_ALREADY_PAID" },
          { status: 409 },
        )
      }
      if (!checkoutNoticeIdentityMatches(noticeOrder, {
        tier: input.tier,
        email: normalizedEmail,
        name: input.name,
        propertyAddress: resolvedPropertyAddress,
        reassessmentNoticeDate: input.reassessmentNoticeDate,
        reassessmentNoticeAddress: normalizedNoticeAddress,
      }, snapshot)) {
        return NextResponse.json(
          { error: "This checkout key belongs to a different property or service request. Start a new checkout.", code: "CHECKOUT_KEY_CONFLICT" },
          { status: 409 },
        )
      }
      const durableApprovedNotice = (
        noticeOrder.noticeReviewStatus === "APPROVED" &&
        Boolean(noticeOrder.noticeReviewActionAt) &&
        Boolean(noticeOrder.noticeReviewActionBy)
      )
      const approvedNoticeEligible = (
        durableApprovedNotice &&
        ["NOTICE_REVIEW_REQUIRED", "CHECKOUT_PENDING", "CHECKOUT_FAILED", "CHECKOUT_CREATING", "CHECKOUT_CREATED"].includes(String(noticeOrder.status ?? ""))
      )
      if (
        !approvedNoticeEligible &&
        (
          noticeOrder.status === "CHECKOUT_PENDING" ||
          noticeOrder.status === "CHECKOUT_CREATING" ||
          noticeOrder.status === "CHECKOUT_CREATED" ||
          Boolean(noticeOrder.stripeSessionId)
        )
      ) {
        return NextResponse.json(
          { error: "A checkout session has already been started for this request.", code: "CHECKOUT_ALREADY_STARTED" },
          { status: 409 },
        )
      }
      if (approvedNoticeEligible) {
        approvedNoticeOrder = noticeOrder as Record<string, unknown>
      } else {
        const noticeClaim = await prisma.oTOrder.updateMany({
          where: {
            id: noticeOrder.id,
            checkoutKey: input.checkoutKey,
            tier: input.tier,
            email: normalizedEmail,
            name: input.name,
            propertyAddress: resolvedPropertyAddress,
            propertyPin: snapshot.pin,
            township: snapshot.township,
            windowStatus: snapshot.status,
            windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
            windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
            windowSourceUpdated: snapshot.sourceUpdated,
            eligibilitySnapshot: { equals: snapshot },
            analysisAcknowledgedAt: null,
            reassessmentNoticeDate: noticeReassessmentDate,
            reassessmentNoticeAddress: normalizedNoticeAddress,
            checkoutAmountCents: noticeOrder.checkoutAmountCents ?? null,
            checkoutCurrency: noticeOrder.checkoutCurrency ?? null,
            status: "NOTICE_REVIEW_REQUIRED",
          },
          data: { status: "NOTICE_REVIEW_REQUIRED" },
        })
        if (noticeClaim.count !== 1) {
          return NextResponse.json(
            { error: "This checkout has already been paid.", code: "ORDER_ALREADY_PAID" },
            { status: 409 },
          )
        }
        return NextResponse.json({ error: "We need to verify the reassessment notice before accepting payment.", code: "NOTICE_REVIEW_REQUIRED", window }, { status: 422 })
      }
    }
    if (!approvedNoticeOrder) {
      return NextResponse.json({ error: "Full filing is not available for this property right now.", code: "T3_WINDOW_BLOCKED", window }, { status: 409 })
    }
  }

  let acknowledgedAt: Date | null = null
  if (input.tier === "T2" && snapshot.status !== "open") {
    const validAcknowledgment = Boolean(
      input.analysisAcknowledged &&
      input.acknowledgmentToken &&
      verifyAnalysisAcknowledgmentToken(input.acknowledgmentToken, input.checkoutKey, snapshot),
    )
    if (!validAcknowledgment) {
      return NextResponse.json({
        error: snapshot.status === "closed"
          ? "Your township window is closed. Confirm analysis-only service to continue."
          : "Your township's official date is pending. Confirm analysis-only service to continue.",
        code: "T2_ACKNOWLEDGMENT_REQUIRED",
        window,
        acknowledgmentToken: issueAnalysisAcknowledgmentToken(input.checkoutKey, snapshot),
      }, { status: 409 })
    }
    acknowledgedAt = new Date()
  }

  let checkoutAmountCents: number
  let checkoutCurrency: string
  let checkoutProductId: string
  let authoritativePriceId: string
  try {
    const price = await stripe.prices.retrieve(priceId)
    if (!price.active || price.type !== "one_time" || !Number.isSafeInteger(price.unit_amount) || (price.unit_amount ?? 0) < 50) {
      throw new Error("Stripe Price is not an active fixed one-time amount")
    }
    authoritativePriceId = price.id
    checkoutProductId = typeof price.product === "string" ? price.product : price.product?.id ?? `product_for_${price.id}`
    checkoutAmountCents = price.unit_amount as number
    checkoutCurrency = price.currency.toLowerCase()
  } catch (error) {
    console.error("[checkout/session] price validation failed", error)
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable.", code: "CHECKOUT_PRICE_UNAVAILABLE" },
      { status: 503 },
    )
  }

  const contractKey = buildOtContractKey({
    tier: input.tier,
    email: normalizedEmail,
    name: input.name,
    propertyAddress: resolvedPropertyAddress,
    propertyPin: snapshot.pin,
    township: snapshot.township,
    snapshot,
    noticeEvidence: {
      date: input.reassessmentNoticeDate ?? null,
      address: input.reassessmentNoticeAddress ?? null,
    },
    acknowledgmentEvidence: {
      acknowledged: Boolean(acknowledgedAt),
      version: acknowledgedAt ? OT_ANALYSIS_ACK_VERSION : null,
    },
    priceId: authoritativePriceId,
    productId: checkoutProductId,
    amountCents: checkoutAmountCents,
    currency: checkoutCurrency,
  })

  let orderId: string | null = null
  let claimedCheckoutContract: Record<string, unknown> | null = null
  try {
    let order: any = null
    if (approvedNoticeOrder) {
      if (approvedNoticeOrder.contractKey === contractKey) {
        order = await prisma.oTOrder.findUnique({ where: { id: approvedNoticeOrder.id as string } as any })
      } else {
        const transformableStatus = ["NOTICE_REVIEW_REQUIRED", "CHECKOUT_PENDING", "CHECKOUT_FAILED"].includes(
          String(approvedNoticeOrder.status ?? ""),
        )
        if (!transformableStatus || approvedNoticeOrder.stripeSessionId) {
          return NextResponse.json(
            { error: "This checkout changed while it was being verified. Start a new checkout.", code: "CHECKOUT_KEY_CONFLICT" },
            { status: 409 },
          )
        }
        const converted = await prisma.oTOrder.updateMany({
          where: {
            id: approvedNoticeOrder.id as string,
            checkoutKey: input.checkoutKey,
            contractKey: approvedNoticeOrder.contractKey ?? null,
            attempt: (approvedNoticeOrder.attempt as number | undefined) ?? 0,
            stripeSessionId: null,
            tier: input.tier,
            email: normalizedEmail,
            name: input.name,
            propertyAddress: resolvedPropertyAddress,
            propertyPin: snapshot.pin,
            township: snapshot.township,
            windowStatus: snapshot.status,
            windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
            windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
            windowSourceUpdated: snapshot.sourceUpdated,
            eligibilitySnapshot: { equals: snapshot },
            reassessmentNoticeDate: noticeReassessmentDate,
            reassessmentNoticeAddress: normalizedNoticeAddress,
            noticeReviewStatus: "APPROVED",
            noticeReviewActionAt: approvedNoticeOrder.noticeReviewActionAt as Date,
            noticeReviewActionBy: approvedNoticeOrder.noticeReviewActionBy as string,
            status: approvedNoticeOrder.status as string,
          } as any,
          data: {
            contractKey,
            checkoutPriceId: authoritativePriceId,
            checkoutProductId,
            checkoutAmountCents,
            checkoutCurrency,
            noticeEvidence: {
              type: "reassessment_notice",
              date: input.reassessmentNoticeDate,
              address: normalizedNoticeAddress,
            },
            status: "CHECKOUT_PENDING",
          } as any,
        })
        if (converted.count !== 1) {
          const currentOrder = await findOtOrderByCheckoutKey(input.checkoutKey)
          if (!currentOrder || currentOrder.contractKey !== contractKey) {
            return NextResponse.json(
              { error: "This checkout changed while it was being verified. Start a new checkout.", code: "CHECKOUT_KEY_CONFLICT" },
              { status: 409 },
            )
          }
          order = currentOrder
        } else {
          order = await prisma.oTOrder.findUnique({ where: { id: approvedNoticeOrder.id as string } as any })
        }
      }
    } else {
      order = await prisma.oTOrder.upsert({
        where: { contractKey } as any,
        create: {
          contractKey,
          checkoutKey: input.checkoutKey,
          tier: input.tier,
          email: normalizedEmail,
          name: input.name,
          propertyAddress: resolvedPropertyAddress,
          propertyPin: snapshot.pin,
          township: snapshot.township,
          windowStatus: snapshot.status,
          windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
          windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
          windowSourceUpdated: snapshot.sourceUpdated,
          windowVerifiedAt: new Date(snapshot.verifiedAt),
          eligibilitySnapshot: snapshot,
          analysisAcknowledgedAt: acknowledgedAt,
          acknowledgmentVersion: acknowledgedAt ? OT_ANALYSIS_ACK_VERSION : null,
          acknowledgmentEvidence: acknowledgedAt ? { acknowledged: true, version: OT_ANALYSIS_ACK_VERSION } : null,
          checkoutPriceId: authoritativePriceId,
          checkoutProductId,
          checkoutAmountCents,
          checkoutCurrency,
          amountPaid: 0,
          status: "CHECKOUT_PENDING",
        } as any,
        update: {},
      })
    }
    if (!order) {
      return NextResponse.json(
        { error: "Checkout state could not be loaded. Please try again.", code: "CHECKOUT_STATE_UNRESOLVED" },
        { status: 500 },
      )
    }
    orderId = order.id
    if (isPaidStatus(order.status)) {
      return NextResponse.json(
        { error: "This checkout has already been paid.", code: "ORDER_ALREADY_PAID" },
        { status: 409 },
      )
    }
    if (!checkoutContractMatches(order, {
      tier: input.tier,
      email: normalizedEmail,
      name: input.name,
      propertyAddress: resolvedPropertyAddress,
      analysisAcknowledged: Boolean(acknowledgedAt),
      reassessmentNoticeDate: approvedNoticeOrder ? input.reassessmentNoticeDate ?? null : null,
      reassessmentNoticeAddress: approvedNoticeOrder ? normalizedNoticeAddress : null,
      checkoutAmountCents,
      checkoutCurrency,
    }, snapshot)) {
      return NextResponse.json(
        { error: "This checkout key belongs to a different property or service request. Start a new checkout.", code: "CHECKOUT_KEY_CONFLICT" },
        { status: 409 },
      )
    }
    if (order.status === "NOTICE_REVIEW_REQUIRED") {
      const held = await prisma.oTOrder.updateMany({
        where: {
          id: order.id,
          tier: input.tier,
          email: normalizedEmail,
          propertyPin: snapshot.pin,
          township: snapshot.township,
          windowStatus: snapshot.status,
          windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
          windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
          windowSourceUpdated: snapshot.sourceUpdated,
          eligibilitySnapshot: { equals: snapshot },
          status: "NOTICE_REVIEW_REQUIRED",
        },
        data: { status: "NOTICE_REVIEW_REQUIRED" },
      })
      if (held.count !== 1) {
        return NextResponse.json(
          { error: "This checkout changed while it was being verified. Start a new checkout.", code: "CHECKOUT_KEY_CONFLICT" },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: "This property is already waiting for reassessment-notice review.", code: "NOTICE_REVIEW_REQUIRED", window },
        { status: 422 },
      )
    }
    if (order.status === "CHECKOUT_CREATED" && order.stripeSessionId) {
      const prior = await stripe.checkout.sessions.retrieve(order.stripeSessionId)
      if (prior?.status === "open" && prior.url) return NextResponse.json({ url: prior.url })
      if ((prior as { status?: string | null })?.status === "expired" || (prior as { status?: string | null })?.status === "canceled") {
        const advanced = await prisma.oTOrder.updateMany({
          where: { id: order.id, contractKey: (order as { contractKey?: string }).contractKey, attempt: (order as { attempt?: number }).attempt ?? 0, stripeSessionId: order.stripeSessionId, status: "CHECKOUT_CREATED" } as any,
          data: { stripeSessionId: null, checkoutSessionExpiresAt: null, attempt: { increment: 1 }, status: "CHECKOUT_PENDING" } as any,
        })
        if (advanced.count !== 1) {
          return NextResponse.json({ error: "This checkout changed while it was refreshing. Try again.", code: "CHECKOUT_STATE_UNRESOLVED" }, { status: 500 })
        }
        order.status = "CHECKOUT_PENDING"
        order.stripeSessionId = null
        ;(order as { attempt?: number }).attempt = (((order as { attempt?: number }).attempt) ?? 0) + 1
      } else {
        return NextResponse.json(
          { error: "A checkout session has already been started. Refresh to begin a new request.", code: "CHECKOUT_ALREADY_STARTED" },
          { status: 409 },
        )
      }
    }
    if (order.status === "CHECKOUT_CREATING") {
      const isStale = order.updatedAt instanceof Date
        ? Date.now() - order.updatedAt.getTime() > OT_CHECKOUT_CREATING_LEASE_MS
        : true
      if (!isStale) {
        return NextResponse.json(
          { error: "A checkout session is already being created. Refresh in a moment.", code: "CHECKOUT_ALREADY_STARTED" },
          { status: 409 },
        )
      }
    }

    const cutoff = approvedNoticeOrder ? null : windowCloseCutoff(snapshot)
    const expiresAt = cutoff ? Math.floor(cutoff.getTime() / 1000) : Math.floor((Date.now() + STRIPE_MAX_CHECKOUT_SECONDS * 1000) / 1000)
    if (expiresAt - Math.floor(Date.now() / 1000) < STRIPE_MIN_CHECKOUT_SECONDS) {
      return NextResponse.json(
        { error: "There is not enough filing-window time left to start checkout.", code: "CHECKOUT_WINDOW_TOO_CLOSE", window },
        { status: 409 },
      )
    }

    claimedCheckoutContract = {
      id: order.id,
      contractKey: (order as { contractKey?: string }).contractKey,
      tier: input.tier,
      email: normalizedEmail,
      name: input.name,
      propertyAddress: resolvedPropertyAddress,
      propertyPin: snapshot.pin,
      township: snapshot.township,
      windowStatus: snapshot.status,
      windowOpenDate: snapshot.openDate ? new Date(`${snapshot.openDate}T12:00:00Z`) : null,
      windowCloseDate: snapshot.closeDate ? new Date(`${snapshot.closeDate}T12:00:00Z`) : null,
      windowSourceUpdated: snapshot.sourceUpdated,
      eligibilitySnapshot: { equals: snapshot },
      analysisAcknowledgedAt: acknowledgedAt ? { not: null } : null,
      reassessmentNoticeDate: approvedNoticeOrder ? noticeReassessmentDate : null,
      reassessmentNoticeAddress: approvedNoticeOrder ? normalizedNoticeAddress : null,
      checkoutAmountCents,
      checkoutCurrency,
    }
    const observedStatus = order.status
    const observedAttempt = (order as { attempt?: number }).attempt ?? 0
    const claimWhere = {
      ...claimedCheckoutContract,
      attempt: observedAttempt,
      status: observedStatus,
      ...(observedStatus === "CHECKOUT_CREATING" ? { updatedAt: order.updatedAt } : {}),
    }
    const claimed = await prisma.oTOrder.updateMany({
      where: claimWhere as any,
      data: { status: "CHECKOUT_CREATING" },
    })
    if (claimed.count !== 1) {
      return resolveLostCheckoutClaim(order.id, stripe)
    }

    const baseUrl = process.env.NEXTAUTH_URL || "https://www.overtaxed-il.com"
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      expires_at: expiresAt,
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      customer_email: normalizedEmail,
      metadata: {
        orderId: order.id,
        tier: input.tier,
        windowStatus: snapshot.status,
        windowSourceUpdated: snapshot.sourceUpdated,
      },
    }, { idempotencyKey: `ot:${(order as { contractKey?: string }).contractKey}:${(order as { attempt?: number }).attempt ?? 0}` })

    if (!session.url) throw new Error("Stripe Checkout session returned no hosted URL")

    const finalized = await prisma.oTOrder.updateMany({
      where: { ...claimedCheckoutContract, attempt: observedAttempt, status: "CHECKOUT_CREATING" } as any,
      data: {
        stripeSessionId: session.id,
        checkoutSessionExpiresAt: new Date(expiresAt * 1000),
        status: "CHECKOUT_CREATED",
      } as any,
    })
    if (finalized.count !== 1) throw new Error("Checkout contract changed before provider finalization")
    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("[checkout/session] checkout creation failed", error)
    if (orderId && claimedCheckoutContract) {
      try {
        const failed = await prisma.oTOrder.updateMany({
          where: { ...claimedCheckoutContract, id: orderId, status: "CHECKOUT_CREATING" },
          data: { status: "CHECKOUT_FAILED" },
        })
        if (failed.count !== 1) {
          console.error(`[checkout/session] failed to finalize checkout failure state for order ${orderId}`)
          return NextResponse.json(
            { error: "Checkout state could not be finalized. Please contact support.", code: "CHECKOUT_STATE_UNRESOLVED" },
            { status: 500 },
          )
        }
      } catch (stateError) {
        console.error(`[checkout/session] checkout failure-state write failed for order ${orderId}`, stateError)
        return NextResponse.json(
          { error: "Checkout state could not be finalized. Please contact support.", code: "CHECKOUT_STATE_UNRESOLVED" },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ error: "Unable to start checkout. Please try again.", code: "CHECKOUT_PROVIDER_ERROR" }, { status: 502 })
  }
}
