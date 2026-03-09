// POST /api/appeals/[id]/authorization - Create or update filing authorization
// Captures property owner info for Cook County Attorney/Representative form (staff-assisted filing)
// On save: fills official Cook County PDF and uploads to Blob so download returns single document for us + county
import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth/session"
import { prisma } from "@/lib/db"
import { put, del } from "@vercel/blob"
import { fillOfficialCookCountyAuthForm } from "@/lib/document-generation/fill-official-auth-form"
import { z } from "zod"
import { appendFileSync } from "fs"
import { join } from "path"

// #region agent log
function _dbg(id: string, msg: string, data: Record<string, unknown>) {
  const payload = { sessionId: "355d64", hypothesisId: id, location: "authorization/route.ts", message: msg, data, timestamp: Date.now() }
  fetch("http://127.0.0.1:7242/ingest/48622b90-a5ef-4d61-bef0-d727777ab56e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "355d64" },
    body: JSON.stringify(payload),
  }).catch(() => {})
  try {
    appendFileSync(join(process.cwd(), "..", "debug-355d64.log"), JSON.stringify(payload) + "\n")
  } catch (_) {}
}
// #endregion

const authorizationSchema = z.object({
  ownerName: z.string().min(1, "Name is required").max(200),
  ownerEmail: z.string().email("Valid email is required"),
  ownerPhone: z.string().max(20).optional().nullable(),
  ownerAddress: z.string().min(1, "Mailing address is required").max(300),
  ownerCity: z.string().min(1, "City is required").max(100),
  ownerState: z.string().min(1).max(2).default("IL"),
  ownerZip: z.string().min(1, "ZIP code is required").max(10),
  relationshipType: z.enum(["OWNER", "LESSEE", "TAX_BUYER", "DULY_AUTHORIZED"]).default("OWNER"),
  purchasedInPast3Years: z.boolean().optional().nullable(),
  purchasedOrRefinanced: z.enum(["PURCHASED", "REFINANCED"]).optional().nullable(),
  purchasePrice: z.string().max(50).optional().nullable(),
  dateOfPurchase: z.string().optional().nullable(), // ISO date
  rateType: z.enum(["FIXED", "VARIABLE"]).optional().nullable(),
  interestRate: z.string().max(20).optional().nullable(),
  signatureImageData: z.string().max(200_000).optional().nullable(), // base64 PNG data URL
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: appealId } = await params

    const appeal = await prisma.appeal.findFirst({
      where: {
        id: appealId,
        userId: session.user.id,
      },
      include: {
        property: { select: { pin: true, address: true, city: true, state: true, zipCode: true, township: true } },
      },
    })

    if (!appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (appeal.status !== "DRAFT" && appeal.status !== "PENDING_FILING") {
      return NextResponse.json(
        { error: "Authorization can only be added for draft or pending-filing appeals" },
        { status: 400 }
      )
    }

    // #region agent log
    _dbg("H5", "appeal loaded", { appealId, hasProperty: !!appeal.property, propertyId: appeal.propertyId })
    // #endregion

    const body = await request.json()
    const parsed = authorizationSchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Invalid input", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = parsed.data
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined

    const payload = {
      propertyAddress: appeal.property.address,
      propertyCity: appeal.property.city,
      propertyState: appeal.property.state,
      propertyZip: appeal.property.zipCode,
      propertyPin: appeal.property.pin.replace(/\D/g, "") || appeal.property.pin,
      ownerName: data.ownerName.trim(),
      ownerEmail: data.ownerEmail.trim().toLowerCase(),
      ownerPhone: data.ownerPhone?.trim() || null,
      ownerAddress: data.ownerAddress.trim(),
      ownerCity: data.ownerCity.trim(),
      ownerState: (data.ownerState || "IL").toUpperCase().slice(0, 2),
      ownerZip: data.ownerZip.trim(),
      relationshipType: data.relationshipType ?? "OWNER",
      purchasedInPast3Years: data.purchasedInPast3Years ?? null,
      purchasedOrRefinanced: data.purchasedOrRefinanced ?? null,
      purchasePrice: data.purchasePrice?.trim() || null,
      dateOfPurchase: data.dateOfPurchase ? new Date(data.dateOfPurchase) : null,
      rateType: data.rateType?.trim() || null,
      interestRate: data.interestRate?.trim() || null,
      signatureImageData: data.signatureImageData?.trim() || null,
      ipAddress,
    }

    const auth = await prisma.filingAuthorization.upsert({
      where: { appealId },
      create: { appealId, ...payload },
      update: payload,
    })

    // Fill official Cook County form and upload when no user-uploaded form exists
    // (avoids overwriting if user manually uploaded their signed form)
    // #region agent log
    _dbg("H3", "before fill", { appealId, uploadedPdfUrl: auth.uploadedPdfUrl ?? null, hasProperty: !!appeal.property })
    // #endregion
    const filledPdf =
      !auth.uploadedPdfUrl &&
      (await fillOfficialCookCountyAuthForm({
      propertyAddress: auth.propertyAddress,
      propertyCity: auth.propertyCity,
      propertyState: auth.propertyState,
      propertyZip: auth.propertyZip,
      propertyTownship: appeal.property?.township ?? null,
      propertyPin: auth.propertyPin,
      ownerName: auth.ownerName,
      ownerEmail: auth.ownerEmail,
      ownerPhone: auth.ownerPhone,
      ownerAddress: auth.ownerAddress,
      ownerCity: auth.ownerCity,
      ownerState: auth.ownerState,
      ownerZip: auth.ownerZip,
      signedAt: auth.signedAt,
      taxYear: appeal.taxYear,
      affiantName: auth.ownerName,
      relationshipType: (auth as { relationshipType?: string }).relationshipType as "OWNER" | "LESSEE" | "TAX_BUYER" | "DULY_AUTHORIZED" | undefined,
      purchasedInPast3Years: (auth as { purchasedInPast3Years?: boolean }).purchasedInPast3Years ?? undefined,
      purchasedOrRefinanced: (auth as { purchasedOrRefinanced?: string | null }).purchasedOrRefinanced ?? undefined,
      purchasePrice: (auth as { purchasePrice?: string | null }).purchasePrice ?? undefined,
      dateOfPurchase: (auth as { dateOfPurchase?: Date | null }).dateOfPurchase ?? undefined,
      rateType: (auth as { rateType?: string | null }).rateType ?? undefined,
      interestRate: (auth as { interestRate?: string | null }).interestRate ?? undefined,
      ipAddress: auth.ipAddress ?? undefined,
      signatureImagePngBase64: (auth as { signatureImageData?: string | null }).signatureImageData ?? undefined,
    }))

    // #region agent log
    _dbg("H3", "after fill", { hasFilledPdf: !!filledPdf, filledPdfLen: filledPdf?.length ?? 0 })
    // #endregion

    if (filledPdf) {
      try {
        // #region agent log
        _dbg("H4", "before blob put", {})
        // #endregion
        if (auth.uploadedPdfUrl) {
          try {
            await del(auth.uploadedPdfUrl)
          } catch {
            // Ignore delete errors
          }
        }
        const blob = await put(
          `filing-auth/${appealId}-${Date.now()}.pdf`,
          Buffer.from(filledPdf),
          { access: "public", contentType: "application/pdf" }
        )
        await prisma.filingAuthorization.update({
          where: { appealId },
          data: { uploadedPdfUrl: blob.url },
        })
        // #region agent log
        _dbg("H4", "blob upload success", { blobUrl: blob.url?.slice(0, 50) })
        // #endregion
      } catch (err) {
        // #region agent log
        _dbg("H4", "blob upload failed", { error: String(err) })
        // #endregion
        console.error("[authorization] Failed to upload filled official form (ensure BLOB_READ_WRITE_TOKEN is set)", err)
        // Continue - user can still upload manually; download will return our generated PDF
      }
    }

    return NextResponse.json({
      success: true,
      authorization: {
        id: auth.id,
        signedAt: auth.signedAt,
      },
    })
  } catch (error) {
    console.error("[authorization POST]", error)
    return NextResponse.json({ error: "Failed to save authorization" }, { status: 500 })
  }
}
